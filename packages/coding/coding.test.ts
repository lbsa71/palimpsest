import assert from 'node:assert/strict';
import test from 'node:test';
import { CODEX_CODING_REASONING_EFFORT, CODING_LIMB_INSTRUCTIONS, DEFAULT_CODEX_CODING_MODEL, CodexCodingProvider, PiCodingProvider, parseCodexResult } from './index.ts';
import type { CodingInvocation, CodingMode, CodingProcessReceipt, CodingResult, CodingUsage } from './index.ts';

const SESSION = '0199e12a-9af2-7123-8a90-92b4f0e11b51';
const OTHER_SESSION = '0199e12a-9af2-7123-8a90-92b4f0e11b52';
const request = { message: 'Inspect the failing test, repair the implementation and run the test.', workspace: '/authorized/workspace' };
const limits = { timeoutMs: 30_000, maxOutputBytes: 100_000 };
const events = [
  { type: 'thread.started', thread_id: SESSION },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'command_execution', command: 'node --test arithmetic.test.js', aggregated_output: 'one failing assertion\n', exit_code: 1, status: 'completed' } },
  { type: 'item.completed', item: { id: 'item_1', type: 'file_change', changes: [{ path: 'arithmetic.js', kind: 'update' }], status: 'completed' } },
  { type: 'item.completed', item: { id: 'item_2', type: 'command_execution', command: 'node --test arithmetic.test.js', aggregated_output: 'one passing test\n', exit_code: 0, status: 'completed' } },
  { type: 'item.completed', item: { id: 'item_3', type: 'agent_message', text: 'Fixed arithmetic.js; the previously failing test passes.' } },
  { type: 'turn.completed', usage: { input_tokens: 1550, cached_input_tokens: 1000, output_tokens: 120 } },
];
const jsonl = (input: unknown[]) => `${input.map(event => JSON.stringify(event)).join('\n')}\n`;
const receipt = (overrides: Partial<CodingProcessReceipt> = {}): CodingProcessReceipt => ({
  exitCode: 0, signal: null, stdout: jsonl(events), stderr: 'retained diagnostic\n', elapsedMs: 231, ...overrides,
});

test('start is a single confined CLI invocation; follow-up resumes the exact persisted native session', async () => {
  const invocations: CodingInvocation[] = [];
  const provider = new CodexCodingProvider({ ...limits, model: DEFAULT_CODEX_CODING_MODEL, execute: async invocation => { invocations.push(invocation); return receipt(); } });
  const result = await provider.run({ ...request, mode: 'edit' });
  assert.equal(result.status, 'completed');
  assert.equal(result.sessionId, SESSION);
  assert.deepEqual(result.events, events);
  assert.equal(result.summary, 'Fixed arithmetic.js; the previously failing test passes.');
  assert.deepEqual(result.usage, { inputTokens: 1550, cachedInputTokens: 1000, outputTokens: 120, costUsd: null, physicalRequests: null });
  const first = invocations[0]!;
  assert.equal(first.executable, 'codex');
  assert.equal(first.cwd, request.workspace);
  assert.equal(first.stdin, request.message);
  assert.equal(first.timeoutMs, limits.timeoutMs);
  assert.equal(first.maxOutputBytes, limits.maxOutputBytes);
  for (const feature of ['multi_agent', 'multi_agent_v2', 'hooks', 'apps', 'plugins']) {
    assert(first.args.some((arg, index) => arg === '--disable' && first.args[index + 1] === feature));
  }
  for (const flag of ['--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules']) assert(first.args.includes(flag));
  assert(first.args.some((arg, index) => arg === '--sandbox' && first.args[index + 1] === 'workspace-write'));
  assert(first.args.includes('agents.max_threads=1'));
  assert(first.args.includes('model_reasoning_effort="high"'));
  assert(first.args.includes('approval_policy="never"'));
  assert(first.args.includes('sandbox_workspace_write.network_access=false'));
  assert(first.args.includes('shell_environment_policy.inherit="none"'));
  assert(first.args.includes('shell_environment_policy.set.PATH="/runtime:/usr/bin:/bin"'));
  assert(JSON.parse(first.args.find(arg => arg.startsWith('developer_instructions='))!.slice('developer_instructions='.length)).startsWith(CODING_LIMB_INSTRUCTIONS));
  assert.deepEqual(first.args.slice(-3), ['--model', DEFAULT_CODEX_CODING_MODEL, '-']);
  assert(!first.args.includes('--ephemeral'));
  assert(!first.args.includes(request.message));
  assert.equal(result.mode, 'edit');
  assert.deepEqual(result.invocation, { args: first.args, stdin: request.message, mode: 'edit' });
  const followup = '--config agents.max_threads=99; clarify why the fix works';
  await provider.run({ ...request, message: followup, sessionId: SESSION, mode: 'edit' });
  assert.equal(invocations.length, 2);
  assert.deepEqual(invocations[1]!.args, [...first.args.slice(0, -1), 'resume', SESSION, '-']);
  assert.equal(invocations[1]!.stdin, followup);
  assert(!invocations[1]!.args.includes('--last'));
  assert(!invocations[1]!.args.includes('fork'));
});

