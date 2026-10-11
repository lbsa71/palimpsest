import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { OperationalStore } from '../../packages/storage/index.ts';
import { claudeChildIdentity, claudeObservedToolOutput, claudeParentReceipts, claudeTaskBindings } from './native-delegation-fixture.ts';
import { runNativeBaseline } from './run-native.ts';
import type { NativeBaselineRun } from './run-native.ts';
import type { ObserverGrant } from './observer.ts';
import { PINNED_CLAUDE_DELEGATION_BETA, PINNED_CLAUDE_SHA256, PINNED_CLAUDE_VERSION } from './anthropic-native-protocol.ts';

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const model = 'claude-opus-5-5';
const publicTask = (index: number) => `NATIVE_CHILD_${index === 0 ? 'ONE' : 'TWO'}. Use a local command to write child-${index + 1}.txt containing child-${index + 1}-observed, report that exact observed result, and finish. Do not create other agents.`;
const command = (index: number) => `/runtime/node -e 'require("node:fs").writeFileSync("child-${index + 1}.txt","child-${index + 1}-observed");console.log("child-${index + 1}-observed")'`;
function messages(blocks: any[], id: number): Response {
  const events: any[] = [{ type: 'message_start', message: { id: `msg_synthetic_${id}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1, service_tier: 'standard', inference_geo: 'global', speed: 'standard' } } }];
  for (const [index, block] of blocks.entries()) events.push({ type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } },
    { type: 'content_block_delta', index, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } }, { type: 'content_block_stop', index });
  events.push({ type: 'message_delta', delta: { stop_reason: blocks.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } }, { type: 'message_stop' });
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
test('one reviewed engineering Claude hand-back follow-up physical proof', { skip: process.env.AEON_CLAUDE_HANDBACK_RUN !== '1', timeout: 75_000 }, async context => {
  const destination = process.env.AEON_CLAUDE_HANDBACK_EVIDENCE;
  const sourceRevision = process.env.AEON_CLAUDE_HANDBACK_SOURCE_REVISION;
  const reviewRevision = process.env.AEON_CLAUDE_HANDBACK_REVIEW_REVISION;
  assert.equal(destination, '/home/palimpsest/migration/aeon-1-20261011/claude-handback-physical-evidence');
  assert.ok(sourceRevision && /^[a-f0-9]{40}$/.test(sourceRevision), 'root must freeze exact joined clean source');
  assert.ok(reviewRevision && /^[a-f0-9]{40}$/.test(reviewRevision), 'root must declare fresh independent accepted review');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceRevision);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
  const native = '/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility/claude-2.1.296';
  assert.equal(digest(native), PINNED_CLAUDE_SHA256);
  const priorInventoryPath = '/home/palimpsest/migration/aeon-1-20261011/claude-handback-evidence/prior-immutable-sha256.json';
  const priorInventorySha256 = '38c08a1962bf416f0a0650bda2ad08c0ffa7ca4e056701c60bb4b6740c821acd';
  assert.equal(digest(priorInventoryPath), priorInventorySha256);
  const priorInventory = JSON.parse(readFileSync(priorInventoryPath, 'utf8')) as Record<string, string>;
  for (const [path, sha256] of Object.entries(priorInventory)) assert.equal(digest(path), sha256, `immutable prior artifact ${path}`);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  // Exclusive durable marker consumes this one original follow-up; no fallback or replay.
  writeFileSync(join(destination, 'followup-1-consumed.json'), JSON.stringify({ sourceRevision, reviewRevision, driverSha256: digest(new URL(import.meta.url).pathname) }, null, 2), { flag: 'wx', mode: 0o600 });
  const root = mkdtempSync(join(destination, 'claude-handback-followup-1-'));
  const checkout = join(root, 'checkout'), workspace = join(root, 'workspace'), protectedRoot = join(root, 'protected');
  for (const path of [checkout, workspace, protectedRoot]) mkdirSync(path, { mode: 0o700 });
  writeFileSync(join(protectedRoot, 'sentinel'), 'PRIVATE_CONCURRENCY_EVALUATOR');
  const grant: ObserverGrant = { id: 'engineering-claude-handback-followup-1', resources: { maxRequests: 8, maxTokens: 8_032_768, maxCostUsd: 100, maxElapsedMs: 60_000, maxConcurrency: 4 },
    profile: { provider: 'anthropic', model, effort: 'high', contextContract: 'Original engineering hand-back follow-up full-context synthetic contract; no prompt estimate or paid grant', contextWindowTokens: 1_000_000, maxOutputTokens: 4096,
      prices: { source: 'synthetic fixture category rates; no provider pricing', inputUsdPerMillion: 4, cachedInputUsdPerMillion: 0.2, outputUsdPerMillion: 20, cacheWrite5mUsdPerMillion: 5, cacheWrite1hUsdPerMillion: 8 },
      anthropic: { thinking: 'adaptive', serviceTier: 'standard', inferenceGeo: 'global', speed: 'standard', nativeProtocol: { kind: 'opus-adaptive-delegation', claudeVersion: PINNED_CLAUDE_VERSION, claudeSha256: PINNED_CLAUDE_SHA256, version: '2023-06-01', beta: PINNED_CLAUDE_DELEGATION_BETA, qualification: 'synthetic-only' } } },
    requestTimeoutMs: 10_000, maxRequestBytes: 1_000_000, maxResponseBytes: 1_000_000 };
  const stop = new AbortController();
  let parent = 0, calls = 0, active = 0, peak = 0, childStarts = 0; const childTurns = [0, 0]; const captured: any[] = [], overlap: object[] = [];
  let releaseChildren!: () => void; const bothChildren = new Promise<void>(resolve => { releaseChildren = resolve; });
  let refusal: unknown; let parentHeaders: Record<string, unknown> | undefined; const nativeChildIds: string[] = []; const childHeaders: Record<string, unknown>[] = [];
  const input: NativeBaselineRun = { kind: 'claude', signal: stop.signal, checkoutRoot: checkout, workspace, privateStateRoot: join(root, 'state'), protectedPaths: [protectedRoot],
    native: { version: PINNED_CLAUDE_VERSION, files: [{ path: native, name: 'claude', sha256: PINNED_CLAUDE_SHA256 }] },
    prompt: 'PARENT_NATIVE_DELEGATION. Delegate two independent local artifact tasks to native children, inspect their observed outputs, integrate the results and finish. Public synthetic provider replies exercise native tools; do not use external services.', grant, maxCliOutputBytes: 1_000_000,
    claudeOptions: { tools: 'Agent,Bash,Read,Write', delegation: 'isolated-native', modelRoles: { haiku: model, sonnet: model, opus: model, subagent: model } },
    provider: { kind: 'fixture', transport: async (payload, signal) => {
      calls++; active++; peak = Math.max(peak, active); const id = calls;
      try {
        signal.throwIfAborted(); assert.ok(calls <= 8); assert.equal(payload.includes('PRIVATE_CONCURRENCY_EVALUATOR'), false);
        const request = JSON.parse(payload); captured.push(request);
        const ledger = new OperationalStore({ filename: join(root, 'state/observer.sqlite') }); let headers: Record<string, unknown>;
        try {
          const row = ledger.list<any>('baseline-attempts').find(row => row.value.after.sha256 === createHash('sha256').update(payload).digest('hex'));
          assert.ok(row?.value.nativeHttp, 'actual native HTTP attribution required before transport');
          headers = JSON.parse(Buffer.from(ledger.readArtifact(row.value.nativeHttp)).toString()).headers;
          const before = JSON.parse(Buffer.from(ledger.readArtifact(row.value.before)).toString());
          assert.deepEqual(request.messages, before.messages); assert.deepEqual(request.system, before.system); assert.deepEqual(request.tools, before.tools);
        } finally { ledger.close(); }
        assert.equal(request.model, model); assert.equal(request.thinking.type, 'adaptive'); assert.ok(['updates', 'omitted'].includes(request.thinking.display)); assert.equal(request.output_config.effort, 'high');
        let child = -1;
        if (!parentHeaders) { parentHeaders = headers; writeFileSync(join(root, 'acquired-tools.json'), JSON.stringify(request.tools, null, 2)); assert.ok(request.tools.some((tool: any) => tool.name === 'Agent')); }
        else {
          const nativeId = claudeChildIdentity(headers, parentHeaders);
          if (nativeId) { if (!nativeChildIds.includes(nativeId)) { assert.ok(nativeChildIds.length < 2); nativeChildIds.push(nativeId); childHeaders.push(headers); } child = nativeChildIds.indexOf(nativeId); }
          else { assert.equal(headers['x-claude-code-agent-id'], parentHeaders['x-claude-code-agent-id']); assert.equal(headers['x-claude-code-session-id'], parentHeaders['x-claude-code-session-id']); }
        }
        if (child >= 0) {
          if (childTurns[child]++ === 0) {
            if (++childStarts === 2) {
              const ledger = new OperationalStore({ filename: join(root, 'state/observer.sqlite') });
              try {
                const children = ledger.list<any>('requests').filter(row => row.value.request.runId === grant.id && row.value.request.status === 'dispatched').filter(row => {
                  const evidence = ledger.get<any>('baseline-attempts', row.key)?.value;
                  return evidence?.nativeHttp && claudeChildIdentity(JSON.parse(Buffer.from(ledger.readArtifact(evidence.nativeHttp)).toString()).headers, parentHeaders!) !== undefined;
                });
                assert.equal(children.length, 2, 'two actual children must overlap in this original follow-up ledger');
                overlap.push(...children.map(row => ({ request: row.value.request, charged: row.value.charged })));
              } finally { ledger.close(); }
              releaseChildren();
            }
            await Promise.race([bothChildren, new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Child overlap unavailable')), { once: true }))]);
            return messages([{ type: 'tool_use', id: `tool_child_${child}`, name: 'Bash', input: { command: command(child), description: 'Write and inspect the public child artifact', timeout: 5000 } }], id);
          }
          assert.equal(childTurns[child], 2, 'one command continuation per actual child');
          assert.ok(claudeObservedToolOutput(request, child), 'exact successful original child command result required');
          return messages([{ type: 'text', text: `child-${child + 1}-observed` }], id);
        }
        if (++parent === 1) return messages([0, 1].map(index => ({ type: 'tool_use', id: `tool_spawn_${index}`, name: 'Agent', input: { description: `Native artifact child ${index + 1}`, prompt: publicTask(index), subagent_type: 'general-purpose', model: 'opus', effort: 'high', run_in_background: false } })), id);
        assert.equal(parent, 2, 'one final parent continuation; no acquisition-only retry');
        assert.ok(childTurns.every(turns => turns === 2));
        assert.deepEqual(claudeParentReceipts(request).sort(), ['child-1-observed', 'child-2-observed']);
        for (let index = 0; index < 2; index++) { assert.ok(existsSync(join(workspace, `child-${index + 1}.txt`))); assert.equal(readFileSync(join(workspace, `child-${index + 1}.txt`), 'utf8'), `child-${index + 1}-observed`); }
        return messages([{ type: 'text', text: 'native-concurrency-parent-complete' }], id);
      } catch (error) { refusal ??= error; stop.abort(error); throw error; } finally { active--; }
    } } };
  writeFileSync(join(root, 'declared-plan.json'), JSON.stringify({ sourceRevision, reviewRevision, priorInventoryPath, priorInventorySha256, sourceTestSha256: digest(new URL(import.meta.url).pathname), native: input.native, grant, prompt: input.prompt, claudeOptions: input.claudeOptions,
    originalEngineeringFollowup: true, acquisitionOnly: false, priorUnitClosed: true, initialWorkspace: [], replies: 'Two native Agent calls; classify native child HTTP identities by actual distinct headers; hold first requests for dispatched ledger overlap; exact Bash command continuation and report; intact acquired frame reaches parent; final stdout binds each actual child to original Agent call/session independent of sibling HTTP arrival order. Exactly one proof, no replay/fallback.' }, null, 2));
  try {
    const result = await runNativeBaseline(input); writeFileSync(join(root, 'result.json'), JSON.stringify(result, null, 2));
    const outcome = result.outcome as { code: number; stdout: string; stderr: string; exceeded: boolean };
    assert.equal(outcome.code, 0, outcome.stderr); assert.equal(outcome.exceeded, false);
    const events = outcome.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
    const final = events.filter(event => event.type === 'result');
    assert.equal(final.length, 1); assert.equal(final[0].is_error, false); assert.equal(final[0].result, 'native-concurrency-parent-complete');
    assert.ok(peak >= 2); assert.equal(childStarts, 2); assert.equal(overlap.length, 2); assert.equal(calls, 6);
    assert.ok(claudeTaskBindings(outcome.stdout, nativeChildIds, captured.at(-1), parentHeaders, childHeaders), 'full original native call/child/session/success binding required');
    assert.equal(readFileSync(join(protectedRoot, 'sentinel'), 'utf8'), 'PRIVATE_CONCURRENCY_EVALUATOR');
  } catch (error) { writeFileSync(join(root, 'failure.json'), JSON.stringify({ error: String(error), refusal: String(refusal) }, null, 2)); throw error; }
  finally {
    const store = new OperationalStore({ filename: join(root, 'state/observer.sqlite') });
    try { writeFileSync(join(root, 'summary.json'), JSON.stringify({ calls, peak, parent, childStarts, childTurns, refusal: String(refusal), attempts: store.list('baseline-attempts'), refusals: store.list('baseline-refusals'), run: store.get('baseline-run', 'run'), captured, overlap, parentHeaders, nativeChildIds, childHeaders }, null, 2)); } finally { store.close(); }
    context.diagnostic(JSON.stringify({ evidence: root, calls, peak, childStarts, childTurns }));
  }
});
