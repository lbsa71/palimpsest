import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, linkSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { OperationalStore } from '../../packages/storage/index.ts';
import { runCodexBaseline } from './run-codex.ts';
import type { CodexBaselineRun } from './run-codex.ts';

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-baseline-runner-'));
  const checkout = join(root, 'checkout'), workspace = join(root, 'work'), privateRoot = join(root, 'private'), stateRoot = join(root, 'state');
  for (const path of [checkout, workspace, privateRoot]) mkdirSync(path, { mode: 0o700 });
  const input: CodexBaselineRun = { checkoutRoot: checkout, workspace, privateStateRoot: stateRoot, protectedPaths: [privateRoot],
    native: { codex: '/usr/bin/true', helper: '/usr/bin/true', version: 'synthetic-unlaunched-files', codexSha256: '0'.repeat(64), helperSha256: '0'.repeat(64) },
    prompt: 'Synthetic native tool fixture only.', maxCliOutputBytes: 1_000_000,
    grant: { id: 'finite-runner-fixture', resources: { maxRequests: 2, maxTokens: 400_040, maxCostUsd: 1, maxElapsedMs: 30_000, maxConcurrency: 1 },
      profile: { provider: 'openai', model: 'gpt-6-astra', effort: 'high', contextContract: 'synthetic fixture maximum 200000 input tokens; no paid profile', contextWindowTokens: 200_000, maxOutputTokens: 20,
        prices: { source: 'synthetic prices; not a paid provider price', inputUsdPerMillion: 2, cachedInputUsdPerMillion: 1, outputUsdPerMillion: 3 } },
      requestTimeoutMs: 15_000, maxRequestBytes: 1_000_000, maxResponseBytes: 1_000_000 },
    provider: { kind: 'fixture', transport: async () => { throw new Error('Transport must not be entered during validation'); } } };
  return { root, checkout, workspace, privateRoot, stateRoot, input, dispose() { rmSync(root, { recursive: true, force: true }); } };
}

test('runner requires an explicit complete finite grant and paid kernel profile without ambient credential discovery', async () => {
  const f = fixture();
  try {
    const missingCost = structuredClone(f.input.grant); delete (missingCost.resources as Partial<typeof missingCost.resources>).maxCostUsd;
    await assert.rejects(runCodexBaseline({ ...f.input, grant: missingCost }), /maxCostUsd/);
    await assert.rejects(runCodexBaseline({ ...f.input, provider: { kind: 'openai', apiKey: 'HOST_FIXTURE_KEY' } as CodexBaselineRun['provider'] }), /kernel limits/);
    assert.equal(existsSync(f.stateRoot), false);
    const controller = new AbortController(); controller.abort(); await assert.rejects(runCodexBaseline({ ...f.input, signal: controller.signal }));
    assert.equal(existsSync(f.stateRoot), false);
  } finally { f.dispose(); }
});

test('runner rejects checkout or workspace state and changed pinned closure before launching a CLI', async () => {
  const f = fixture();
  try {
    await assert.rejects(runCodexBaseline({ ...f.input, privateStateRoot: join(f.workspace, 'state') }), /external/);
    await assert.rejects(runCodexBaseline({ ...f.input, privateStateRoot: join(f.checkout, 'state') }), /external/);
    await assert.rejects(runCodexBaseline(f.input), /unavailable or stopped/);
    const store = new OperationalStore({ filename: join(f.stateRoot, 'observer.sqlite') });
    try { assert.equal(store.list('requests').length, 0); assert.equal(store.list('baseline-grants').length, 1); } finally { store.close(); }
  } finally { f.dispose(); }
});

