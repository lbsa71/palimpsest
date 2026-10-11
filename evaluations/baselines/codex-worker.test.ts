import assert from 'node:assert/strict';
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { runWorker } from '../../packages/supervisor/worker-process.ts';

const installed = process.env.AEON_CODEX_FIXTURE_BINARY ?? process.env.PATH?.split(delimiter).filter(Boolean).map(directory => join(directory, 'codex')).find(path => existsSync(path));
test('actual Codex CLI runs through a network-isolated host-observed Responses fixture without ambient credentials', { skip: !installed, timeout: 45000 }, async () => {
  assert.ok(installed);
  const root = mkdtempSync(join(tmpdir(), 'aeon-codex-transport-'));
  const image = join(root, 'image'), workspace = join(root, 'work'), privateRoot = join(root, 'private');
  let calls = 0; let refusal: unknown;
  try {
  for (const path of [image, workspace, privateRoot]) mkdirSync(path, { mode: 0o700 });
  copyFileSync(realpathSync(installed), join(image, 'codex'), constants.COPYFILE_FICLONE);
  copyFileSync(join(dirname(realpathSync(installed)), 'codex-code-mode-host'), join(image, 'codex-code-mode-host'), constants.COPYFILE_FICLONE);
  copyFileSync(new URL('./codex-worker.mjs', import.meta.url), join(image, 'codex-worker.mjs'));
  writeFileSync(join(privateRoot, 'answer'), 'PRIVATE_EVALUATOR_SENTINEL');
    const result = await runWorker({ command: { workspace, applicationRoot: image, nodeBinary: process.execPath, protectedPaths: [privateRoot], executable: '/runtime/node', args: ['/app/codex-worker.mjs'], timeoutMs: 30000, maxOutputBytes: 8_000_000 },
      initial: { prompt: 'Use the command tool to verify the fixture and write proof.txt; then reply with baseline-fixture-complete.', model: 'gpt-6-astra', effort: 'high', maxConcurrency: 1, maxRequestBytes: 1_000_000, maxOutputBytes: 1_000_000 }, maxMessageBytes: 2_000_000, maxRequests: 8,
      async handle(method, args) {
        try {
        assert.equal(method, 'baseline.provider'); calls++; assert.ok(calls <= 2, 'Each fixture allows two physical requests');
        const request = args[0] as { method: string; path: string; payload: string };
        assert.equal(request.method, 'POST'); assert.equal(request.path, '/v1/responses');
        const body = JSON.parse(request.payload); assert.equal(body.model, 'gpt-6-astra'); assert.equal(body.stream, true);
        assert.ok(request.payload.includes('baseline-fixture-complete')); assert.equal(request.payload.includes('PRIVATE_EVALUATOR_SENTINEL'), false);
        let item: object;
        if (calls === 1) {
          assert.ok(body.input.some((item: any) => item.type === 'additional_tools' && item.tools.some((tool: any) => tool.type === 'namespace' && tool.name === 'functions' && tool.tools.some((nested: any) => nested.type === 'custom' && nested.name === 'exec'))));
          const program = `const fs=require('node:fs');if(fs.existsSync(${JSON.stringify(join(privateRoot, 'answer'))})||process.env.MISTRAL_API_KEY||process.env.OPENAI_API_KEY)process.exit(2);fs.writeFileSync('proof.txt','observed-native-command');console.log('observed-native-command')`;
          const command = `/runtime/node -e '${program.replaceAll("'", "'\\''")}'`;
          item = { type: 'custom_tool_call', id: 'fc_fixture', call_id: 'call_fixture', name: 'exec', namespace: 'functions', input: `text(await tools.exec_command(${JSON.stringify({ cmd: command, yield_time_ms: 1000, max_output_tokens: 1000 })}));` };
        } else {
          assert.ok(body.input.some((item: any) => item.type === 'custom_tool_call_output' && item.call_id === 'call_fixture' && JSON.stringify(item.output).includes('observed-native-command')));
          item = { type: 'message', id: 'msg_fixture', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'baseline-fixture-complete', annotations: [] }] };
        }
        const response = { id: `resp_fixture_${calls}`, object: 'response', created_at: 1, status: 'completed', model: body.model, output: [item], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
        const events = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }, { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response }];
        return { status: 200, contentType: 'text/event-stream', body: events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('') };
        } catch (error) { refusal = error; throw error; }
      } }) as { code: number; stdout: string; stderr: string; exceeded: boolean; invocation: { authentication: string } };
    assert.equal(result.code, 0, `${result.stderr}\n${String(refusal)}\n${result.stdout}`); assert.equal(result.exceeded, false); assert.equal(calls, 2); assert.match(result.stdout, /baseline-fixture-complete/);
    assert.equal(readFileSync(join(workspace, 'proof.txt'), 'utf8'), 'observed-native-command');
    assert.equal(result.invocation.authentication, 'dummy-bridge-token-only'); assert.equal(readFileSync(join(privateRoot, 'answer'), 'utf8'), 'PRIVATE_EVALUATOR_SENTINEL');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
