import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { OperationalStore } from '../packages/storage/index.ts';
import { acceptHandoff, handoffTools } from './handoff.ts';
import type { EvolutionContext } from './evolution-tools.ts';

test('ordinary handoff tools expose the source-bound task pack without disclosing another audience witness or granting H1', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-handoff-')); const store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  const context: EvolutionContext = { runId: 'run', scope: { kind: 'public' }, authority: { generation: 'g', epoch: 1, controlRevision: 'controls' }, workspace: root, store };
  try {
    const tools = handoffTools(context, { artifactId: 'current', applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))) });
    const inspect = tools.find(tool => tool.name === 'handoff_inspect')!, plan = tools.find(tool => tool.name === 'handoff_plan')!;
    assert.equal((inspect.execute({}) as any).handoff.status, 'unaccepted');
    const all = plan.execute({}) as any;
    assert.equal(all.lanes.length, 5); assert.equal(all.lanes.reduce((sum: number, lane: any) => sum + lane.tasks.length, 0), 26);
    assert.equal((plan.execute({ lane: 'A2-L04' }) as any).lanes[0].tasks.length, 6);
    assert.throws(() => plan.execute({ lane: '../../private' }), /Known Aeon/);
    store.put('host.handoff', 'H1', { candidateId: 'current', controls: 'controls', scope: { kind: 'restricted', principals: ['alice'] }, sensitiveWitness: 'private-evidence-id' }, null);
    assert.equal(JSON.stringify(inspect.execute({})).includes('private-evidence-id'), false);
    assert.equal((inspect.execute({}) as any).handoff.status, 'unaccepted');
    assert.throws(() => acceptHandoff({ store, artifactStore: root, authority: context.authority, candidateId: 'current', scope: context.scope,
      policy: { kind: 'engineering', controlRevision: 'controls', policyDigest: 'fixture', requiredCases: ['unit-tests'], evaluatorArtifacts: new Map(), evaluatorKeys: new Map() }, proof: {} as any, readArtifact: () => Buffer.alloc(0) }), /all declared/);
    assert.equal(store.get('host.handoff', 'H1')?.revision, 1, 'engineering evidence cannot overwrite the host witness');
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
