import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { OperationalStore } from '../../packages/storage/index.ts';
import { runWorker } from '../../packages/supervisor/worker-process.ts';
import { BaselineObserver } from './observer.ts';
import type { ObserverGrant, ProviderAttempt } from './observer.ts';

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
for (const kind of ['codex', 'claude'] as const) test(`physical ${kind} bridge-only overlapping HTTP fixture`, { skip: process.env.AEON_NATIVE_BRIDGE_CONCURRENCY_RUN !== '1', timeout: 15_000 }, async context => {
  const destination = process.env.AEON_NATIVE_CONCURRENCY_EVIDENCE; assert.ok(destination);
  const root = mkdtempSync(join(destination, `${kind}-bridge-only-`)), image = join(root, 'image'), workspace = join(root, 'workspace'), protectedRoot = join(root, 'protected'), stateRoot = join(root, 'state');
  for (const path of [image, workspace, protectedRoot, stateRoot]) mkdirSync(path, { mode: 0o700 });
  writeFileSync(join(protectedRoot, 'sentinel'), 'PRIVATE_BRIDGE_EVALUATOR');
  const messages = kind === 'claude', model = 'synthetic-bridge-model';
  const grant: ObserverGrant = { id: `original-${kind}-bridge-only-concurrency`, resources: { maxRequests: 2, maxTokens: 240, maxCostUsd: 1, maxElapsedMs: 10_000, maxConcurrency: 2 },
    profile: { provider: messages ? 'anthropic-fixture' : 'openai', model, effort: messages ? 'low' : 'high', contextContract: 'Public bridge-only synthetic maximum input; fake CLI and no native child claim', contextWindowTokens: 100, maxOutputTokens: 20,
      prices: { source: 'synthetic fixture rates', inputUsdPerMillion: 0, cachedInputUsdPerMillion: 0, outputUsdPerMillion: 0 } }, requestTimeoutMs: 1000, maxRequestBytes: 4096, maxResponseBytes: 4096 };
  const payload = JSON.stringify(messages ? { model, max_tokens: 20, stream: true, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: 'Public bridge-only concurrency fixture.' }] } : { model, reasoning: { effort: 'high' }, input: [{ role: 'user', content: 'Public bridge-only concurrency fixture.' }] });
  const program = `#!/runtime/node
const route=${JSON.stringify(messages ? '/v1/messages' : '/v1/responses')};
const base=${messages ? 'process.env.ANTHROPIC_BASE_URL' : "JSON.parse(process.argv.find(value=>value.startsWith('model_providers.host_observer.base_url=')).slice('model_providers.host_observer.base_url='.length)).replace(/\\/v1$/, '')"};
const send=()=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(payload)}});
const first=send(),second=send();
await new Promise(resolve=>setTimeout(resolve,50));
const overflow=await send();
const replies=await Promise.all([first,second]);
console.log(JSON.stringify({kind:'bridge-only-fake-native-fixture',statuses:replies.map(value=>value.status),overflow:overflow.status}));
for(const reply of replies)await reply.text();
process.exit(0);
`;
  writeFileSync(join(image, kind), program, { mode: 0o755 });
  const worker = new URL(`./${kind}-worker.mjs`, import.meta.url); copyFileSync(worker, join(image, `${kind}-worker.mjs`));
  if (messages) copyFileSync(new URL('./claude-configuration.ts', import.meta.url), join(image, 'claude-configuration.ts'));
  writeFileSync(join(root, 'declared-plan.json'), JSON.stringify({ qualification: 'bridge-only-fake-native-fixture', grant, sourceTestSha256: digest(new URL(import.meta.url).pathname), workerSha256: digest(worker.pathname), fixtureProgramSha256: digest(join(image, kind)), payload, originalGrant: true, replies: 'two complete synthetic SSE receipts; third overlapping body must be403 beforeRPC' }, null, 2));
  const store = new OperationalStore({ filename: join(stateRoot, 'observer.sqlite') }); let calls = 0, active = 0, peak = 0;
  let release!: () => void; const overlapped = new Promise<void>(resolve => { release = resolve; });
  const observer = new BaselineObserver({ store, grant, transport: async () => {
    calls++; active++; peak = Math.max(peak, active);
    try {
      if (calls === 2) setTimeout(release, 200); await overlapped;
      const events = messages ? [
        { type: 'message_start', message: { id: 'msg_bridge_fixture', type: 'message', role: 'assistant', model, content: [], usage: { input_tokens: 10, output_tokens: 1 } } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' },
      ] : [{ type: 'response.completed', response: { id: 'resp_bridge_fixture', status: 'completed', model, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } }];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    } finally { active--; }
  } });
  const pending = new Set<Promise<unknown>>();
  try {
    const outcome = await runWorker({ command: { workspace, applicationRoot: image, nodeBinary: process.execPath, protectedPaths: [protectedRoot, stateRoot], executable: '/runtime/node', args: [`/app/${kind}-worker.mjs`], timeoutMs: 10_000, maxOutputBytes: 300_000 },
      initial: { prompt: 'Public bridge-only fixture.', model, effort: grant.profile.effort, maxConcurrency: 2, maxRequestBytes: 4096, maxOutputBytes: 65536 }, maxMessageBytes: 100_000, maxRequests: 2,
      async handle(method, args, signal) { assert.equal(method, 'baseline.provider'); const operation = observer.handle(args[0] as unknown as ProviderAttempt, signal); pending.add(operation); try { return await operation as any; } finally { pending.delete(operation); } } }) as any;
    writeFileSync(join(root, 'outcome.json'), JSON.stringify(outcome, null, 2));
    assert.equal(outcome.code, 0, outcome.stderr); assert.equal(outcome.exceeded, false);
    assert.deepEqual(JSON.parse(outcome.stdout.trim()), { kind: 'bridge-only-fake-native-fixture', statuses: [200, 200], overflow: 403 });
    assert.equal(calls, 2); assert.equal(peak, 2); assert.equal(observer.ledger.snapshot(grant.id).tokens, 30);
    assert.ok(observer.evidence().every(record => record.outcome === 'completed')); assert.equal(outcome.invocation.maxConcurrency, 2); assert.equal(outcome.invocation.maxRequestBytes, 4096);
    assert.equal(readFileSync(join(protectedRoot, 'sentinel'), 'utf8'), 'PRIVATE_BRIDGE_EVALUATOR');
  } catch (error) { writeFileSync(join(root, 'failure.json'), JSON.stringify({ error: String(error) }, null, 2)); throw error; }
  finally { observer.cancel(); await Promise.allSettled([...pending]); writeFileSync(join(root, 'summary.json'), JSON.stringify({ calls, peak, snapshot: observer.ledger.snapshot(grant.id), attempts: observer.evidence(), originalGrant: observer.grant }, null, 2)); store.close(); context.diagnostic(JSON.stringify({ evidence: root, calls, peak })); }
});
