import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { identity, type InboundInput } from '../packages/contracts/index.ts';
import { CommunicationsCore, SlackIngress } from '../packages/communications/index.ts';
import { setup, authority, envelope } from '../packages/runtime/test/fixtures.ts';
import { ordinaryServiceTools } from './evolution-mailbox.ts';
import { proposalProvenance } from './proposal-origin.ts';
import type { ApplicationConfig } from './config.ts';

test('real Slack admission retains namespaced human provenance and enforces configured author eligibility in ordinary evolution tools', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-slack-proposal-'));
  const f = setup(join(root, 'state.sqlite'), { async run() { throw Error('No inference in this transport boundary fixture'); } });
  const scope = { kind: 'restricted' as const, principals: ['channel:C1'] };
  const core = new CommunicationsCore({ store: f.store, runtime: f.runtime, grant: () => ({ authority, resources: envelope }) });
  const slack = { teamId: 'T1', botUserId: 'BOT', channels: [{ channel: 'C1', scope }], eligibleHumanIds: ['U1'], coverageStart: '1', lookbackSeconds: 100, allowSpeech: false };
  const ingress = new SlackIngress({ core, ...slack });
  // The factory does not launch or materialize an application; it consumes only these host bindings.
  const config = { applicationRoot: root, stateDirectory: join(root, 'private'), nodeBinary: process.execPath,
    artifactId: identity('accepted-fixture'), model: { id: 'fixture' }, direct: { actorId: 'operator', modificationEligible: false }, slack } as ApplicationConfig;
  const context = (runId: string) => ({ runId, scope, workspace: root, store: f.store, authority });
  const tools = (runId: string) => ordinaryServiceTools(context(runId), { config, artifactStore: join(root, 'artifacts'), evolution: { policyDigest: identity('policy') }, assertAuthority: grant => f.effects.fence.assert(grant) });
  const propose = (runId: string, changeId: string) => tools(runId).find(tool => tool.name === 'change_propose')!.execute({ changeId,
    justification: 'An authenticated eligible Slack author suggested a finite change.', objective: 'Inspect one defect.', successCriteria: ['reproduce the defect'], experienceIds: [] });
  try {
    const eligible = ingress.acceptAuthenticated('T1', { type: 'app_mention', channel: 'C1', ts: '10', user: 'U1', text: '<@BOT> inspect a defect' })!;
    assert.equal(eligible.modificationEligible, true);
    const origin = proposalProvenance(context(eligible.run.id));
    assert.equal(origin.kind, 'human'); assert.equal(origin.actorId, 'slack:T1:U1');
    assert.equal((propose(eligible.run.id, 'eligible') as any).provenance.actorId, 'slack:T1:U1');
    const steering = ingress.acceptAuthenticated('T1', { type: 'message', channel: 'C1', ts: '11', thread_ts: '10', user: 'U2', text: 'And alter this other boundary' })!;
    assert.equal(steering.run.id, eligible.run.id); assert.equal(steering.modificationEligible, false);
    assert.equal(proposalProvenance(context(eligible.run.id)).actorId, 'slack:T1:U2');
    assert.throws(() => propose(eligible.run.id, 'ineligible-steering'), /configured eligible/);
    const broad = ingress.acceptAuthenticated('T1', { type: 'app_mention', channel: 'C1', ts: '20', user: 'U2', text: '<@BOT> hello' })!;
    assert.equal(broad.run.status, 'ready', 'conversation admission remains broader than change eligibility');
    assert.throws(() => propose(broad.run.id, 'ineligible-author'), /configured eligible/);
    const input = f.store.events<InboundInput>(eligible.run.id).find(event => event.type === 'admitted')!.data;
    assert.equal(input.source, 'slack:T1', 'the fixture uses the actual transport source, not a simplified label');
    assert.equal(f.store.list('requests').length, 0);
  } finally { f.store.close(); rmSync(root, { recursive: true, force: true }); }
});
