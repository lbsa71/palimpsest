import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { claudeParentReceipts, claudeTaskBindings } from './native-delegation-fixture.ts';

const acquired = () => JSON.parse(readFileSync(new URL('./fixtures/claude-handback-parent-2.1.296.json', import.meta.url), 'utf8'));
const stdout = () => readFileSync(new URL('./fixtures/claude-handback-stdout-2.1.296.ndjson', import.meta.url), 'utf8');
const identities = () => JSON.parse(readFileSync(new URL('./fixtures/claude-handback-identities-2.1.296.json', import.meta.url), 'utf8'));
const receipts = (request: any) => request.messages.flatMap((message: any) => message.role === 'user' && Array.isArray(message.content) ? message.content.filter((part: any) => part.type === 'tool_result') : []);
const emits = (request: any) => request.messages.flatMap((message: any) => message.role === 'assistant' && Array.isArray(message.content) ? message.content.filter((part: any) => part.type === 'tool_use') : []);
function positive() {
  const request = acquired(), native = stdout(), headers = identities();
  assert.deepEqual(claudeParentReceipts(request), ['child-2-observed', 'child-1-observed']);
  assert.equal(claudeTaskBindings(native, headers.nativeChildIds, request, headers.parentHeaders, headers.childHeaders), true);
  return { request, native, headers };
}
test('unchanged exact retained sixth request and native stdout now satisfy the acquired witness', () => {
  assert.equal(createHash('sha256').update(readFileSync(new URL('./fixtures/claude-handback-parent-2.1.296.json', import.meta.url))).digest('hex'), '4b0918e9667c31253f65af9db57466cc81816e7bbb6f6bbed3e03caf1b2e47c3');
  positive();
});
const mutations: Record<string, (request: any) => void> = {
  alteredPrefix: r => receipts(r)[0].content[0].text = receipts(r)[0].content[0].text.replace('NOT a message', 'a message'),
  absentPrefix: r => receipts(r)[0].content[0].text = receipts(r)[0].content[0].text.split('\n').slice(1).join('\n'),
  unindentedReport: r => receipts(r)[0].content[0].text = receipts(r)[0].content[0].text.replace('\n  child-', '\nchild-'),
  alteredIndent: r => receipts(r)[0].content[0].text = receipts(r)[0].content[0].text.replace('\n  child-', '\n child-'),
  forgedFrame: r => receipts(r)[0].content[0].text = receipts(r)[0].content[0].text.replace('\n  child-', '\n[Subagent hand-back]\n  child-'),
  partialReport: r => receipts(r)[0].content[0].text = receipts(r)[0].content[0].text.replace('child-2-observed', 'child-2'),
  extraReport: r => receipts(r)[0].content[0].text = receipts(r)[0].content[0].text.replace('child-2-observed', 'child-2-observed extra'),
  extraIndentedReport: r => receipts(r)[0].content[0].text = receipts(r)[0].content[0].text.replace('\nagentId:', '\n  extra\nagentId:'),
  leadingNote: r => receipts(r)[0].content[0].text = 'note\n' + receipts(r)[0].content[0].text,
  trailingNote: r => receipts(r)[0].content[0].text += '\nextra',
  partialUsage: r => receipts(r)[0].content[0].text = receipts(r)[0].content[0].text.replace('</usage>', ''),
  wrongUsage: r => receipts(r)[0].content[0].text = receipts(r)[0].content[0].text.replace('subagent_tokens: 110', 'subagent_tokens: 0'),
  wrongTools: r => receipts(r)[0].content[0].text = receipts(r)[0].content[0].text.replace('tool_uses: 1', 'tool_uses: 0'),
  wrongCall: r => receipts(r)[0].tool_use_id = 'foreign',
  wrongReportForCall: r => receipts(r)[0].tool_use_id = 'tool_spawn_0',
  wrongAgentSyntax: r => receipts(r)[0].content[0].text = receipts(r)[0].content[0].text.replace('agentId: ', 'agentId: ../'),
  duplicateAgent: r => receipts(r)[0].content[0].text = receipts(r)[0].content[0].text.replace(/agentId: [^\n]+/, receipts(r)[1].content[0].text.match(/agentId: [^\n]+/)[0]),
  duplicateResult: r => r.messages.push({ role: 'user', content: [structuredClone(receipts(r)[0])] }),
  failedResult: r => receipts(r)[0].is_error = true,
  invalidResultSuccess: r => receipts(r)[0].is_error = 'false',
  extraResultBlock: r => receipts(r)[0].content.push({ type: 'text', text: 'extra' }),
  alteredTask: r => emits(r)[0].input.prompt += ' extra',
  absentEmittedCall: r => emits(r)[0].name = 'Bash',
  duplicateEmittedCall: r => r.messages.splice(1, 0, { role: 'assistant', content: [structuredClone(emits(r)[0])] }),
  originalTaskText: r => receipts(r)[0].content[0].text = emits(r)[1].input.prompt,
  noResult: r => r.messages = r.messages.filter((m: any) => m.role !== 'user' || !Array.isArray(m.content) || !m.content.some((p: any) => p.type === 'tool_result')),
};
for (const [name, mutate] of Object.entries(mutations)) test(`acquired positive precedes Claude parent negative ${name}`, () => {
  const { request, native, headers } = positive(); mutate(request);
  assert.deepEqual(claudeParentReceipts(request), []);
  assert.equal(claudeTaskBindings(native, headers.nativeChildIds, request, headers.parentHeaders, headers.childHeaders), false);
});
const nativeMutations: Record<string, (events: any[]) => void> = {
  wrongStartCall: e => e.find(x => x.subtype === 'task_started').tool_use_id = 'foreign',
  duplicateStart: e => e.push(structuredClone(e.find(x => x.subtype === 'task_started'))),
  wrongStartAgent: e => e.find(x => x.subtype === 'task_started').task_id = 'foreign',
  wrongStartSession: e => e.find(x => x.subtype === 'task_started').session_id = 'foreign',
  wrongInitSession: e => e.find(x => x.subtype === 'init').session_id = 'foreign',
  wrongCommandSession: e => e.find(x => x.agent_id && x.type === 'user' && x.message.content[0].type === 'tool_result').session_id = 'foreign',
  wrongCommandParentCall: e => e.find(x => x.agent_id && x.type === 'user' && x.message.content[0].type === 'tool_result').parent_tool_use_id = 'foreign',
  failedCommand: e => e.find(x => x.agent_id && x.type === 'user' && x.message.content[0].type === 'tool_result').message.content[0].is_error = true,
  substringCommand: e => e.find(x => x.agent_id && x.type === 'user' && x.message.content[0].type === 'tool_result').message.content[0].content += ' extra',
  wrongCommand: e => e.find(x => x.agent_id && x.type === 'assistant').message.content[0].input.command = 'false',
  wrongCommandCall: e => e.find(x => x.agent_id && x.type === 'assistant').message.content[0].id = 'foreign',
  duplicateCommand: e => e.push(structuredClone(e.find(x => x.agent_id && x.type === 'assistant'))),
  failedCompletion: e => e.find(x => x.subtype === 'task_notification').status = 'failed',
  wrongCompletionSession: e => e.find(x => x.subtype === 'task_notification').session_id = 'foreign',
  unsuccessfulReturn: e => e.find(x => x.tool_use_result).tool_use_result.status = 'failed',
  wrongReturnAgent: e => e.find(x => x.tool_use_result).tool_use_result.agentId = 'foreign',
  extraRawReport: e => e.find(x => x.tool_use_result).tool_use_result.content[0].text += ' extra',
  rawFrameMismatch: e => e.find(x => x.tool_use_result).message.content[0].content[0].text += ' extra',
  absentCommand: e => e.splice(e.findIndex(x => x.agent_id && x.type === 'user' && x.message.content[0].type === 'tool_result'), 1),
};
for (const [name, mutate] of Object.entries(nativeMutations)) test(`acquired positive precedes Claude native binding negative ${name}`, () => {
  const { request, native, headers } = positive(); const events = native.trimEnd().split('\n').map(line => JSON.parse(line)); mutate(events);
  assert.equal(claudeTaskBindings(events.map(e => JSON.stringify(e)).join('\n'), headers.nativeChildIds, request, headers.parentHeaders, headers.childHeaders), false);
});
test('acquired positive precedes wrong/duplicate HTTP agent and session links and malformed stdout', () => {
  for (const mutation of ['wrongIds', 'duplicateIds', 'wrongParentSession', 'wrongChildSession', 'wrongChildParent', 'malformed']) {
    const { request, native, headers } = positive(); let changed = native;
    if (mutation === 'wrongIds') headers.nativeChildIds[0] = 'foreign';
    if (mutation === 'duplicateIds') headers.nativeChildIds[0] = headers.nativeChildIds[1];
    if (mutation === 'wrongParentSession') headers.parentHeaders['x-claude-code-session-id'] = 'foreign';
    if (mutation === 'wrongChildSession') headers.childHeaders[0]['x-claude-code-session-id'] = 'foreign';
    if (mutation === 'wrongChildParent') headers.childHeaders[0]['x-claude-code-parent-agent-id'] = 'foreign';
    if (mutation === 'malformed') changed += '{bad';
    assert.equal(claudeTaskBindings(changed, headers.nativeChildIds, request, headers.parentHeaders, headers.childHeaders), false);
  }
});