const installed = process.env.AEON_CODEX_FIXTURE_BINARY ?? process.env.PATH?.split(delimiter).filter(Boolean).map(directory => join(directory, 'codex')).find(path => existsSync(path));
test('actual native Codex CLI and tool runner compose with durable host grants and exact synthetic usage', {
  skip: process.env.AEON_CODEX_RUNNER_FIXTURE !== '1' || !installed,
  timeout: 45_000,
}, async () => {
  assert.ok(installed); const f = fixture(); let calls = 0; let refusal: unknown;
  try {
    const binary = realpathSync(installed), helper = join(dirname(binary), 'codex-code-mode-host');
    f.input.native = { codex: binary, helper, version: 'codex-cli 0.162.1 fixture pin', codexSha256: digest(binary), helperSha256: digest(helper) };
    f.input.prompt = 'Use the command tool to verify the fixture and write proof.txt; then reply with baseline-runner-complete.';
    writeFileSync(join(f.privateRoot, 'answer'), 'PRIVATE_EVALUATOR_SENTINEL');
    f.input.provider = { kind: 'fixture', transport: async (payload, signal) => {
      try {
        signal.throwIfAborted(); calls++; assert.ok(calls <= 2); const body = JSON.parse(payload);
        assert.equal(body.model, 'gpt-6-astra'); assert.equal(body.max_output_tokens, 20); assert.equal(body.store, false); assert.equal(body.stream, true);
        assert.ok(payload.includes('baseline-runner-complete')); assert.equal(payload.includes('PRIVATE_EVALUATOR_SENTINEL'), false);
        let item: object;
        if (calls === 1) {
          assert.ok(body.input.some((item: any) => item.type === 'additional_tools' && item.tools.some((tool: any) => tool.type === 'namespace' && tool.name === 'functions')));
          const program = `const fs=require('node:fs');if(fs.existsSync(${JSON.stringify(join(f.privateRoot, 'answer'))})||process.env.OPENAI_API_KEY||process.env.MISTRAL_API_KEY)process.exit(2);fs.writeFileSync('proof.txt','native-observer-proof');console.log('native-observer-proof')`;
          const command = `/runtime/node -e '${program.replaceAll("'", "'\\''")}'`;
          item = { type: 'custom_tool_call', id: 'fc_fixture', call_id: 'call_fixture', namespace: 'functions', name: 'exec', input: `text(await tools.exec_command(${JSON.stringify({ cmd: command, yield_time_ms: 1000, max_output_tokens: 1000 })}));` };
        } else {
          assert.ok(body.input.some((item: any) => item.type === 'custom_tool_call_output' && JSON.stringify(item.output).includes('native-observer-proof')));
          item = { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'baseline-runner-complete', annotations: [] }] };
        }
        const response = { id: `resp_fixture_${calls}`, object: 'response', created_at: 1, status: 'completed', model: body.model, output: [item], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
        const events = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }, { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response }];
        return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
      } catch (error) { refusal = error; throw error; }
    } };
    const result = await runCodexBaseline(f.input);
    const outcome = result.outcome as { code: number; stdout: string; stderr: string; exceeded: boolean };
    assert.equal(outcome.code, 0, `${outcome.stderr}\n${String(refusal)}\n${outcome.stdout}`);
    assert.match(outcome.stdout, /baseline-runner-complete/); assert.equal(outcome.exceeded, false); assert.equal(result.physicalRequests, 2); assert.equal(result.qualification, 'namespace-fixture');
    assert.equal(readFileSync(join(f.workspace, 'proof.txt'), 'utf8'), 'native-observer-proof'); assert.equal(readFileSync(join(f.privateRoot, 'answer'), 'utf8'), 'PRIVATE_EVALUATOR_SENTINEL');
    const store = new OperationalStore({ filename: join(f.stateRoot, 'observer.sqlite') });
    try {
      const rows = store.list<any>('baseline-attempts'); assert.equal(rows.length, 2);
      assert.ok(rows.every(row => row.value.outcome === 'completed' && row.value.usage.inputTokens === 100 && row.value.usage.outputTokens === 10));
      const first = rows[0]!.value;
      const before = JSON.parse(Buffer.from(store.readArtifact(first.before)).toString()), after = JSON.parse(Buffer.from(store.readArtifact(first.after)).toString());
      assert.deepEqual(after.input, before.input); assert.deepEqual(after.instructions, before.instructions);
      assert.equal(store.get<any>('baseline-run', 'run')!.value.status, 'completed');
    } finally { store.close(); }
    await assert.rejects(runCodexBaseline(f.input), /unavailable or stopped/); assert.equal(calls, 2, 'Completed runner cannot replay a grant');
  } finally { f.dispose(); }
});

for (const name of ['observer.sqlite', 'lease.sqlite', 'observer.sqlite-wal', 'observer.sqlite-shm', 'observer.sqlite-journal', 'lease.sqlite-journal']) test(`runner refuses linked private state ${name} before opening any database`, async () => {
  const f = fixture();
  try {
    mkdirSync(f.stateRoot, { mode: 0o700 });
    const exposed = join(f.workspace, 'exposed-state');
    writeFileSync(exposed, '');
    symlinkSync(exposed, join(f.stateRoot, name));
    await assert.rejects(runCodexBaseline(f.input));
    assert.equal(readFileSync(exposed).length, 0, 'private state must not write through a link');
    assert.equal(existsSync(join(f.stateRoot, name === 'lease.sqlite' ? 'observer.sqlite' : 'lease.sqlite')), false);
  } finally { f.dispose(); }
});

test('runner refuses hardlinked private state before creating a lease', async () => {
  const f = fixture();
  try {
    mkdirSync(f.stateRoot, { mode: 0o700 });
    const exposed = join(f.workspace, 'exposed-state'); writeFileSync(exposed, '');
    linkSync(exposed, join(f.stateRoot, 'observer.sqlite'));
    await assert.rejects(runCodexBaseline(f.input), /private state/);
    assert.equal(readFileSync(exposed).length, 0);
    assert.equal(existsSync(join(f.stateRoot, 'lease.sqlite')), false);
  } finally { f.dispose(); }
});
