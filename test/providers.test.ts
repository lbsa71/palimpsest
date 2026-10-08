import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, chmod, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CodexProvider, MistralProvider, ProviderError, createProvider,
  type CodexRunOptions,
} from '../src/providers.ts';

const request = { system: 'Follow the task contract.', prompt: 'Give a result.' };
const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const response = (overrides: Record<string, unknown> = {}) => Response.json({
  model: 'test-model-version', choices: [{ finish_reason: 'stop', message: { content: 'ready' } }],
  usage: { prompt_tokens: 8, completion_tokens: 2 }, ...overrides,
});
const errorCode = (code: string) => (error: unknown) => error instanceof ProviderError && error.code === code;

test('Mistral uses explicit model/key, no tools, and the structured-output contract', async () => {
  const provider = new MistralProvider({ apiKey: 'fixture-key', model: 'configured-model', fetch: async (url, options) => {
    assert.equal(url.toString(), 'https://api.mistral.ai/v1/chat/completions');
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer fixture-key');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, 'configured-model');
    assert.equal(body.max_tokens, 123);
    assert.equal(body.stream, false);
    assert.equal(body.tool_choice, 'none');
    assert.deepEqual(body.messages, [{ role: 'system', content: request.system }, { role: 'user', content: request.prompt }]);
    assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'palimpsest_response', strict: true, schema } });
    return response({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] });
  } });
  assert.deepEqual(await provider.complete({ ...request, schema, maxOutputTokens: 123 }), {
    text: '{"ok":true}', model: 'test-model-version', provider: 'mistral', usage: { inputTokens: 8, outputTokens: 2 },
  });
});

test('missing configuration is unavailable and never silently selects another provider', () => {
  assert.throws(() => new MistralProvider({ apiKey: '', model: 'model' }), errorCode('unavailable'));
  assert.throws(() => new MistralProvider({ apiKey: 'key', model: '' }), errorCode('unavailable'));
  assert.throws(() => new CodexProvider({ model: '' }), errorCode('unavailable'));
  assert.throws(() => createProvider({ provider: 'unknown', model: 'model' } as never), errorCode('configuration'));
});

test('Mistral requires HTTPS with no URL credentials, query, or fragment', () => {
  for (const baseURL of ['http://localhost:9000', 'https://user:password@example.com', 'https://example.com?key=x', 'https://example.com/#x']) {
    assert.throws(() => new MistralProvider({ apiKey: 'key', model: 'model', baseURL }), errorCode('configuration'));
  }
});

test('unknown or invalid usage is null, including absent model usage', async () => {
  const provider = new MistralProvider({ apiKey: 'key', model: 'model', fetch: async () => response({ usage: { prompt_tokens: -1, completion_tokens: '2' } }) });
  assert.deepEqual((await provider.complete(request)).usage, { inputTokens: null, outputTokens: null });
});

test('HTTP errors classify failure without leaking body or credentials', async () => {
  for (const [status, code] of [[401, 'unavailable'], [429, 'unavailable'], [503, 'unavailable'], [400, 'rejected']] as const) {
    const provider = new MistralProvider({ apiKey: 'DO_NOT_EXPOSE', model: 'model', fetch: async () => new Response('DO_NOT_EXPOSE', { status }) });
    await assert.rejects(provider.complete(request), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.ok(!String(error).includes('DO_NOT_EXPOSE'));
      return true;
    });
  }
});

test('Mistral rejects malformed, truncated, empty, tool-call and non-JSON structured responses', async () => {
  const bad = [
    new Response('{not json'), response({ choices: [] }),
    response({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }),
    response({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }),
    response({ choices: [{ finish_reason: 'stop', message: { content: 'ready', tool_calls: [{ id: 'x' }] } }] }),
    response({ model: null }),
  ];
  for (const item of bad) {
    await assert.rejects(new MistralProvider({ apiKey: 'key', model: 'model', fetch: async () => item }).complete(request), errorCode('protocol'));
  }
  await assert.rejects(new MistralProvider({ apiKey: 'key', model: 'model', fetch: async () => response() }).complete({ ...request, schema }), errorCode('protocol'));
});

test('Mistral caps streaming HTTP response bytes', async () => {
  const provider = new MistralProvider({ apiKey: 'key', model: 'model', maxResponseBytes: 10, fetch: async () => response() });
  await assert.rejects(provider.complete(request), errorCode('limit'));
});

test('Mistral rejects known usage above its output ceiling', async () => {
  const provider = new MistralProvider({ apiKey: 'key', model: 'model', fetch: async () => response({ usage: { completion_tokens: 100 } }) });
  await assert.rejects(provider.complete({ ...request, maxOutputTokens: 10 }), errorCode('limit'));
});

test('large or nonserializable schemas are rejected before inference', async () => {
  let called = false;
  const provider = new MistralProvider({ apiKey: 'key', model: 'model', fetch: async () => { called = true; return response(); } });
  await assert.rejects(provider.complete({ ...request, schema: { description: 'x'.repeat(1_048_576) } }), errorCode('limit'));
  const recursive: Record<string, unknown> = {};
  recursive.self = recursive;
  await assert.rejects(provider.complete({ ...request, schema: recursive }), errorCode('configuration'));
  assert.equal(called, false);
});