test('default start and resume explicitly select Sol6.1 with high effort without user configuration inheritance', async () => {
  const invocations: CodingInvocation[] = [];
  const provider = new CodexCodingProvider({ ...limits, execute: async invocation => { invocations.push(invocation); return receipt(); } });
  const first = await provider.run(request);
  assert.equal(first.mode, 'inspect');
  await provider.run({ ...request, sessionId: SESSION, previousUsage: first.cumulativeUsage });
  assert.equal(DEFAULT_CODEX_CODING_MODEL, 'gpt-6.1-sol');
  assert.equal(CODEX_CODING_REASONING_EFFORT, 'high');
  assert.equal(invocations.length, 2);
  for (const { args, mode } of invocations) {
    assert.equal(mode, 'inspect');
    assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
    assert.equal(args.filter(arg => arg === '--model').length, 1);
    assert.equal(args[args.indexOf('--model') + 1], 'gpt-6.1-sol');
    assert.equal(args.filter(arg => arg.startsWith('model_reasoning_effort=')).length, 1);
    assert(args.some((arg, index) => arg === '-c' && args[index + 1] === 'model_reasoning_effort="high"'));
    assert(args.includes('--ignore-user-config'));
    assert(!args.includes('--profile'));
  }
  const resumed = invocations[1]!.args;
  assert(resumed.indexOf('--model') < resumed.indexOf('resume'));
  assert(resumed.indexOf('model_reasoning_effort="high"') < resumed.indexOf('resume'));
  assert.deepEqual(resumed.slice(-3), ['resume', SESSION, '-']);
});

test('busy, duplicate start, changed workspace and unrelated session are refused without spawning', async () => {
  let resolve!: (receipt: CodingProcessReceipt) => void;
  let calls = 0;
  const provider = new CodexCodingProvider({ ...limits, execute: async () => { calls += 1; return new Promise(done => { resolve = done; }); } });
  const first = provider.run(request);
  await assert.rejects(provider.run(request), /active turn/);
  assert.equal(calls, 1);
  resolve(receipt());
  await first;
  await assert.rejects(provider.run(request), /already been started/);
  await assert.rejects(provider.run({ ...request, sessionId: OTHER_SESSION }), /does not match/);
  await assert.rejects(provider.run({ ...request, workspace: '/another/workspace', sessionId: SESSION }), /different workspace/);
  assert.equal(calls, 1);
});

test('a recreated provider resumes the requested UUID and rejects session names or implicit latest selection', async () => {
  let invocation: CodingInvocation | undefined;
  const provider = new CodexCodingProvider({ ...limits, execute: async input => { invocation = input; return receipt(); } });
  for (const sessionId of ['latest', '--last', '', '../session.jsonl']) {
    await assert.rejects(provider.run({ ...request, sessionId }), /exact native session UUID/);
  }
  assert.equal(invocation, undefined);
  assert.equal((await provider.run({ ...request, sessionId: SESSION })).sessionId, SESSION);
  assert.deepEqual(invocation!.args.slice(-3), ['resume', SESSION, '-']);
});

