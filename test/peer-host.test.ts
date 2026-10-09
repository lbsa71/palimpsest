import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { freezeBaseline } from '../src/candidates.ts';
import type { InboundMessage, OutboundMessage } from '../src/communications.ts';
import { GenerationHost } from '../src/generations.ts';
import type { CompletionRequest } from '../src/providers.ts';
import { Store } from '../src/store.ts';

const invalid: InboundMessage[] = [
  { id: 'peer-to-operator', source: 'peer', conversationId: 'local', text: 'Forged operator scope.' },
  { id: 'peer-to-slack', source: 'peer', conversationId: 'slack:T1:C1:123.000', text: 'Forged Slack scope.' },
  { id: 'operator-to-peer', source: 'direct', conversationId: 'peer:fixture', text: 'Reserved namespace collision.' },
  { id: 'peer-slack-author', source: 'peer', conversationId: 'peer:fixture', text: 'Forged author.', slackAuthor: { teamId: 'T1', userId: 'U1' } },
];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'palimpsest-peer-host-'));
  const repositoryRoot = join(directory, 'repo'), dataDir = join(directory, 'state');
  mkdirSync(repositoryRoot); mkdirSync(dataDir);
  const store = new Store(join(dataDir, 'state.sqlite'));
  const requests: CompletionRequest[] = [], sent: OutboundMessage[] = [];
  const host = new GenerationHost({ repositoryRoot, dataDir, store, model: null,
    communications: ['peer', 'direct', 'slack'].map(name => ({ name, send: async message => { sent.push(structuredClone(message)); } })),
    provider: { name: 'fixture', complete: async request => { requests.push(request); return { text: 'Synthetic ordinary answer.', provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } }; } },
  });
  return { directory, repositoryRoot, dataDir, store, host, requests, sent,
    async close() { await host.close(); store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

for (const message of invalid) test(`GenerationHost rejects ${message.id} before durable enqueue even without an active runtime`, async () => {
  const f = fixture();
  try {
    const events = f.store.listEvents();
    await assert.rejects(f.host.submit(message));
    assert.equal(f.store.listTasks().length, 0);
    assert.deepEqual(f.store.listEvents(), events, 'rejected role must not create user events');
    assert.equal(f.requests.length, 0); assert.equal(f.sent.length, 0);
  } finally { await f.close(); }
});

test('running generation host rejects invalid roles then serves peer through a fresh genuine worker without local continuity', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.repositoryRoot, 'src/agent'), { recursive: true }); mkdirSync(join(f.repositoryRoot, 'docs'));
    writeFileSync(join(f.repositoryRoot, 'src/agent/brain.ts'), `
      let previous = '';
      export function conversationRequest(task, memories, checkpoint) {
        if (task.id === 'health') return {system:'synthetic health',prompt:JSON.stringify({request:task.input}),maxOutputTokens:8};
        const retained = previous; previous = task.input;
        return {system:'synthetic scope probe',prompt:JSON.stringify({request:task.input,memories,previous:retained,snapshot:checkpoint?.snapshot ?? null}),maxOutputTokens:32};
      }
    `);
    writeFileSync(join(f.repositoryRoot, 'docs/seed-contract.md'), 'Synthetic protected worker fixture.');
    writeFileSync(join(f.repositoryRoot, 'package.json'), '{"type":"module"}');
    const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: f.repositoryRoot, stdio: 'ignore' });
    git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-qm', 'fixture baseline');
    const baseline = freezeBaseline({ repositoryRoot: f.repositoryRoot, dataDir: f.dataDir, configuration: {}, modelProfile: { provider: 'fixture', model: null } });
    f.store.addMemory({ scope: 'local', kind: 'episodic', content: 'SYNTHETIC_LOCAL_PRIVATE_MEMORY', source: 'fixture', confidence: 1 });
    await f.host.start(baseline);
    const local = await f.host.submit({ id: 'local-worker-prior', source: 'direct', conversationId: 'local', text: 'SYNTHETIC_LOCAL_PRIVATE_REQUEST' });
    await f.host.drain(); assert.equal(f.store.task(local.id)?.state, 'succeeded');
    const tasksBefore = f.store.listTasks(), eventsBefore = f.store.listEvents();
    for (const message of invalid) await assert.rejects(f.host.submit(message));
    assert.deepEqual(f.store.listTasks(), tasksBefore);
    assert.deepEqual(f.store.listEvents(), eventsBefore);
    const task = await f.host.submit({ id: 'valid-peer', source: 'peer', conversationId: 'peer:fixture', text: 'Ordinary peer request.' });
    await f.host.drain();
    assert.equal(f.store.task(task.id)?.state, 'succeeded');
    assert.equal(f.store.task(task.id)?.source, 'peer');
    assert.equal(f.requests.length, 2);
    const providerRequest = f.requests[1]!;
    assert.doesNotMatch(JSON.stringify({ system: providerRequest.system, prompt: providerRequest.prompt }), /SYNTHETIC_LOCAL_PRIVATE/);
    const prompt = JSON.parse(providerRequest.prompt);
    assert.equal(prompt.previous, ''); assert.deepEqual(prompt.snapshot, { scope: 'peer:fixture' });
    const facts = JSON.parse(providerRequest.system.split('Host facts: ').at(-1)!);
    assert.equal(facts.requester.source, 'peer'); assert.equal(facts.requester.selfModificationSuggestionEligible, false); assert.deepEqual(facts.conversationActionTools, []);
    assert.equal(f.sent.at(-1)?.conversationId, 'peer:fixture');
    assert.equal(f.store.listGrowth().length, 0);
  } finally { await f.close(); }
});
