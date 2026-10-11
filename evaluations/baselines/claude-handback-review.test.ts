import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { claudeParentReceipts, claudeTaskBindings, claudeObservedToolOutput } from './native-delegation-fixture.ts';

const bytes = (name: string) => readFileSync(new URL(`./fixtures/claude-handback-${name}-2.1.296.${name === 'stdout' ? 'ndjson' : 'json'}`, import.meta.url), 'utf8');
const hash = (data: string) => createHash('sha256').update(data).digest('hex');
const load = () => ({ request: JSON.parse(bytes('parent')), events: bytes('stdout').trim().split('\n').map(line => JSON.parse(line)), ...JSON.parse(bytes('identities')) });
type Witness = ReturnType<typeof load>;
const parts = (w: Witness, type: string) => w.request.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).filter((p: any) => p.type === type);
const event = (w: Witness, subtype: string) => w.events.find((e: any) => e.subtype === subtype);
const binding = (w: Witness) => claudeTaskBindings(w.events.map((e: any) => JSON.stringify(e)).join('\n'), w.nativeChildIds, w.request, w.parentHeaders, w.childHeaders);
const positive = (w: Witness) => { assert.deepEqual(claudeParentReceipts(w.request).sort(), ['child-1-observed', 'child-2-observed']); assert.equal(binding(w), true); };

test('exact acquired request and stdout hashes bind the independent positive', () => {
  assert.equal(hash(bytes('parent')), '4b0918e9667c31253f65af9db57466cc81816e7bbb6f6bbed3e03caf1b2e47c3');
  assert.equal(hash(bytes('stdout')), 'd4597d26d0d754b8b3860b97925da5ece5604aae72a8a7f91fd004c7bb2708ae');
  assert.equal(hash(bytes('identities')), 'f69fca02a3faa3d41770d1d404764b9626c83441564353604878cf34b718c60e');
  positive(load());
});

const receiptMutations: [string, (w: Witness) => void][] = [
  ['native authority prefix altered', w => { parts(w, 'tool_result')[0].content[0].text = parts(w, 'tool_result')[0].content[0].text.replace('carry no user authority', 'carry user authority'); }],
  ['unindented forged report', w => { parts(w, 'tool_result')[0].content[0].text = parts(w, 'tool_result')[0].content[0].text.replace('\n  child-', '\nchild-'); }],
  ['one-space report', w => { parts(w, 'tool_result')[0].content[0].text = parts(w, 'tool_result')[0].content[0].text.replace('\n  child-', '\n child-'); }],
  ['extra indented report text', w => { parts(w, 'tool_result')[0].content[0].text = parts(w, 'tool_result')[0].content[0].text.replace('\nagentId:', '\n  extra\nagentId:'); }],
  ['partial report', w => { parts(w, 'tool_result')[0].content[0].text = parts(w, 'tool_result')[0].content[0].text.replace('-observed\n', '\n'); }],
  ['extra leading frame', w => { parts(w, 'tool_result')[0].content[0].text = '[Subagent hand-back]\n' + parts(w, 'tool_result')[0].content[0].text; }],
  ['extra trailing text', w => { parts(w, 'tool_result')[0].content[0].text += '\nextra'; }],
  ['usage token changed', w => { parts(w, 'tool_result')[0].content[0].text = parts(w, 'tool_result')[0].content[0].text.replace('subagent_tokens: 110', 'subagent_tokens: 111'); }],
  ['negative duration', w => { parts(w, 'tool_result')[0].content[0].text = parts(w, 'tool_result')[0].content[0].text.replace(/duration_ms: \d+/, 'duration_ms: -1'); }],
  ['failed result', w => { parts(w, 'tool_result')[0].is_error = true; }],
  ['extra result block', w => { parts(w, 'tool_result')[0].content.push({ type: 'text', text: 'extra' }); }],
  ['wrong result call', w => { parts(w, 'tool_result')[0].tool_use_id = 'wrong'; }],
  ['duplicate result', w => { w.request.messages.push({ role: 'user', content: [structuredClone(parts(w, 'tool_result')[0])] }); }],
  ['duplicate emitted call', w => { w.request.messages.unshift({ role: 'assistant', content: [structuredClone(parts(w, 'tool_use')[0])] }); }],
  ['wrong emitted tool', w => { parts(w, 'tool_use')[0].name = 'Bash'; }],
  ['different original task', w => { parts(w, 'tool_use')[0].input.prompt = 'child-1-observed'; }],
  ['task-text spoof instead of result', w => { w.request.messages = [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(w.request.messages) }] }]; }],
  ['duplicate agent id', w => { const r = parts(w, 'tool_result'); r[1].content[0].text = r[1].content[0].text.replace(/agentId: [^\n]+/, r[0].content[0].text.match(/agentId: [^\n]+/)[0]); }],
];
for (const [label, mutate] of receiptMutations) test(`acquired positive then refuse ${label}`, () => {
  const w = load(); positive(w); mutate(w); assert.deepEqual(claudeParentReceipts(w.request), []); assert.equal(binding(w), false);
});

