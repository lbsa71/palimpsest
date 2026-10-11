import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson } from '../../packages/contracts/index.ts';
import { assessScreenWitness, joinPublicScreenAdmission, type ScreenWitness } from './screen.ts';

test('host admission binds the observed destination through ordinary tick before joining its actual turn', async () => {
  const events: string[] = []; let target: { channel: string } | null = null, release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const app = {
    async tick() { events.push('ordinary-ingress'); target = { channel: 'PUBLIC-original-conversation' }; },
    store: { get() { return { value: { target } }; } },
    async resume() { events.push('join'); assert.equal(target?.channel, 'PUBLIC-original-conversation'); events.push(`payload-target:${target!.channel}`); await pending; return { status: 'completed' }; },
  };
  let settled = false;
  const turn = joinPublicScreenAdmission(app as any, 'PUBLIC-run').then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['ordinary-ingress', 'join', 'payload-target:PUBLIC-original-conversation']); assert.equal(settled, false);
  release(); assert.equal((await turn).status, 'completed'); assert.equal(settled, true);
  target = null;
  await assert.rejects(app.resume(), /PUBLIC-original-conversation/, 'previous direct resume order cannot produce a targeted first payload');
});

test('failed or capacity-held ordinary ingress refuses without bypassing it through direct resume', async () => {
  let resumes = 0;
  const app = { async tick() {}, store: { get() { return { value: {} }; } }, async resume() { resumes++; } };
  await assert.rejects(joinPublicScreenAdmission(app as any, 'PUBLIC-held-run'), /did not bind/); assert.equal(resumes, 0);
  app.tick = async () => { throw Error('original admission failed'); };
  await assert.rejects(joinPublicScreenAdmission(app as any, 'PUBLIC-failed-run'), /original admission failed/); assert.equal(resumes, 0);
});

test('sealed canonical witness reproduces every screen assessment digest, while changed evidence changes its identity', () => {
  const tools = ['package.json', 'src/main.mjs'].map((path, index) => ({ sequence: index + 1, effect: { kind: 'workspace_read', status: 'succeeded', payload: { path, metadata: { z: 2, a: 1 } } }, observation: { kind: 'result', value: { content: path, sha256: 'a'.repeat(64) } } }));
  const witness = { runId: 'PUBLIC-original-run', status: 'blocked', tools, children: [], delegations: [], outputs: [], files: { 'answer.json': '{"entrypoint":"src/main.mjs","behavior":"greeting returns hello"}' }, checkpoint: null } as unknown as ScreenWitness;
  const packet = { expectedAnswer: { entrypoint: 'src/main.mjs', behavior: 'greeting returns hello' } };
  const original = assessScreenWitness('S01', witness, packet), recovered = JSON.parse(canonicalJson(witness)) as ScreenWitness;
  assert.deepEqual(assessScreenWitness('S01', recovered, packet), original);
  assert.equal(original.checks.find(check => check.id === 'manifest-and-implementation-read')?.passed, true);
  assert.equal(original.checks.find(check => check.id === 'real-completed-run')?.passed, false, 'canonical identity cannot repair the retained failed outcome');
  (recovered.tools[0]!.effect.payload as any).metadata.z = 3;
  const changed = assessScreenWitness('S01', recovered, packet);
  assert.equal(changed.checks.find(check => check.id === 'manifest-and-implementation-read')?.passed, true);
  assert.notEqual(changed.checks.find(check => check.id === 'manifest-and-implementation-read')?.evidence, original.checks.find(check => check.id === 'manifest-and-implementation-read')?.evidence);
});