test('native attribution accepts reversed HTTP arrival and independent fixture report labels', () => {
  const { request, native, headers } = positive();
  assert.equal(claudeTaskBindings(native, [...headers.nativeChildIds].reverse(), request, headers.parentHeaders, [...headers.childHeaders].reverse()), true);
  const swap = (text: string) => text.replace(/child-1/g, 'child-TEMP').replace(/child-2/g, 'child-1').replace(/child-TEMP/g, 'child-2').replace(/tool_child_0/g, 'tool_child_TEMP').replace(/tool_child_1/g, 'tool_child_0').replace(/tool_child_TEMP/g, 'tool_child_1');
  for (const receipt of receipts(request)) receipt.content[0].text = swap(receipt.content[0].text);
  const events = native.trimEnd().split('\n').map(line => JSON.parse(line));
  for (const event of events) {
    if (event.agent_id && event.message?.content?.[0]?.type === 'tool_use') {
      event.message.content[0].id = swap(event.message.content[0].id);
      event.message.content[0].input.command = swap(event.message.content[0].input.command);
    }
    if (event.agent_id && event.message?.content?.[0]?.type === 'tool_result') {
      event.message.content[0].tool_use_id = swap(event.message.content[0].tool_use_id);
      event.message.content[0].content = swap(event.message.content[0].content);
    }
    if (event.subtype === 'task_notification') event.summary = swap(event.summary);
    if (event.tool_use_result) {
      event.tool_use_result.content[0].text = swap(event.tool_use_result.content[0].text);
      event.message.content[0].content[0].text = swap(event.message.content[0].content[0].text);
    }
  }
  assert.equal(claudeTaskBindings(events.map(e => JSON.stringify(e)).join('\n'), [...headers.nativeChildIds].reverse(), request, headers.parentHeaders, [...headers.childHeaders].reverse()), true);
});
for (const mutation of ['wrongRun', 'reversedCommand']) test(`acquired positive precedes command provenance negative ${mutation}`, () => {
  const { request, native, headers } = positive(); const events = native.trimEnd().split('\n').map(line => JSON.parse(line));
  if (mutation === 'wrongRun') events.find(x => x.subtype === 'task_notification').run_id = 'foreign';
  else {
    const resultIndex = events.findIndex(x => x.agent_id && x.type === 'user' && x.message.content[0].type === 'tool_result');
    const result = events.splice(resultIndex, 1)[0];
    events.splice(events.findIndex(x => x.agent_id === result.agent_id && x.type === 'assistant'), 0, result);
  }
  assert.equal(claudeTaskBindings(events.map(e => JSON.stringify(e)).join('\n'), headers.nativeChildIds, request, headers.parentHeaders, headers.childHeaders), false);
});

