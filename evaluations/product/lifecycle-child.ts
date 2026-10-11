import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AutarkApplication } from '../../deployment/application.ts';
import type { ApplicationConfig } from '../../deployment/config.ts';
import { identity, invariant, type Authority, type PhysicalRequest } from '../../packages/contracts/index.ts';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import { LocalLostReplyReceiver, lifecycleTransport, lifecycleWorkload, preparePublicFiles, type LifecycleCase, type LifecycleControl } from './lifecycle-fixtures.ts';
import { hash } from './adapter.ts';
import { publicScreenGateway, assertPublicAcquisitionAllowance, retainPublicResponse } from './public-screen-host.ts';
import { verifyApplication } from '../../deployment/candidate.ts';
import { materializeConfiguration, type HostBindings } from '../../deployment/materialize.ts';
import type { ApplicationSecrets } from '../../deployment/config.ts';
import { inertSnapshot } from '../qualification/manifest.ts';

interface Boot { config: ApplicationConfig; authority: Authority; caseId: LifecycleCase; control: LifecycleControl; phase: 0 | 1; receiverPath: string; attemptId: string }
interface LiveBoot extends Boot { kind: 'live-public-screen' | 'synthetic-host-composition'; host: HostBindings; secrets: ApplicationSecrets; limits: import('./public-screen-host.ts').PublicGatewayBounds }
/** Join the real turn, then execute an as-yet-unconsumed fixed correction once. */
export async function joinLifecycleCorrection(app: AutarkApplication, runId: string, correctionSequence: number) {
  await app.resume(runId);
  const consumed = app.store.get<{ messageSequence?: number }>('execution', runId)?.value.messageSequence ?? 0;
  if (consumed < correctionSequence && !['completed', 'cancelled'].includes(app.runtime.getRun(runId)!.status)) await app.resume(runId);
  return app.runtime.getRun(runId);
}
/** Dedicated fixed public process fixture, with no arbitrary operation or callback accepted over IPC. */
async function child() {
  invariant(process.send && process.argv.length === 3, 'Lifecycle child requires one host boot descriptor and IPC');
  const live = process.argv[2] === '--host-live';
  const boot = live ? inertSnapshot(await new Promise<LiveBoot>(resolve => process.once('message', value => resolve(value as LiveBoot)))) : JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Boot;
  if (live) {
    const startup = boot as LiveBoot; invariant(['live-public-screen', 'synthetic-host-composition'].includes(startup.kind) && startup.control === 'normal', 'Incomplete concrete protected host startup');
    const candidate = verifyApplication(startup.host.artifactStore, startup.config.artifactId, startup.host.nodeBinary), actual = materializeConfiguration(candidate, startup.host);
    invariant(identity(JSON.parse(JSON.stringify(actual))) === identity(startup.config) && candidate.manifest.controls === startup.authority.controlRevision && actual.resourceLimits, 'Protected startup differs from accepted candidate/configuration/kernel profile');
  }
  const production = live && (boot as LiveBoot).kind === 'live-public-screen';
  if (live && !production) invariant(boot.caseId === 'S08' && (boot as LiveBoot).secrets.mistralApiKey === 'PUBLIC-fixture-no-provider' && (boot as LiveBoot).secrets.directToken === 'PUBLIC-fixture-no-listener', 'Protected synthetic startup only admits the fixed public S08 fixture');
  const authorityStore = new AuthorityStore(join(boot.config.stateDirectory, 'authority.sqlite'));
  const receiver = boot.caseId === 'S11' ? new LocalLostReplyReceiver(boot.receiverPath) : undefined;
  const notify = (value: unknown) => process.send!(value as object);
  const transport = production ? publicScreenGateway(boot.config, (boot as LiveBoot).secrets, (boot as LiveBoot).limits) : lifecycleTransport({ ...boot, model: boot.config.model.id, actorId: boot.authority.generation, boundary: runId => notify({ type: 'boundary', runId, pid: process.pid, at: new Date().toISOString() }) });
  let app: AutarkApplication;
  authorityStore.assert(boot.authority);
  app = new AutarkApplication({ config: boot.config, authorityStore, authority: boot.authority, secrets: live ? (boot as LiveBoot).secrets : { mistralApiKey: 'PUBLIC-fixture-no-provider', directToken: 'PUBLIC-fixture-no-listener' },
    ...(receiver ? { slackBotApi: receiver, slackAppApi: { async call<T>(): Promise<T> { throw new Error('Local lifecycle fixture forbids socket API'); } } } : {}),
    performRequest: production ? transport : async (payload, signal) => {
      if (live) assertPublicAcquisitionAllowance(boot.config, (boot as LiveBoot).limits);
      const response = await transport(payload, signal);
      if (live) { retainPublicResponse(boot.config, (boot as LiveBoot).secrets, (boot as LiveBoot).limits, payload, response); return response; }
      app.store.put('screen.lifecycle-provider-responses', hash(payload), { requestSha256: hash(payload), response: app.store.putArtifact(response.body), httpStatus: response.status, recordedAt: new Date().toISOString(), actor: 'host-public-fixture-transport' }, null);
      return response;
    } });
  const receive = (externalId: string, revision: string, prompt: string) => app.communications.receive({ source: 'direct', externalId, conversation: externalId, revision, text: prompt, actor: { id: boot.config.direct.actorId, scope: boot.config.direct.scope, modificationEligible: false } }).run;
  let closing = false;
  const liveTurns = new Map<string, ReturnType<AutarkApplication['resume']>>();
  process.on('message', message => { void (async () => {
    const command = message as { type: string; id: number; externalId?: string };
    invariant(!closing && Number.isSafeInteger(command.id), 'Invalid lifecycle command');
    if (command.type === 'start') {
      invariant(command.externalId === boot.attemptId || command.externalId === `${boot.attemptId}-plain-old` || command.externalId === `${boot.attemptId}-plain-current`, 'Undeclared public task');
      let run;
      if (receiver) run = app.slackIngress!.acceptHistory('LOCAL-C1', { ts: '10', user: 'LOCAL-HUMAN', text: lifecycleWorkload(boot.caseId).prompt })!.run;
      else run = receive(command.externalId!, '1', command.externalId!.includes('plain') ? 'PUBLIC plain prompt-profile observation; finish without tools.' : lifecycleWorkload(boot.caseId).prompt);
      const preparation = !receiver && !command.externalId!.includes('plain') ? preparePublicFiles(boot.config, run.id, boot.caseId) : null;
      invariant(app.runtime.getRun(run.id)?.status === 'ready', 'Public preparation raced first dispatch');
      app.store.put('screen.lifecycle-attempts', command.externalId!, { caseId: boot.caseId, attemptId: boot.attemptId, runId: run.id, publicPreparation: preparation, at: new Date().toISOString() }, null);
      if (live) { const turn = app.resume(run.id); liveTurns.set(run.id, turn); if (command.externalId!.includes('plain')) await turn; }
      notify({ type: 'reply', id: command.id, runId: run.id, preparation });
    } else if (command.type === 'correct') {
      invariant(command.externalId === boot.attemptId && boot.caseId !== 'S11', 'Correction only targets fixed declared conversation');
      const run = receive(boot.attemptId, '2', 'Authenticated revision-two correction: write value9, verify it and finish the public lifecycle task.');
      const steering = app.store.events(run.id).findLast(event => event.type === 'steering');
      invariant(steering, 'Authenticated correction lacks its durable steering event');
      // resume() joins the actual active turn. In the same-process control that can
      // still be the old, aborted held turn; execute the unconsumed correction once.
      const joined = joinLifecycleCorrection(app, run.id, steering.sequence); if (live) liveTurns.set(run.id, joined as ReturnType<AutarkApplication['resume']>);
      const result = await joined;
      // A checkpoint can advance messageSequence while work is still running. The
      // IPC barrier therefore follows the real resume promise, never just a row.
      notify({ type: 'reply', id: command.id, runId: run.id, correctionSequence: steering.sequence, result });
    } else if (command.type === 'join') {
      invariant(live && command.externalId === boot.attemptId, 'Only fixed live parent turn may be joined');
      const attempt = app.store.get<{ runId: string }>('screen.lifecycle-attempts', boot.attemptId)?.value;
      const runId = attempt?.runId;
      invariant(runId && liveTurns.has(runId), 'Actual original live turn unavailable');
      const result = await liveTurns.get(runId); notify({ type: 'reply', id: command.id, runId, result });
    } else if (command.type === 'reconcile') {
      invariant(receiver && boot.caseId === 'S11', 'Local reconciliation unavailable for this case');
      const attempt = app.store.get<{ runId: string }>('screen.lifecycle-attempts', boot.attemptId)!.value;
      const unresolved = app.effects.unresolved(attempt.runId); invariant(unresolved.length === 1 && unresolved[0]!.status === 'uncertain', 'Expected exactly one actual uncertain delivery');
      await app.resume(attempt.runId); // join any finishing blocked turn; unresolved effect prevents dispatch
      const before = unresolved[0]!, id = `lifecycle-reconcile:${before.id}`;
      const request: PhysicalRequest = { id, runId: attempt.runId, purpose: 'review', provider: 'local-reconciliation', model: 'none', promptManifestId: 'host-lifecycle-reconcile', requestDigest: identity({ effectId: before.id, receiver: 'fixed-local-durable-sqlite' }), reservationId: id, status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
      authorityStore.assert(boot.authority); app.resources.reserve(request); app.resources.dispatched({ ...request, status: 'dispatched' });
      const began = performance.now(); let reconciled;
      try { reconciled = await app.effects.reconcile(before.id, boot.authority); app.resources.settle({ ...request, status: reconciled.status === 'succeeded' ? 'succeeded' : 'failed', usage: { ...request.usage, elapsedMs: performance.now() - began } }); }
      catch (error) { app.resources.settle({ ...request, status: 'uncertain', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: performance.now() - began } }); throw error; }
      invariant(reconciled.status === 'succeeded', 'Durable local receipt was not reconciled');
      app.store.put('screen.lifecycle-reconciliation', before.id, { actor: 'host-evaluator', before, reconciled, physicalRequest: app.resources.request(id), at: new Date().toISOString(), localOnly: true }, null);
      app.runtime.adopt(attempt.runId, boot.authority); const turn = app.resume(attempt.runId); if (live) liveTurns.set(attempt.runId, turn); await turn;
      notify({ type: 'reply', id: command.id, runId: attempt.runId, before, reconciled, receiverRows: receiver.rows(), receiverCalls: receiver.calls() });
    } else if (command.type === 'stop') {
      closing = true; await app.close(); receiver?.close(); authorityStore.close(); notify({ type: 'reply', id: command.id, stopped: true }); process.disconnect();
    } else throw new Error('Lifecycle child rejects undeclared host operation');
  })().catch(error => { notify({ type: 'error', id: (message as any)?.id, failure: error instanceof Error ? error.stack : String(error) }); process.exitCode = 1; }); });
  notify({ type: 'ready', pid: process.pid, artifactId: app.config.artifactId, authority: boot.authority, at: new Date().toISOString() });
}
if (process.send) void child().catch(error => { process.send!({ type: 'fatal', failure: error instanceof Error ? error.stack : String(error) }); process.exitCode = 1; process.disconnect(); });