test('native session mismatches and multiple threads cannot masquerade as successful follow-ups', () => {
  const different = parseCodexResult(receipt(), OTHER_SESSION);
  assert.equal(different.status, 'uncertain');
  assert.equal(different.sessionId, OTHER_SESSION);
  assert.match(different.summary, /resumed a different session/);
  assert.deepEqual(different.events, events);
  const multiple = parseCodexResult(receipt({ stdout: jsonl([...events.slice(0, 1), { type: 'thread.started', thread_id: OTHER_SESSION }, ...events.slice(1)]) }));
  assert.equal(multiple.status, 'uncertain');
  assert.match(multiple.summary, /more than one session/);
});

test('malformed, truncated and missing completion preserve actual output and uncertainty', () => {
  const outputs = [
    `${jsonl(events)}{"type":"truncated`,
    `${jsonl(events.slice(0, -1))}unexpected plain stdout\n`,
    jsonl(events.slice(0, -1)),
    jsonl([...events, { type: 'turn.completed', usage: {} }]),
    jsonl(events.slice(1)),
  ];
  for (const stdout of outputs) {
    const result = parseCodexResult(receipt({ stdout }));
    assert.equal(result.status, 'uncertain');
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, 'retained diagnostic\n');
    assert(result.events.some(event => typeof event === 'object' && event !== null && !Array.isArray(event) && event.type === 'item.completed'));
    assert.match(result.summary, /Fixed arithmetic/);
  }
});

test('invalid accounting remains unknown without discarding successful execution or raw usage evidence', () => {
  const stdout = jsonl([...events.slice(0, -1), { type: 'turn.completed', usage: { input_tokens: -1, output_tokens: 'many' } }]);
  const result = parseCodexResult(receipt({ stdout }));
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.usage, { inputTokens: null, outputTokens: null, cachedInputTokens: null, costUsd: null, physicalRequests: null });
  assert.deepEqual(result.cumulativeUsage, result.usage);
  assert.match(result.summary, /Accounting uncertain/);
  assert.equal(result.stdout, stdout);
  assert.deepEqual(result.events.at(-1), { type: 'turn.completed', usage: { input_tokens: -1, output_tokens: 'many' } });
});

test('process errors, CLI errors and interrupted outcomes never claim completion', () => {
  const failed = parseCodexResult(receipt({ exitCode: 1 }));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.exitCode, 1);
  const apiFailure = parseCodexResult(receipt({ stdout: jsonl([events[0], { type: 'turn.failed', error: { message: 'rate limit' } }]), exitCode: 1 }));
  assert.equal(apiFailure.status, 'failed');
  assert.match(apiFailure.summary, /rate limit/);
  for (const stoppedFor of ['timeout', 'output-limit', 'cancelled'] as const) {
    const result = parseCodexResult(receipt({ stoppedFor, exitCode: null, signal: 'SIGTERM' }));
    assert.equal(result.status, stoppedFor === 'cancelled' ? 'cancelled' : 'uncertain');
    assert.equal(result.sessionId, SESSION);
    assert.match(result.summary, new RegExp(stoppedFor));
    assert.equal(result.stdout, jsonl(events));
  }
});

test('unknown events remain available and unexpected agent collaboration is explicit', () => {
  const unknown = { type: 'future.observation', evidence: 'retain me' };
  const normal = parseCodexResult(receipt({ stdout: jsonl([...events, unknown]) }));
  assert.equal(normal.status, 'completed');
  assert.deepEqual(normal.events.at(-1), unknown);
  const unexpected = { type: 'item.completed', item: { id: 'item_4', type: 'collab_tool_call', tool: 'spawn_agent' } };
  const collaboration = parseCodexResult(receipt({ stdout: jsonl([...events, unexpected]) }));
  assert.equal(collaboration.status, 'uncertain');
  assert.match(collaboration.summary, /single-agent restriction/);
});

test('execution exceptions do not retry, switch providers or permit a second untracked start', async () => {
  let calls = 0;
  const provider = new CodexCodingProvider({ ...limits, execute: async () => { calls += 1; throw new Error('transport interrupted'); } });
  const result = await provider.run(request);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.provider, 'codex');
  assert.match(result.stderr, /transport interrupted/);
  assert.match(result.summary, /No retry or fallback/);
  await assert.rejects(provider.run(request), /already been started/);
  await assert.rejects(provider.run({ ...request, sessionId: SESSION }), /unknown session outcome/);
  assert.equal(calls, 1);
});