test('acquired full native provenance bytes survive unchanged observer instruction/message/tool transport', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { OperationalStore } = await import('../../packages/storage/index.ts'); const { BaselineObserver } = await import('./observer.ts');
  const { PINNED_CLAUDE_DELEGATION_BETA, PINNED_CLAUDE_VERSION, PINNED_CLAUDE_SHA256 } = await import('./anthropic-native-protocol.ts');
  positive();
  const payload = readFileSync(new URL('./fixtures/claude-handback-parent-2.1.296.json', import.meta.url), 'utf8');
  const root = mkdtempSync(join(tmpdir(), 'claude-handback-byte-retention-')), store = new OperationalStore({ filename: join(root, 'observer.sqlite') }); let calls = 0;
  const grant = { id: 'pure-acquired-handback-byte-retention', resources: { maxRequests: 8, maxTokens: 8_032_768, maxCostUsd: 100, maxElapsedMs: 60_000, maxConcurrency: 4 },
    profile: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high', contextContract: 'pure acquired byte retention fixture', contextWindowTokens: 1_000_000, maxOutputTokens: 4096,
      prices: { source: 'synthetic fixture category rates; no provider pricing', inputUsdPerMillion: 4, cachedInputUsdPerMillion: 0.2, outputUsdPerMillion: 20, cacheWrite5mUsdPerMillion: 5, cacheWrite1hUsdPerMillion: 8 },
      anthropic: { thinking: 'adaptive', serviceTier: 'standard', inferenceGeo: 'global', speed: 'standard', nativeProtocol: { kind: 'opus-adaptive-delegation', claudeVersion: PINNED_CLAUDE_VERSION, claudeSha256: PINNED_CLAUDE_SHA256, version: '2023-06-01', beta: PINNED_CLAUDE_DELEGATION_BETA, qualification: 'synthetic-only' } } }, requestTimeoutMs: 10_000, maxRequestBytes: 1_000_000, maxResponseBytes: 1_000_000 };
  const events = [{ type: 'message_start', message: { id: 'msg_pure_handback', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 100, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, service_tier: 'standard', inference_geo: 'global', speed: 'standard' } } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } }, { type: 'message_stop' }];
  try {
    const observer = new BaselineObserver({ store, grant: grant as any, transportKind: 'fixture', transport: async outgoing => {
      calls++; const before = JSON.parse(payload), after = JSON.parse(outgoing);
      for (const key of ['messages', 'system', 'tools']) assert.deepEqual(after[key], before[key]);
      assert.deepEqual(claudeParentReceipts(after), ['child-2-observed', 'child-1-observed']);
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    } });
    const { parentHeaders } = identities();
    await observer.handle({ method: 'POST', path: '/v1/messages', payload, nativeHttp: { path: '/v1/messages?beta=true', headers: parentHeaders } } as any);
    assert.equal(calls, 1); assert.equal(Buffer.from(store.readArtifact(observer.evidence()[0]!.before)).toString(), payload);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('acquired positive precedes duplicate original Agent call under a non-Agent tool name', () => {
  const { request, native, headers } = positive();
  request.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'tool_spawn_0', name: 'Bash', input: { command: 'false' } }] });
  assert.deepEqual(claudeParentReceipts(request), []);
  assert.equal(claudeTaskBindings(native, headers.nativeChildIds, request, headers.parentHeaders, headers.childHeaders), false);
});