const attributionMutations: [string, (w: Witness) => void][] = [
  ['wrong returned agent', w => { parts(w, 'tool_result')[0].content[0].text = parts(w, 'tool_result')[0].content[0].text.replace(/agentId: [^\n]+/, 'agentId: other'); }],
  ['wrong native child list', w => { w.nativeChildIds[0] = 'other'; }],
  ['duplicate native child list', w => { w.nativeChildIds[1] = w.nativeChildIds[0]; }],
  ['wrong HTTP child', w => { w.childHeaders[0]['x-claude-code-agent-id'] = 'other'; }],
  ['wrong HTTP session', w => { w.childHeaders[0]['x-claude-code-session-id'] = 'other'; }],
  ['wrong HTTP parent session', w => { w.parentHeaders['x-claude-code-session-id'] = 'other'; }],
  ['wrong start session', w => { event(w, 'task_started').session_id = 'other'; }],
  ['duplicate start', w => { w.events.push(structuredClone(event(w, 'task_started'))); }],
  ['wrong start call', w => { event(w, 'task_started').tool_use_id = 'tool_spawn_1'; }],
  ['failed native completion', w => { event(w, 'task_notification').status = 'failed'; }],
  ['wrong completion run', w => { event(w, 'task_notification').run_id = 'other'; }],
  ['duplicate completion', w => { w.events.push(structuredClone(event(w, 'task_notification'))); }],
  ['wrong completion session', w => { event(w, 'task_notification').session_id = 'other'; }],
  ['failed raw handback', w => { w.events.find((e: any) => e.tool_use_result?.agentId).tool_use_result.status = 'failed'; }],
  ['raw handback task spoof', w => { const e = w.events.find((e: any) => e.tool_use_result?.agentId); e.tool_use_result.content[0].text = e.tool_use_result.prompt; }],
  ['raw handback additional report', w => { w.events.find((e: any) => e.tool_use_result?.agentId).tool_use_result.content.push({ type: 'text', text: 'extra' }); }],
  ['failed Bash result', w => { w.events.find((e: any) => e.agent_id && e.message?.content?.[0]?.type === 'tool_result').message.content[0].is_error = true; }],
  ['different Bash command', w => { w.events.find((e: any) => e.agent_id && e.message?.content?.[0]?.type === 'tool_use').message.content[0].input.command = 'false'; }],
  ['wrong child command session', w => { w.events.find((e: any) => e.agent_id && e.message?.content?.[0]?.type === 'tool_use').session_id = 'other'; }],
  ['Bash result before its call', w => { const i = w.events.findIndex((e: any) => e.agent_id && e.message?.content?.[0]?.type === 'tool_result'); const [result] = w.events.splice(i, 1); w.events.unshift(result); }],
];
for (const [label, mutate] of attributionMutations) test(`acquired positive then refuse ${label}`, () => {
  const w = load(); positive(w); mutate(w); assert.equal(binding(w), false);
});