test('pre-cancelled turns consume no start and cancellation with a receipt retains the resumable UUID', async () => {
  let calls = 0;
  const provider = new CodexCodingProvider({ ...limits, execute: async () => { calls += 1; return receipt({ stoppedFor: 'cancelled', signal: 'SIGTERM', exitCode: null }); } });
  const cancelled = new AbortController();
  cancelled.abort('stop');
  assert.equal((await provider.run(request, cancelled.signal)).status, 'cancelled');
  assert.equal(calls, 0);
  const started = await provider.run(request);
  assert.equal(started.status, 'cancelled');
  assert.equal(started.sessionId, SESSION);
  await provider.run({ ...request, sessionId: SESSION });
  assert.equal(calls, 2);
});

test('finite limits are required and Pi remains an explicit injected alternative', async () => {
  for (const timeoutMs of [0, -1, Infinity, 1.5]) assert.throws(() => new CodexCodingProvider({ ...limits, timeoutMs, execute: async () => receipt() }), /positive safe integer/);
  for (const maxOutputBytes of [0, -1, Infinity, 1.5]) assert.throws(() => new CodexCodingProvider({ ...limits, maxOutputBytes, execute: async () => receipt() }), /positive safe integer/);
  let passed: unknown;
  const result: CodingResult = { ...parseCodexResult(receipt()), provider: 'pi', sessionId: 'pi-native-session' };
  const provider = new PiCodingProvider({ run: async input => { passed = input; return result; } });
  const piRequest = { ...request, sessionId: 'pi-native-session' };
  assert.deepEqual(await provider.run(piRequest), { ...result, mode: 'inspect' });
  assert.deepEqual(passed, { ...piRequest, mode: 'inspect' });
  await assert.rejects(new PiCodingProvider({ run: async () => parseCodexResult(receipt()) }).run(request), /different provider/);
});

test('one retained session alternates inspect and edit authority per turn and omission restores inspect', async () => {
  const invocations: CodingInvocation[] = [];
  const provider = new CodexCodingProvider({ ...limits, execute: async invocation => { invocations.push(invocation); return receipt(); } });
  let previousUsage: CodingUsage | undefined;
  for (const [index, mode] of ([undefined, 'edit', undefined, 'inspect'] as const).entries()) {
    const result = await provider.run({ ...request, ...(mode ? { mode } : {}), ...(index ? { sessionId: SESSION, previousUsage } : {}) });
    assert.equal(result.sessionId, SESSION);
    assert.equal(result.mode, mode ?? 'inspect');
    assert.equal(result.invocation?.mode, mode ?? 'inspect');
    const invocation = invocations[index]!;
    assert.equal(invocation.mode, mode ?? 'inspect');
    assert.equal(invocation.args[invocation.args.indexOf('--sandbox') + 1], mode === 'edit' ? 'workspace-write' : 'read-only');
    if (index) {
      assert.deepEqual(invocation.args.slice(-3), ['resume', SESSION, '-']);
      assert.equal(result.usage.inputTokens, 0);
    }
    previousUsage = result.cumulativeUsage;
  }
  assert.equal(invocations.length, 4);
});

test('invalid modes and non-Sol model overrides cannot dispatch or grant write authority', async () => {
  let calls = 0;
  const execute = async () => { calls += 1; return receipt(); };
  assert.throws(() => new CodexCodingProvider({ ...limits, execute, model: 'another-model' }), /requires gpt-6.1-sol/);
  const provider = new CodexCodingProvider({ ...limits, execute });
  for (const mode of ['', 'write', 'danger-full-access', null]) {
    await assert.rejects(provider.run({ ...request, mode: mode as CodingMode }), /mode must be inspect or edit/);
  }
  assert.equal(calls, 0);
  assert.equal((await provider.run(request)).mode, 'inspect');
});

const usage = (inputTokens: number | null, outputTokens: number | null, cachedInputTokens: number | null): CodingUsage => ({
  inputTokens, outputTokens, cachedInputTokens, costUsd: null, physicalRequests: null,
});
const usageReceipt = (counts: CodingUsage): CodingProcessReceipt => receipt({
  stdout: jsonl([...events.slice(0, -1), { type: 'turn.completed', usage: {
    input_tokens: counts.inputTokens, output_tokens: counts.outputTokens, cached_input_tokens: counts.cachedInputTokens,
  } }]),
});

