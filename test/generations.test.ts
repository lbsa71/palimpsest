import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/store.ts';
import { DirectCommunications } from '../src/communications.ts';
import { GenerationHost, releaseOf } from '../src/generations.ts';
import { freezeBaseline, freezeCandidate } from '../src/candidates.ts';
import { ProviderError } from '../src/providers.ts';
import type { Provider } from '../src/providers.ts';

function fixture(sourceOverride?: string, quiesceBackground?: () => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'palimpsest-generation-'));
  const repositoryRoot = join(directory, 'repo'); const dataDir = join(directory, 'state');
  mkdirSync(join(repositoryRoot, 'src/agent'), { recursive: true }); mkdirSync(join(repositoryRoot, 'docs'));
  const source = sourceOverride ?? readFileSync(resolve('src/agent/brain.ts'), 'utf8');
  writeFileSync(join(repositoryRoot, 'src/agent/brain.ts'), source);
  writeFileSync(join(repositoryRoot, 'docs/seed-contract.md'), 'Synthetic protected contract');
  writeFileSync(join(repositoryRoot, 'package.json'), '{"type":"module"}');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repositoryRoot, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid'); git('add', '.'); git('commit', '-qm', 'baseline');
  const frozen = { repositoryRoot, dataDir, configuration: { maxCalls: 2 }, modelProfile: { provider: 'fixture', model: null } };
  const baseline = freezeBaseline(frozen);
  const candidate = freezeCandidate({ ...frozen, changes: [{ path: 'src/agent/brain.ts', content: source.replace('slice(-12)', 'slice(-10)') }] });
  const store = new Store(join(dataDir, 'state.sqlite')); const direct = new DirectCommunications();
  let online = true; let calls = 0;
  const provider: Provider = { name: 'fixture', async complete() { calls++; if (!online) throw new ProviderError('unavailable', 'offline fixture'); return { text: 'fixture reply', provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } }; } };
  const options = { repositoryRoot, dataDir, store, provider, model: null, communications: [direct], probationChecks: 2, rpcTimeoutMs: 150, quiesceBackground };
  const host = new GenerationHost(options);
  return { directory, baseline, candidate, store, direct, host, options, offline: () => { online = false; }, calls: () => calls };
}