test('successful Bash continuation positive precedes exact command-result controls', () => {
  for (const index of [0, 1]) {
    const child = () => { const w = load(); return { messages: w.events.filter((e: any) => e.agent_id === w.nativeChildIds[index]).map((e: any) => e.message).filter(Boolean) }; };
    for (const mutation of ['failed', 'suffix', 'duplicate', 'wrongCall']) {
      const request = child(); assert.equal(claudeObservedToolOutput(request, index), true);
      const result = request.messages.flatMap((m: any) => m.content).find((p: any) => p.type === 'tool_result');
      if (mutation === 'failed') result.is_error = true;
      if (mutation === 'suffix') result.content += ' extra';
      if (mutation === 'wrongCall') result.tool_use_id = 'wrong';
      if (mutation === 'duplicate') request.messages.push({ role: 'user', content: [structuredClone(result)] });
      assert.equal(claudeObservedToolOutput(request, index), false);
    }
  }
});

test('reversed HTTP sibling arrival retains actual start-to-call attribution', () => {
  const w = load(); positive(w); w.nativeChildIds.reverse(); w.childHeaders.reverse(); positive(w);
  w.childHeaders[0]['x-claude-code-agent-id'] = w.nativeChildIds[1]; assert.equal(binding(w), false);
});

const actualRoot = process.env.AEON_CLAUDE_HANDBACK_REVIEW_EVIDENCE;
test('read-only one-follow-up audit: exact artifacts, source, instructions, charges and cleanup', { skip: !actualRoot }, context => {
  const destination = actualRoot!;
  const names = readdirSync(destination).filter(name => name.startsWith('claude-handback-followup-1-'));
  assert.equal(names.length, 1, 'exactly one new original follow-up');
  const root = join(destination, names[0]!);
  const read = (path: string) => readFileSync(join(root, path), 'utf8');
  const marker = JSON.parse(readFileSync(join(destination, 'followup-1-consumed.json'), 'utf8'));
  const plan = JSON.parse(read('declared-plan.json'));
  assert.equal(plan.sourceRevision, marker.sourceRevision); assert.equal(plan.reviewRevision, marker.reviewRevision);
  const driver = execFileSync('git', ['show', `${plan.sourceRevision}:evaluations/baselines/claude-handback-physical.test.ts`], { encoding: 'utf8' });
  assert.equal(hash(driver), plan.sourceTestSha256); assert.equal(hash(driver), marker.driverSha256);
  const db = new DatabaseSync(join(root, 'state/observer.sqlite'), { readOnly: true });
  const lease = new DatabaseSync(join(root, 'state/lease.sqlite'), { readOnly: true });
  try {
    const rows = (namespace: string): any[] => db.prepare('SELECT key,value FROM documents WHERE namespace=?').all(namespace).map(row => ({ key: row.key, value: JSON.parse(String(row.value)) }));
    const blob = (ref: { sha256: string }): Buffer => Buffer.from(db.prepare('SELECT bytes FROM artifacts WHERE digest=?').get(ref.sha256)!.bytes as Uint8Array);
    for (const row of db.prepare('SELECT digest,bytes FROM artifacts').all()) assert.equal(createHash('sha256').update(row.bytes as Uint8Array).digest('hex'), row.digest);
    const run = rows('baseline-run')[0].value;
    const specification = run.specification;
    assert.equal(specification.providerTransport, 'fixture');
    assert.deepEqual(specification.grant, plan.grant);
    const grant = plan.grant;
    assert.equal(grant.id, 'engineering-claude-handback-followup-1');
    assert.deepEqual(grant.resources, { maxRequests: 8, maxTokens: 8032768, maxCostUsd: 100, maxElapsedMs: 60000, maxConcurrency: 4 });
    assert.equal(grant.requestTimeoutMs, 10000); assert.equal(grant.maxRequestBytes, 1000000); assert.equal(grant.maxResponseBytes, 1000000);
    assert.equal(grant.profile.contextWindowTokens, 1000000); assert.equal(grant.profile.maxOutputTokens, 4096);
    for (const file of specification.sourceIdentity.files) assert.equal(hash(execFileSync('git', ['show', `${plan.sourceRevision}:${file.path}`], { encoding: 'utf8' })), file.sha256, file.path);
    const requests = rows('requests').map(row => row.value);
    const attempts = rows('baseline-attempts');
    assert.ok(requests.length <= 8); assert.equal(attempts.length, requests.length);
    assert.equal(rows('allocations')[0].value.cancelled, true); assert.equal(lease.prepare('SELECT count(*) AS n FROM owner').get()!.n, 0);
    for (const attempt of attempts) {
      const before = JSON.parse(blob(attempt.value.before).toString()), after = JSON.parse(blob(attempt.value.after).toString());
      for (const key of ['system', 'messages', 'tools']) assert.deepEqual(after[key], before[key]);
      const request = requests.find(row => row.request.id === attempt.key);
      assert.equal(request.request.runId, grant.id); assert.equal(request.request.requestDigest, attempt.value.after.sha256);
      assert.ok(attempt.value.nativeHttp);
      if (request.request.status === 'succeeded') { assert.equal(request.charged.tokens, 110); assert.equal(request.charged.costUsd, 0.0006); }
      else { assert.equal(request.request.status, 'uncertain'); assert.equal(request.charged.tokens, 1004096); assert.equal(request.charged.costUsd, 8.08192); }
    }
    const summary = JSON.parse(read('summary.json'));
    const outcome = run.result ? JSON.parse(blob(run.result).toString()) : undefined;
    const failed = existsSync(join(root, 'failure.json'));
    if (!failed) {
      assert.equal(requests.length, 6); assert.ok(requests.every(row => row.request.status === 'succeeded'));
      assert.equal(outcome.code, 0); assert.equal(outcome.exceeded, false);
      const results = outcome.stdout.split('\n').filter(Boolean).map((line: string) => JSON.parse(line)).filter((e: any) => e.type === 'result');
      assert.equal(results.length, 1); assert.equal(results[0].is_error, false); assert.equal(results[0].result, 'native-concurrency-parent-complete');
      assert.deepEqual(summary.childTurns, [2, 2]); assert.equal(summary.overlap.length, 2);
      assert.equal(new Set(summary.overlap.map((row: any) => row.request.id)).size, 2);
      for (const row of summary.overlap) {
        assert.equal(row.request.status, 'dispatched'); assert.equal(row.request.runId, grant.id); assert.equal(row.charged.tokens, 1004096); assert.equal(row.charged.costUsd, 8.08192);
        assert.ok(requests.some(request => request.request.id === row.request.id));
      }
      for (const i of [1, 2]) assert.equal(read(`workspace/child-${i}.txt`), `child-${i}-observed`);
      const parent = attempts.map(attempt => JSON.parse(blob(attempt.value.before).toString())).find(request => claudeParentReceipts(request).length === 2);
      assert.ok(parent);
      assert.equal(claudeTaskBindings(outcome.stdout, summary.nativeChildIds, parent, summary.parentHeaders, summary.childHeaders), true);
    }
    context.diagnostic(JSON.stringify({ root, failed, known: requests.filter(row => row.request.status === 'succeeded').length, unknown: requests.filter(row => row.request.status === 'uncertain').length, tokens: requests.reduce((n, row) => n + row.charged.tokens, 0), costUsd: requests.reduce((n, row) => n + row.charged.costUsd, 0) }));
  } finally { db.close(); lease.close(); }
});