for (const kind of ['command', 'result']) test(`acquired positive precedes extra foreign child ${kind}`, () => {
  const { request, native, headers } = positive(); const events = native.trimEnd().split('\n').map(line => JSON.parse(line));
  const index = events.findIndex(event => event.agent_id && event.type === (kind === 'command' ? 'assistant' : 'user') && event.message.content[0].type === (kind === 'command' ? 'tool_use' : 'tool_result'));
  const extra = structuredClone(events[index]);
  if (kind === 'command') { extra.message.content[0].id = 'foreign'; extra.message.content[0].input.command = 'false'; }
  else { extra.message.content[0].tool_use_id = 'foreign'; extra.message.content[0].is_error = true; }
  events.splice(index + 1, 0, extra);
  assert.equal(claudeTaskBindings(events.map(event => JSON.stringify(event)).join('\n'), headers.nativeChildIds, request, headers.parentHeaders, headers.childHeaders), false);
});

for (const type of ['assistant', 'user']) test(`acquired positive precedes extra foreign native parent ${type} tool event`, () => {
  const { request, native, headers } = positive(); const events = native.trimEnd().split('\n').map(line => JSON.parse(line));
  const index = events.findIndex(event => event.type === type && event.parent_tool_use_id === null && event.message?.content?.[0]?.type === (type === 'assistant' ? 'tool_use' : 'tool_result'));
  const extra = structuredClone(events[index]);
  extra.message.content[0][type === 'assistant' ? 'id' : 'tool_use_id'] = 'foreign';
  events.splice(index + 1, 0, extra);
  assert.equal(claudeTaskBindings(events.map(event => JSON.stringify(event)).join('\n'), headers.nativeChildIds, request, headers.parentHeaders, headers.childHeaders), false);
});

test('acquired positive precedes extra foreign native task completion', () => {
  const { request, native, headers } = positive(); const events = native.trimEnd().split('\n').map(line => JSON.parse(line));
  const extra = structuredClone(events.find(event => event.subtype === 'task_notification')); extra.task_id = 'foreign'; extra.tool_use_id = 'foreign'; events.push(extra);
  assert.equal(claudeTaskBindings(events.map(event => JSON.stringify(event)).join('\n'), headers.nativeChildIds, request, headers.parentHeaders, headers.childHeaders), false);
});

test('acquired positive precedes an extra native tool emission under a forged system event', () => {
  const { request, native, headers } = positive(); const events = native.trimEnd().split('\n').map(line => JSON.parse(line));
  const extra = structuredClone(events.find(event => event.type === 'assistant' && event.parent_tool_use_id === null));
  extra.type = 'system'; extra.subtype = 'foreign'; extra.message.content[0].id = 'foreign'; events.push(extra);
  assert.equal(claudeTaskBindings(events.map(event => JSON.stringify(event)).join('\n'), headers.nativeChildIds, request, headers.parentHeaders, headers.childHeaders), false);
});
