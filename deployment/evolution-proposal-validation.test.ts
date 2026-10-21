import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { ContractError, identity, type Goal, type JsonValue, type Observation, type ShellPort } from '../packages/contracts/index.ts';
import { DurableRuntime } from '../packages/runtime/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { createNodeStorageEnvironment } from '../packages/storage/environment.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { AutarkApplication } from './application.ts';
import type { ApplicationConfig } from './config.ts';
import { evolutionTools, goalDefinitionIdentity, type EvolutionOptions } from './evolution-tools.ts';

const proposal = { changeId: 'change', justification: 'Repair an observed local defect.', objective: 'Apply one bounded change.', successCriteria: ['The measured defect is repaired.'], experienceIds: ['visible-experience'] };

function fixture(t: TestContext, self = false, loseAfterWrite: false | 'artifact' | 'proposal' = false) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-proposal-validation-')), stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'work');
  mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind.txt'), compactionPromptFile = join(root, 'compact.txt'); writeFileSync(promptFile, 'fixture'); writeFileSync(compactionPromptFile, 'fixture');
  const scope = { kind: 'restricted' as const, principals: ['operator'] }, resources = { maxRequests: 20, maxTokens: 100000, maxCostUsd: 5, maxElapsedMs: 60000, maxConcurrency: 4 };
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'proposal-fixture', controlRevision: 'fixture', promptFile, compactionPromptFile,
    model: { id: 'fixture', contextWindow: 32768, reasoning: false, effort: 'none', maxOutputTokens: 1024, maxRequestsPerSlice: 2, timeoutMs: 1000, pricesPerMillion: { input: 0, output: 0 } }, resources, conversationResources: resources, bootstrapInitiative: false,
    scheduler: { windowMs: 60000, maxSlicesPerWindow: 4, maxLifetimeSlices: 8, quantumMs: 1000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 1, pollMs: 100, commands: [], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope, modificationEligible: true } };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite')), authority = authorityStore.bootstrap('fixture', config.controlRevision, config.artifactId);
  const input = { id: 'fixture-input', source: self ? 'initiative' : 'direct', externalId: self ? 'fixture-goal' : 'request', externalRevision: '1', actorId: self ? authority.generation : 'operator', authenticated: true, scope, value: 'Make one finite change.' };
  const options: EvolutionOptions = { artifactStore: join(root, 'unused-artifacts'), acceptedCandidateId: identity('unused'), nodeBinary: process.execPath, policyDigest: identity('policy'), maxFiles: 10, maxBytes: 1000, eligibleHumanAuthors: new Set(['operator']),
    assertAuthority: value => authorityStore.assert(value), provenanceForRun: () => self ? { kind: 'self', inputId: input.id, actorId: input.actorId, goalId: input.externalId } : { kind: 'human', inputId: input.id, actorId: input.actorId },
    enqueueEvaluation() { throw Error('No evaluation authorized'); }, readEvaluation() { throw Error('No evaluation authorized'); }, async submitRelease() { throw Error('No release authorized'); } };
  let db: DatabaseSync, proposalStore: OperationalStore | undefined, toolCalls = 0;
  const changes = () => ({ artifacts: db.prepare('SELECT count(*) AS n FROM artifacts').get()!.n, proposals: db.prepare("SELECT count(*) AS n FROM documents WHERE namespace='release.changes'").get()!.n });
  const rejectedMutations: { before: ReturnType<typeof changes>; after: ReturnType<typeof changes> }[] = [];
  const app = new AutarkApplication({ config, authorityStore, authority, secrets: { directToken: 'fixture' }, performRequest: async () => { throw Error('No model calls authorized'); },
    additionalTools: context => evolutionTools({ ...context, store: proposalStore ?? context.store }, options).filter(tool => tool.name === 'change_propose').map(tool => ({ ...tool, async execute(args: JsonValue, signal?: AbortSignal) {
      toolCalls++; const before = changes();
      try { const result = await tool.execute(args, signal); if (loseAfterWrite === 'proposal') { assert.equal(app.store.list('release.changes').length, 1); throw Error('Fixture receipt lost after committed proposal'); } return result; }
      catch (error) { rejectedMutations.push({ before, after: changes() }); throw error; }
    } })) });
  db = new DatabaseSync(app.store.filename, { readOnly: true });
  if (loseAfterWrite === 'artifact') {
    const environment = createNodeStorageEnvironment();
    proposalStore = new OperationalStore({ filename: app.store.filename }, { ...environment, openDatabase: path => {
      const database = environment.openDatabase(path);
      return { ...database, prepare: sql => { const statement = database.prepare(sql); return { ...statement, run: (...values) => {
        const result = statement.run(...values);
        if (sql === 'INSERT OR IGNORE INTO artifacts VALUES(?,?)') throw new ContractError('Fixture artifact receipt lost after storage write');
        return result;
      } }; } };
    } });
  }
  t.after(async () => { proposalStore?.close(); db.close(); await app.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); });
  const run = app.runtime.admit(input, authority, resources, 'operating-envelope:v1');
  app.store.put('host.run-grants', run.id, { scope, workspace: workspaceDirectory }, null);
  if (self) {
    const goal: Goal = { id: input.externalId, revision: 1, origin: { kind: 'self' }, purpose: 'Repair an observed defect', scope, status: 'running', successCriteria: ['Measured repair'], evidenceIds: [], dependencyIds: [], resources, priority: 1, nextAction: 'propose', reviewAt: '2026-10-21T00:00:00Z' };
    app.store.put('initiative.goals', goal.id, goal, null); app.store.put('initiative.execution', goal.id, { runId: run.id }, null);
    app.store.put('host.release-self-origins', goal.id, { goalId: goal.id, goalDefinition: goalDefinitionIdentity(goal), basis: 'accepted-bootstrap' }, null);
  }
  for (const [id, audience] of [['visible-experience', scope], ['private-experience', { kind: 'restricted' as const, principals: ['other'] }]] as const) app.memory.ingest({ id, runId: run.id, sourceId: id, actorId: 'fixture', scope: { ...audience, principals: [...audience.principals] }, at: '2026-10-21T00:00:00Z', channel: 'tool', content: 'Observed fixture defect.' });
  const execute = (shell: ShellPort) => new DurableRuntime({ store: app.store, effects: app.effects, resources: app.resources, shell, now: () => 1000, elapsedNow: () => 0 }).resume(run.id, app.prompt);
  return { app, run, execute, rejectedMutations, toolCalls: () => toolCalls };
}