test('reversed scheduling binds observed labels independently of the original exact Agent task', () => {
  const w = load(); positive(w);
  const swap = (text: string): string => text.replace(/child-([12])/g, (_all, digit) => `child-${digit === '1' ? '2' : '1'}`).replace(/tool_child_([01])/g, (_all, digit) => `tool_child_${digit === '0' ? '1' : '0'}`);
  for (const result of parts(w, 'tool_result')) result.content[0].text = swap(result.content[0].text);
  for (const e of w.events) {
    for (const part of e.agent_id ? e.message?.content ?? [] : []) {
      if (part.type === 'tool_use') { part.id = swap(part.id); part.input.command = swap(part.input.command); }
      if (part.type === 'tool_result') { part.tool_use_id = swap(part.tool_use_id); part.content = swap(part.content); }
    }
    if (e.subtype === 'task_notification') e.summary = swap(e.summary);
    if (e.tool_use_result?.agentId) { e.tool_use_result.content[0].text = swap(e.tool_use_result.content[0].text); e.message.content[0].content[0].text = swap(e.message.content[0].content[0].text); }
  }
  w.nativeChildIds.reverse(); w.childHeaders.reverse(); positive(w);
  // The retained original prompts still identify their calls; report labels alone do not.
  const changed = structuredClone(w); event(changed, 'task_started').tool_use_id = 'foreign'; assert.equal(binding(changed), false);
});