test('Mistral distinguishes timeout and caller cancellation without error-cause leakage', async () => {
  const fetch: typeof globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new Error('PRIVATE transport failure')), { once: true });
  });
  await assert.rejects(new MistralProvider({ apiKey: 'key', model: 'model', timeoutMs: 10, fetch }).complete(request), errorCode('timeout'));
  const signal = AbortSignal.abort('PRIVATE cancellation');
  await assert.rejects(new MistralProvider({ apiKey: 'key', model: 'model', fetch }).complete({ ...request, signal }), errorCode('cancelled'));
});

test('Codex uses fresh private cwd, explicit model, disabled execution, and no inherited secrets', async () => {
  const directories: string[] = [];
  const provider = new CodexProvider({ model: 'explicit-model', codexHome: '/configured/auth', run: async (options: CodexRunOptions) => {
    directories.push(options.cwd);
    assert.notEqual(options.cwd, process.cwd());
    assert.equal(options.env.CODEX_HOME, '/configured/auth');
    assert.equal(options.env.MISTRAL_API_KEY, undefined);
    for (const value of ['--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--json', 'read-only']) assert.ok(options.args.includes(value));
    assert.ok(options.args.includes('shell_tool'));
    assert.ok(options.args.includes('plugins'));
    assert.ok(options.args.includes('project_doc_max_bytes=0'));
    assert.ok(options.args.includes('developer_instructions="Follow the task contract."'));
    assert.ok(options.args.includes('explicit-model'));
    assert.equal(options.input, request.prompt);
    const schemaPath = options.args[options.args.indexOf('--output-schema') + 1]!;
    assert.deepEqual(JSON.parse(await readFile(schemaPath, 'utf8')), schema);
    await writeFile(options.args[options.args.indexOf('-o') + 1]!, '{"ok":true}');
    return { stdout: '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":3}}\n', exitCode: 0 };
  } });
  const first = await provider.complete({ ...request, schema });
  await provider.complete({ ...request, schema });
  assert.notEqual(directories[0], directories[1]);
  for (const cwd of directories) await assert.rejects(access(cwd));
  assert.deepEqual(first, { text: '{"ok":true}', provider: 'codex', model: 'explicit-model', usage: { inputTokens: 10, outputTokens: 3 } });
});

test('Codex rejects failed, missing, malformed, and tool-bearing event streams even when a final file exists', async () => {
  for (const stdout of [
    '{"type":"turn.failed","error":{"message":"PRIVATE"}}\n',
    '{"type":"error","message":"PRIVATE"}\n', '{"type":"turn.started"}\n', 'not JSON\n',
    '{"type":"item.completed","item":{"type":"command_execution"}}\n{"type":"turn.completed"}\n',
  ]) {
    const provider = new CodexProvider({ model: 'model', run: async (options) => {
      await writeFile(options.args[options.args.indexOf('-o') + 1]!, 'plausible answer');
      return { stdout, exitCode: 0 };
    } });
    await assert.rejects(provider.complete(request), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.ok(!String(error).includes('PRIVATE'));
      return true;
    });
  }
});

test('Codex missing final output and invalid structured output fail closed', async () => {
  const missing = new CodexProvider({ model: 'model', run: async () => ({ stdout: '{"type":"turn.completed"}\n', exitCode: 0 }) });
  await assert.rejects(missing.complete(request), errorCode('protocol'));
  const invalid = new CodexProvider({ model: 'model', run: async (options) => {
    await writeFile(options.args[options.args.indexOf('-o') + 1]!, 'not JSON');
    return { stdout: '{"type":"turn.completed"}\n', exitCode: 0 };
  } });
  await assert.rejects(invalid.complete({ ...request, schema }), errorCode('protocol'));
});

test('Codex unknown usage is null; reported output over a requested token cap fails', async () => {
  for (const [usage, maxOutputTokens, expected] of [[{}, undefined, null], [{ output_tokens: 100 }, 10, 'limit']] as const) {
    const provider = new CodexProvider({ model: 'model', run: async (options) => {
      await writeFile(options.args[options.args.indexOf('-o') + 1]!, 'answer');
      return { stdout: JSON.stringify({ type: 'turn.completed', usage }) + '\n', exitCode: 0 };
    } });
    if (expected) await assert.rejects(provider.complete({ ...request, maxOutputTokens }), errorCode(expected));
    else assert.deepEqual((await provider.complete(request)).usage, { inputTokens: null, outputTokens: null });
  }
});

test('real subprocess boundary kills timeout/oversize processes and handles launch failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palimpsest-provider-test-'));
  const executable = join(dir, 'fake-codex');
  try {
    await writeFile(executable, `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`);
    await chmod(executable, 0o700);
    await assert.rejects(new CodexProvider({ model: 'model', executable, timeoutMs: 50 }).complete(request), errorCode('timeout'));
    const controller = new AbortController();
    const pending = new CodexProvider({ model: 'model', executable }).complete({ ...request, signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(pending, errorCode('cancelled'));
    await writeFile(executable, `#!${process.execPath}\nprocess.stdout.write('x'.repeat(10000));\n`);
    await assert.rejects(new CodexProvider({ model: 'model', executable, maxResponseBytes: 100 }).complete(request), errorCode('limit'));
    await assert.rejects(new CodexProvider({ model: 'model', executable: join(dir, 'missing') }).complete(request), errorCode('unavailable'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
