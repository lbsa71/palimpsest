import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { OperationalStore } from '../../packages/storage/index.ts';
import { runNativeBaseline } from './run-native.ts';
import type { NativeBaselineRun } from './run-native.ts';
import type { ObserverGrant } from './observer.ts';
import { PINNED_CLAUDE_BETA, PINNED_CLAUDE_SHA256, PINNED_CLAUDE_VERSION } from './anthropic-native-protocol.ts';

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const tasks = ['NATIVE_CHILD_ONE', 'NATIVE_CHILD_TWO'];
function publicTask(index: number): string { return `${tasks[index]}. Use a local command to write child-${index + 1}.txt containing child-${index + 1}-observed, report that exact observed result, and finish. Do not create other agents.`; }
function command(index: number): string { return `/runtime/node -e 'require("node:fs").writeFileSync("child-${index + 1}.txt","child-${index + 1}-observed");console.log("child-${index + 1}-observed")'`; }
function responses(model: string, outputs: object[], id: number): Response {
  const response = { id: `resp_synthetic_${id}`, status: 'completed', model, output: outputs, usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  const events = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }, ...outputs.map((item, output_index) => ({ type: 'response.output_item.done', output_index, item })), { type: 'response.completed', response }];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
function messages(model: string, blocks: any[], id: number): Response {
  const events: any[] = [{ type: 'message_start', message: { id: `msg_synthetic_${id}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1, service_tier: 'standard', inference_geo: 'global', speed: 'standard' } } }];
  for (const [index, block] of blocks.entries()) events.push({ type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } },
    { type: 'content_block_delta', index, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } }, { type: 'content_block_stop', index });
  events.push({ type: 'message_delta', delta: { stop_reason: blocks.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } }, { type: 'message_stop' });
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
for (const kind of ['codex', 'claude'] as const) test(`physical pinned ${kind} native child concurrency and parent continuation`, { skip: process.env.AEON_NATIVE_CONCURRENCY_RUN !== '1', timeout: 75_000 }, async context => {
  const destination = process.env.AEON_NATIVE_CONCURRENCY_EVIDENCE; assert.ok(destination, 'explicit retained evidence root required');
  const root = mkdtempSync(join(destination, `${kind}-children-`)), checkout = join(root, 'checkout'), workspace = join(root, 'workspace'), protectedRoot = join(root, 'protected');
  for (const path of [checkout, workspace, protectedRoot]) mkdirSync(path, { mode: 0o700 });
  writeFileSync(join(protectedRoot, 'sentinel'), 'PRIVATE_CONCURRENCY_EVALUATOR');
  const model = kind === 'codex' ? 'gpt-6-astra' : 'claude-opus-5-5';
  const native = kind === 'codex' ? realpathSync('/home/palimpsest/.local/bin/codex') : '/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility/claude-2.1.296';
  assert.equal(digest(native), kind === 'codex' ? '628e35487d888a28f0427fc37501da529dd3d81fcbad7a2c3421c1e8670d92e1' : PINNED_CLAUDE_SHA256);
  if (kind === 'codex') assert.equal(digest(join(dirname(native), 'codex-code-mode-host')), 'ec71830690a7c0024916ee0c99fbdc635bc6e747ff665ea4f03a8389bbcb6b30');
  const g: ObserverGrant = { id: `original-${kind}-native-concurrency-fixture`, resources: { maxRequests: 8, maxTokens: 8 * ((kind === 'codex' ? 200_000 : 1_000_000) + 4096), maxCostUsd: 100, maxElapsedMs: 60_000, maxConcurrency: 4 },
    profile: { provider: kind === 'codex' ? 'openai' : 'anthropic', model, effort: 'high', contextContract: 'Original full-context synthetic rehearsal contract; no prompt token estimate or paid grant', contextWindowTokens: kind === 'codex' ? 200_000 : 1_000_000, maxOutputTokens: 4096,
      prices: { source: 'synthetic fixture category rates; no provider pricing', inputUsdPerMillion: 4, cachedInputUsdPerMillion: 0.2, outputUsdPerMillion: 20,
        ...(kind === 'claude' ? { cacheWrite5mUsdPerMillion: 5, cacheWrite1hUsdPerMillion: 8 } : {}) },
      ...(kind === 'claude' ? { anthropic: { thinking: 'adaptive' as const, serviceTier: 'standard' as const, inferenceGeo: 'global' as const, speed: 'standard' as const, nativeProtocol: { kind: 'opus-adaptive-coding' as const, claudeVersion: PINNED_CLAUDE_VERSION, claudeSha256: PINNED_CLAUDE_SHA256, version: '2023-06-01' as const, beta: PINNED_CLAUDE_BETA, qualification: 'synthetic-only' as const } } } : {}) },
    requestTimeoutMs: 10_000, maxRequestBytes: 1_000_000, maxResponseBytes: 1_000_000 };
  let parent = 0, calls = 0, active = 0, peak = 0, childStarts = 0; const childTurns = [0, 0]; const captured: object[] = [];
  let releaseChildren!: () => void; const bothChildren = new Promise<void>(resolve => { releaseChildren = resolve; });
  let refusal: unknown;
  const input: NativeBaselineRun = { kind, checkoutRoot: checkout, workspace, privateStateRoot: join(root, 'state'), protectedPaths: [protectedRoot],
    native: { version: kind === 'codex' ? 'codex-cli 0.162.1' : PINNED_CLAUDE_VERSION, files: [{ path: native, name: kind, sha256: digest(native) }, ...(kind === 'codex' ? [{ path: join(dirname(native), 'codex-code-mode-host'), name: 'codex-code-mode-host', sha256: digest(join(dirname(native), 'codex-code-mode-host')) }] : [])] },
    prompt: 'PARENT_NATIVE_CONCURRENCY. Delegate two independent local artifact tasks to native children, inspect their observed outputs, integrate the results and finish. Public synthetic provider replies exercise native tools; do not use external services.', grant: g, maxCliOutputBytes: 1_000_000,
    ...(kind === 'claude' ? { claudeOptions: { tools: 'Agent,Bash,Read,Write', modelRoles: { haiku: model, sonnet: model, opus: model, subagent: model } } } : {}),
    provider: { kind: 'fixture', transport: async (payload, signal) => {
      calls++; active++; peak = Math.max(peak, active); const id = calls;
      try {
        signal.throwIfAborted(); assert.ok(calls <= 8); assert.equal(payload.includes('PRIVATE_CONCURRENCY_EVALUATOR'), false);
        const request = JSON.parse(payload); captured.push(request);
        const userText = (request.input ?? request.messages).filter((item: any) => item.role === 'user').flatMap((item: any) => typeof item.content === 'string' ? [item.content] : (item.content ?? []).filter((part: any) => ['input_text', 'text'].includes(part.type)).map((part: any) => part.text)).join('\n');
        const child = tasks.findIndex(marker => userText.includes(marker));
        if (child >= 0) {
          if (childTurns[child]++ === 0) {
            if (++childStarts === 2) releaseChildren();
            await Promise.race([bothChildren, new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Child overlap unavailable')), { once: true }))]);
            return kind === 'codex' ? responses(model, [{ type: 'custom_tool_call', id: `fc_child_${child}`, call_id: `call_child_${child}`, name: 'exec', namespace: 'functions', input: `text(await tools.exec_command(${JSON.stringify({ cmd: command(child), max_output_tokens: 1000, yield_time_ms: 1000 })}));` }], id)
              : messages(model, [{ type: 'tool_use', id: `tool_child_${child}`, name: 'Bash', input: { command: command(child), description: 'Write and inspect the public child artifact', timeout: 5000 } }], id);
          }
          const childResults = kind === 'codex' ? request.input.filter((item: any) => item.type === 'custom_tool_call_output' && item.call_id === `call_child_${child}`)
            : request.messages.filter((item: any) => item.role === 'user').flatMap((item: any) => Array.isArray(item.content) ? item.content : []).filter((part: any) => part.type === 'tool_result' && part.tool_use_id === `tool_child_${child}`);
          assert.ok(childResults.some((result: any) => JSON.stringify(kind === 'codex' ? result.output : result.content).includes(`child-${child + 1}-observed`)), 'attributed actual child tool result required; task text is not evidence');
          return kind === 'codex' ? responses(model, [{ type: 'message', id: `msg_child_${child}`, status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: `child-${child + 1}-observed`, annotations: [] }] }], id) : messages(model, [{ type: 'text', text: `child-${child + 1}-observed` }], id);
        }
        if (++parent === 1) {
          if (kind === 'codex') {
            assert.ok(request.input.some((item: any) => item.type === 'additional_tools' && item.tools.some((tool: any) => tool.name === 'collaboration' && tool.tools.some((nested: any) => nested.name === 'spawn_agent'))), 'actual pinned native spawn surface required');
            return responses(model, tasks.map((_task, index) => ({ type: 'function_call', id: `fc_spawn_${index}`, call_id: `call_spawn_${index}`, namespace: 'collaboration', name: 'spawn_agent', arguments: JSON.stringify({ task_name: `native_child_${index}`, message: publicTask(index), fork_turns: 'none' }) })), id);
          }
          const tool = request.tools.find((tool: any) => tool.name === 'Agent'); assert.ok(tool, 'actual pinned native Agent definition required');
          writeFileSync(join(root, 'agent-tool.json'), JSON.stringify(tool, null, 2));
          return messages(model, tasks.map((_task, index) => ({ type: 'tool_use', id: `tool_spawn_${index}`, name: 'Agent', input: { description: `Observe public child ${index + 1} artifact`, prompt: publicTask(index), subagent_type: 'general-purpose' } })), id);
        }
        if (kind === 'codex' && childTurns.some(turns => turns < 2)) return responses(model, [{ type: 'function_call', id: `fc_wait_${id}`, call_id: `call_wait_${id}`, namespace: 'collaboration', name: 'wait_agent', arguments: JSON.stringify({ timeout_ms: 10000 }) }], id);
        for (let index = 0; index < 2; index++) { assert.ok(existsSync(join(workspace, `child-${index + 1}.txt`))); assert.equal(readFileSync(join(workspace, `child-${index + 1}.txt`), 'utf8'), `child-${index + 1}-observed`); }
        assert.ok(childTurns.every(turns => turns >= 2));
        for (let index = 0; index < 2; index++) {
          const parentResults = kind === 'codex' ? request.input.filter((item: any) => item.role === 'user' || (item.type === 'function_call_output' && String(item.call_id).startsWith('call_wait_')))
            : request.messages.filter((item: any) => item.role === 'user').flatMap((item: any) => Array.isArray(item.content) ? item.content : []).filter((part: any) => part.type === 'tool_result' && part.tool_use_id === `tool_spawn_${index}`);
          assert.ok(parentResults.some((result: any) => JSON.stringify(result).includes(`child-${index + 1}-observed`)), 'actual parent receipt of both native child results required');
        }
        return kind === 'codex' ? responses(model, [{ type: 'message', id: 'msg_parent', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'native-concurrency-parent-complete', annotations: [] }] }], id) : messages(model, [{ type: 'text', text: 'native-concurrency-parent-complete' }], id);
      } catch (error) { refusal = error; throw error; } finally { active--; }
    } } };
  writeFileSync(join(root, 'declared-plan.json'), JSON.stringify({ sourceTestSha256: digest(new URL(import.meta.url).pathname), native: input.native, grant: g, prompt: input.prompt, claudeOptions: input.claudeOptions, replies: 'parent emits two native child calls; both child first requests held until overlap, each writes artifact and completes; parent waits when needed and finishes only after observed child continuation', originalGrant: true }, null, 2));
  try {
    const result = await runNativeBaseline(input); writeFileSync(join(root, 'result.json'), JSON.stringify(result, null, 2));
    const outcome = result.outcome as { code: number; stdout: string; stderr: string; exceeded: boolean };
    assert.equal(outcome.code, 0, outcome.stderr); assert.equal(outcome.exceeded, false); assert.match(outcome.stdout, /native-concurrency-parent-complete/); assert.ok(peak >= 2); assert.equal(childStarts, 2);
    assert.equal(readFileSync(join(protectedRoot, 'sentinel'), 'utf8'), 'PRIVATE_CONCURRENCY_EVALUATOR');
    await assert.rejects(runNativeBaseline(input), /unavailable or stopped/);
  } catch (error) { writeFileSync(join(root, 'failure.json'), JSON.stringify({ error: String(error), refusal: String(refusal) }, null, 2)); throw error; }
  finally {
    const store = new OperationalStore({ filename: join(root, 'state/observer.sqlite') });
    try { writeFileSync(join(root, 'summary.json'), JSON.stringify({ calls, peak, parent, childStarts, childTurns, refusal: String(refusal), attempts: store.list('baseline-attempts'), refusals: store.list('baseline-refusals'), run: store.get('baseline-run', 'run'), captured }, null, 2)); } finally { store.close(); }
    context.diagnostic(JSON.stringify({ evidence: root, calls, peak, childStarts, childTurns }));
  }
});
