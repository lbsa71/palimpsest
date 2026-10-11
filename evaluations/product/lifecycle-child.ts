import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AutarkApplication } from '../../deployment/application.ts';
import type { ApplicationConfig } from '../../deployment/config.ts';
import { identity, invariant, type Authority, type PhysicalRequest } from '../../packages/contracts/index.ts';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import { LocalLostReplyReceiver, lifecycleTransport, lifecycleWorkload, preparePublicFiles, type LifecycleCase, type LifecycleControl } from './lifecycle-fixtures.ts';

interface Boot { config: ApplicationConfig; authority: Authority; caseId: LifecycleCase; control: LifecycleControl; phase: 0 | 1; receiverPath: string; attemptId: string }
/** Dedicated fixed public process fixture, with no arbitrary operation or callback accepted over IPC. */
async function child() {
  invariant(process.send && process.argv.length === 3, 'Lifecycle child requires one host boot descriptor and IPC');
  const boot = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Boot;
  const authorityStore = new AuthorityStore(join(boot.config.stateDirectory, 'authority.sqlite'));
  const receiver = boot.caseId === 'S11' ? new LocalLostReplyReceiver(boot.receiverPath) : undefined;
  const notify = (value: unknown) => process.send!(value as object);
  const app = new AutarkApplication({ config: boot.config, authorityStore, authority: boot.authority, secrets: { mistralApiKey: 'PUBLIC-fixture-no-provider', directToken: 'PUBLIC-fixture-no-listener' },
    ...(receiver ? { slackBotApi: receiver, slackAppApi: { async call<T>(): Promise<T> { throw new Error('Local lifecycle fixture forbids socket API'); } } } : {}),
    performRequest: lifecycleTransport({ ...boot, model: boot.config.model.id, actorId: boot.authority.generation, boundary: runId => notify({ type: 'boundary', runId, pid: process.pid, at: new Date().toISOString() }) }) });
  const receive = (externalId: string, revision: string, prompt: string) => app.communications.receive({ source: 'direct', externalId, conversation: externalId, revision, text: prompt, actor: { id: boot.config.direct.actorId, scope: boot.config.direct.scope, modificationEligible: false } }).run;
  let closing = false;
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
      notify({ type: 'reply', id: command.id, runId: run.id, preparation });
    } else if (command.type === 'correct') {
      invariant(command.externalId === boot.attemptId && boot.caseId !== 'S11', 'Correction only targets fixed declared conversation');
      const run = receive(boot.attemptId, '2', 'Authenticated revision-two correction: write value9, verify it and finish the public lifecycle task.');
      notify({ type: 'reply', id: command.id, runId: run.id });
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
      app.runtime.adopt(attempt.runId, boot.authority); await app.resume(attempt.runId);
      notify({ type: 'reply', id: command.id, runId: attempt.runId, before, reconciled, receiverRows: receiver.rows(), receiverCalls: receiver.calls() });
    } else if (command.type === 'stop') {
      closing = true; await app.close(); receiver?.close(); authorityStore.close(); notify({ type: 'reply', id: command.id, stopped: true }); process.disconnect();
    } else throw new Error('Lifecycle child rejects undeclared host operation');
  })().catch(error => { notify({ type: 'error', id: (message as any)?.id, failure: error instanceof Error ? error.stack : String(error) }); process.exitCode = 1; }); });
  notify({ type: 'ready', pid: process.pid, artifactId: app.config.artifactId, authority: boot.authority, at: new Date().toISOString() });
}
if (process.send) void child().catch(error => { process.send!({ type: 'fatal', failure: error instanceof Error ? error.stack : String(error) }); process.exitCode = 1; process.disconnect(); });