test('user arrival during pre-fence quiescence cancels cutover and resumes incumbent queued work', { skip: process.platform !== 'darwin' }, async () => {
  let block = false; let entered!: () => void; let release!: () => void;
  const atQuiescence = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(undefined, async () => { if (block) { entered(); await pending; } });
  try {
    await f.host.start(f.baseline); const next = await accept(f); const epoch = f.host.custodian.inspect().epoch;
    block = true; const controller = new AbortController();
    const cutover = f.host.custodian.requestCutover(next.incumbent, next.id, controller.signal);
    await atQuiescence;
    const task = await f.host.submit({ id: 'user-priority', conversationId: 'local', source: 'direct', text: 'Arrived before authority fencing' });
    controller.abort(); release();
    await assert.rejects(cutover, /cutover_cancelled/);
    assert.equal(f.host.custodian.inspect().epoch, epoch);
    assert.equal(f.host.custodian.inspect().active!.release.digest, f.baseline.manifestDigest);
    await f.host.drain(); assert.equal(f.store.task(task.id)?.state, 'succeeded');
  } finally { release(); await f.host.close(); f.store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

// Cognitive envelopes here are explicitly synthetic. Real model review/interview
// is a separately recorded seed demonstration, not inferred from these fixtures.
async function accept(f: ReturnType<typeof fixture>) {
  const c = f.host.custodian; const a = f.host.actor;
  const next = await c.propose(a, releaseOf(f.candidate));
  c.recordEvidence(next.id, { candidateDigest: f.candidate.manifestDigest, evidenceDigest: 'e'.repeat(64),
    checks: ['typecheck', 'trusted-agent-contract', 'cross-scope-memory'].map(id => ({ id, status: 'pass', evidenceDigest: 'd'.repeat(64) })),
    review: { candidateDigest: f.candidate.manifestDigest, evidenceDigest: 'e'.repeat(64), status: 'pass', contextDigest: 'f'.repeat(64) } });
  const q = c.ask(a, next.id, 'What current scope and commitments must survive?');
  c.answer(next.successor, next.id, q.id, 'The local scope and current journal. Corrections override stale snapshots.');
  const snap = c.snapshot(a, next.id);
  const binding = { candidateDigest: f.candidate.manifestDigest, evidenceDigest: 'e'.repeat(64), snapshotDigest: snap.digest, policyVersion: snap.policyVersion };
  c.verdict(a, next.id, { ...binding, decision: 'accept', reason: 'Synthetic cognitive acceptance for mechanical fault injection' }); c.ready(next.successor, next.id, binding);
  return { ...next, incumbent: a };
}

test('real process cutover catches current memory/tasks, fences old effects, retires and restarts with current history', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    await f.host.start(f.baseline);
    const first = await f.host.submit({ id: 'first', conversationId: 'local', source: 'direct', text: 'An ordinary conversation' });
    await f.host.drain(); assert.equal(f.store.task(first.id)?.state, 'succeeded');
    const proposal = await accept(f); const old = f.host.custodian.inspect().active!.process;
    const late = await f.host.submit({ id: 'late', conversationId: 'local', source: 'direct', text: 'Arrived during interview' });
    await f.host.custodian.requestCutover(proposal.incumbent, proposal.id);
    for (const boundary of ['tool', 'store', 'memory', 'message'] as const) assert.throws(() => f.host.custodian.assertAuthority(proposal.incumbent, boundary, old), /stale/);
    await f.host.drain(); assert.equal(f.store.task(late.id)?.state, 'succeeded');
    assert.equal(f.store.listMemories('local').length, 2);
    await f.host.tick(); await f.host.tick(); assert.equal(f.host.custodian.inspect().phase, 'normal');
    assert.equal(f.host.custodian.inspect().knownGood?.digest, f.candidate.manifestDigest);
    const epoch = f.host.custodian.inspect().epoch;
    await f.host.close(); const reopened = new GenerationHost(f.options);
    try { await reopened.start(); assert.ok(reopened.custodian.inspect().epoch > epoch); assert.equal(f.store.listMemories('local').length, 2); }
    finally { await reopened.close(); }
  } finally { await f.host.close(); f.store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

for (const fault of ['startup', 'crash', 'hang'] as const) test(`A15 actual ${fault} with stopped observer and offline provider restores code and current work`, { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    await f.host.start(f.baseline); const proposal = await accept(f);
    const record = f.host.custodian.status(proposal.incumbent, proposal.id);
    await f.host.worker(record.predecessor).stop(); f.offline();
    if (fault === 'startup') {
      await f.host.worker(record.successor!).stop();
      await assert.rejects(f.host.custodian.requestCutover(proposal.incumbent, proposal.id), /restored/);
    } else {
      await f.host.custodian.requestCutover(proposal.incumbent, proposal.id);
      process.kill(record.successor!.pid, fault === 'hang' ? 'SIGSTOP' : 'SIGKILL');
    }
    const remembered = f.store.addMemory({ scope: 'local', kind: 'episodic', content: 'Current experience after evaluation', source: 'synthetic integration', confidence: 1 });
    const saved = f.store.enqueue({ conversationId: 'local', source: 'direct', input: 'Resume persisted result', eventId: 'saved' });
    f.store.updateTask(saved.id, { state: 'running', checkpoint: { calls: 1, answer: 'Result persisted before interruption' } });
    const cancelled = f.store.enqueue({ conversationId: 'local', source: 'direct', input: 'Do not resume', eventId: 'cancelled' });
    f.store.updateTask(cancelled.id, { state: 'cancelled' });
    if (fault !== 'startup') await f.host.tick(); else { f.store.recoverInterrupted(); await f.host.drain(); }
    const state = f.host.custodian.inspect();
    assert.equal(state.phase, 'normal'); assert.equal(state.active?.release.digest, f.baseline.manifestDigest); assert.ok(state.epoch >= 3);
    assert.ok(state.quarantine.includes(f.candidate.manifestDigest));
    assert.equal(f.store.memory(remembered.id, 'local')?.content, remembered.content);
    assert.equal(f.store.task(saved.id)?.state, 'succeeded'); assert.equal(f.store.task(cancelled.id)?.state, 'cancelled');
    assert.equal(f.calls(), 0, 'mechanical recovery and persisted-result completion need no inference');
    assert.equal(f.direct.messages('local').at(-1)?.text, 'Result persisted before interruption');
  } finally { await f.host.close(); f.store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('tampered fallback stops within bounded recovery and preserves external history', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    await f.host.start(f.baseline); const proposal = await accept(f);
    await f.host.custodian.requestCutover(proposal.incumbent, proposal.id);
    const memory = f.store.addMemory({ scope: 'local', kind: 'episodic', content: 'Preserve me', source: 'fixture', confidence: 1 });
    const brain = join(f.baseline.candidateRoot, 'src/agent/brain.ts'); chmodSync(brain, 0o600); writeFileSync(brain, 'tampered fixture');
    await f.host.worker(f.host.custodian.inspect().active!.process).stop(); await f.host.tick();
    const state = f.host.custodian.inspect(); assert.equal(state.phase, 'recovery_required'); assert.equal(state.recoveryAttempts, 2);
    assert.equal(f.store.memory(memory.id, 'local')?.content, 'Preserve me');
    await f.host.custodian.tick(); assert.equal(f.host.custodian.inspect().recoveryAttempts, 2);
  } finally { await f.host.close(); f.store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('inference from a dead bound worker cannot finish effects before the next health poll', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture(); let release!: () => void; let begin!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { begin = resolve; });
  f.options.provider.complete = async () => { begin(); await pending; return { text: 'too late', provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } }; };
  try {
    await f.host.start(f.baseline); const task = await f.host.submit({ id: 'late', conversationId: 'local', source: 'direct', text: 'Worker dies during inference' });
    const drain = f.host.drain(); await started;
    await f.host.worker(f.host.custodian.inspect().active!.process).stop(); release();
    await assert.rejects(drain, /worker|authority/i);
    assert.equal(f.store.task(task.id)?.state, 'running'); assert.equal(f.direct.messages('local').length, 0); assert.equal(f.store.listMemories('local').length, 0);
  } finally { release(); await f.host.close(); f.store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('actual host separates local continuity and candidate globals from other conversation processes', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture(`// slice(-12) synthetic fixture marker
    let retained = '';
    export function conversationRequest(task, memories, checkpoint) {
      if (task.id === 'health') return {system:'health',prompt:JSON.stringify({request:task.input}),maxOutputTokens:8};
      const previous = retained;
      retained = JSON.stringify({input:task.input,memories,checkpoint});
      return {system:'scope fixture',prompt:JSON.stringify({request:task.input,previous,memories,snapshot:checkpoint.snapshot}),maxOutputTokens:8};
    }
  `);
  const prompts: string[] = [];
  f.options.provider.complete = async (request) => { prompts.push(request.prompt); return { text: 'scoped reply', provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } }; };
  try {
    f.store.addMemory({ scope: 'local', kind: 'episodic', content: 'LOCAL-PRIVATE-MEMORY', source: 'fixture', confidence: 1 });
    f.store.addMemory({ scope: 'alpha', kind: 'episodic', content: 'ALPHA-PRIVATE-MEMORY', source: 'fixture', confidence: 1 });
    await f.host.start(f.baseline);
    for (const [conversationId, text] of [['local', 'LOCAL-PRIVATE-REQUEST'], ['alpha', 'ALPHA-PRIVATE-REQUEST'], ['beta', 'BETA-REQUEST'], ['alpha', 'ALPHA-SECOND-REQUEST'], ['local', 'LOCAL-SECOND-REQUEST']]) {
      const task = await f.host.submit({ id: text!, conversationId: conversationId!, text: text!, source: 'direct' });
      await f.host.drain();
      assert.equal(f.store.task(task.id)?.state, 'succeeded');
    }
    assert.match(prompts[0]!, /LOCAL-PRIVATE-MEMORY/);
    assert.equal(JSON.parse(prompts[1]!).previous, '');
    assert.equal(JSON.parse(prompts[1]!).snapshot.scope, 'alpha');
    assert.match(prompts[1]!, /ALPHA-PRIVATE-MEMORY/);
    assert.doesNotMatch(prompts[1]!, /LOCAL-PRIVATE/);
    assert.equal(JSON.parse(prompts[2]!).previous, '');
    assert.doesNotMatch(prompts[2]!, /LOCAL-PRIVATE|ALPHA-PRIVATE/);
    assert.equal(JSON.parse(prompts[3]!).previous, '', 'nonlocal requests use fresh candidate globals even on later reuse');
    assert.match(JSON.parse(prompts[4]!).previous, /LOCAL-PRIVATE-REQUEST/);
    assert.doesNotMatch(prompts[4]!, /ALPHA-PRIVATE|BETA-REQUEST/);
  } finally { await f.host.close(); f.store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});