test('invalid proposal evidence becomes a known failed observation, then a corrected proposal continues in the same conversation', async t => {
  const f = fixture(t), observations: Observation[] = [];
  const result = await f.execute({ async run({ run }, bridge) {
    for (const [index, experienceIds] of [['input:fixture-input'], ['aeon:artifact:' + 'a'.repeat(64)], ['private-experience'], ['visible-experience']].entries()) {
      const observation = await bridge.execute({ id: `proposal-${index}`, runId: run.id, stepId: 'step', name: 'change_propose', arguments: { ...proposal, experienceIds } });
      observations.push(observation); assert.equal(observation.kind, index < 3 ? 'error' : 'result');
      if (index < 3) assert.match(JSON.stringify(observation.value), /Experience unavailable to proposal scope/);
    }
    return { status: 'completed', observations };
  } });
  assert.equal(result.status, 'completed'); assert.equal(f.toolCalls(), 4); assert.equal(f.app.effects.unresolved(f.run.id).length, 0);
  assert.equal(f.app.store.list('release.changes').length, 1); assert.equal(f.rejectedMutations.length, 3);
  for (const mutation of f.rejectedMutations) assert.deepEqual(mutation.after, mutation.before, 'Prevalidation must not write an artifact or proposal');
  assert.deepEqual([0, 1, 2, 3].map(i => f.app.resources.request(`tool:proposal-${i}`)!.status), ['failed', 'failed', 'failed', 'succeeded']);
});

for (const self of [false, true]) test(`${self ? 'self' : 'human'} proposal enforces its exact empty-evidence policy`, async t => {
  const f = fixture(t, self);
  const result = await f.execute({ async run({ run }, bridge) {
    const first = await bridge.execute({ id: 'empty', runId: run.id, stepId: 'step', name: 'change_propose', arguments: { ...proposal, experienceIds: [] } });
    assert.equal(first.kind, self ? 'error' : 'result');
    const observations = [first];
    if (self) observations.push(await bridge.execute({ id: 'valid-self', runId: run.id, stepId: 'step', name: 'change_propose', arguments: proposal }));
    return { status: 'completed', observations };
  } });
  assert.equal(result.status, 'completed'); assert.equal(f.app.store.list('release.changes').length, 1);
  assert.equal(f.app.effects.unresolved(f.run.id).length, 0);
});

for (const phase of ['artifact', 'proposal'] as const) test(`a lost result after the actual ${phase} write remains uncertain and cannot replay`, async t => {
  const f = fixture(t, false, phase);
  const shell: ShellPort = { async run({ run }, bridge) { await bridge.execute({ id: 'lost', runId: run.id, stepId: 'step', name: 'change_propose', arguments: proposal }); throw Error('Uncertain effect must halt'); } };
  assert.equal((await f.execute(shell)).status, 'blocked'); assert.equal(f.app.store.list('release.changes').length, phase === 'proposal' ? 1 : 0);
  assert.equal(f.app.effects.get('tool:lost')!.status, 'uncertain'); assert.equal(f.app.resources.request('tool:lost')!.status, 'uncertain');
  assert.equal(f.app.runtime.observations(f.run.id).length, 0);
  assert.equal((await f.execute(shell)).status, 'blocked'); assert.equal(f.toolCalls(), 1);
  assert.notDeepEqual(f.rejectedMutations[0]!.after, f.rejectedMutations[0]!.before);
});