test('session-cumulative CLI tokens settle once across repeated resumes including a recreated provider', async () => {
  // The independent live inspection matched these cumulative totals to native rollout token_count events.
  const totals = [usage(58_339, 490, 52_864), usage(89_241, 894, 82_816), usage(121_464, 1111, 113_920), usage(155_375, 1580, 146_560)];
  const expected = [usage(58_339, 490, 52_864), usage(30_902, 404, 29_952), usage(32_223, 217, 31_104), usage(33_911, 469, 32_640)];
  let calls = 0;
  const execute = async () => usageReceipt(totals[calls++]!);
  let provider = new CodexCodingProvider({ ...limits, execute });
  let baseline: CodingUsage | undefined;
  const settled = usage(0, 0, 0);
  for (let index = 0; index < totals.length; index += 1) {
    if (index === 2) provider = new CodexCodingProvider({ ...limits, execute });
    const result = await provider.run({ ...request, ...(index > 0 ? { sessionId: SESSION, previousUsage: baseline } : {}) });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.usage, expected[index]);
    assert.deepEqual(result.cumulativeUsage, totals[index]);
    for (const field of ['inputTokens', 'outputTokens', 'cachedInputTokens'] as const) settled[field]! += result.usage[field]!;
    baseline = result.cumulativeUsage;
  }
  assert.equal(calls, 4);
  assert.deepEqual(settled, totals.at(-1));
});

test('missing, malformed and regressing prior totals never become fresh turn charges', () => {
  const current = usage(89_241, 894, 60_000);
  const invalidBaselines: Array<CodingUsage | undefined> = [
    undefined,
    usage(null, 490, 40_000),
    usage(-1, 490, 40_000),
    usage(Number.NaN, 490, 40_000),
    usage(58_339, 490, 60_001),
    usage(89_242, 490, 40_000),
    usage(58_339, 895, 40_000),
  ];
  for (const previous of invalidBaselines) {
    const result = parseCodexResult(usageReceipt(current), SESSION, previous);
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.usage, usage(null, null, null));
    assert.deepEqual(result.cumulativeUsage, current);
    assert.match(result.summary, /Accounting uncertain/);
    assert.match(result.summary, /per-turn token counts are unknown/);
  }
  const reset = parseCodexResult(usageReceipt(usage(10, 2, 0)), SESSION, current);
  assert.deepEqual(reset.usage, usage(null, null, null));
  assert.deepEqual(reset.cumulativeUsage, usage(10, 2, 0));
  const following = parseCodexResult(usageReceipt(usage(16, 5, 4)), SESSION, reset.cumulativeUsage);
  assert.deepEqual(following.usage, usage(6, 3, 4));
});

test('partial counters stay unknown and foreign or ambiguous totals cannot poison a session baseline', () => {
  const partial = parseCodexResult(usageReceipt(usage(null, 894, 60_000)), SESSION, usage(58_339, 490, 40_000));
  assert.equal(partial.status, 'completed');
  assert.deepEqual(partial.usage, usage(null, 404, 20_000));
  assert.deepEqual(partial.cumulativeUsage, usage(null, 894, 60_000));
  const different = parseCodexResult(receipt(), OTHER_SESSION, usage(0, 0, 0));
  assert.equal(different.cumulativeUsage, undefined);
  assert.deepEqual(different.usage, usage(null, null, null));
  const multiple = parseCodexResult(receipt({ stdout: jsonl([...events, events.at(-1)]) }), SESSION, usage(0, 0, 0));
  assert.equal(multiple.cumulativeUsage, undefined);
  assert.deepEqual(multiple.usage, usage(null, null, null));
});

test('trusted turn timeout may shorten but cannot expand the configured finite allocation', async () => {
  let observed: CodingInvocation | undefined;
  const provider = new CodexCodingProvider({ ...limits, execute: async invocation => { observed = invocation; return receipt(); } });
  for (const timeoutMs of [0, -1, Infinity, 1.5, limits.timeoutMs + 1]) {
    await assert.rejects(provider.run({ ...request, timeoutMs }), /positive safe integer|configured maximum/);
  }
  assert.equal(observed, undefined);
  await provider.run({ ...request, timeoutMs: 1000 });
  assert.equal(observed!.timeoutMs, 1000);
});
