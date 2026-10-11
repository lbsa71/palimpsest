import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { join } from 'node:path';
import { AutarkApplication } from './application.ts';
import { verifyApplication } from './candidate.ts';
import { materializeConfiguration, type HostBindings } from './materialize.ts';
import type { ApplicationSecrets } from './config.ts';
import type { Authority } from '../packages/contracts/index.ts';
import { sourceWorkspaceTools } from './source-workspace.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import { assertResourceConfinement, initializeResourceDelegation } from '../packages/supervisor/resource-limits.ts';
import { invariant } from '../packages/contracts/index.ts';

let app: AutarkApplication | undefined; let authorityStore: AuthorityStore | undefined; let lease: ProcessLease | undefined; let starting = false; let closing: Promise<void> | undefined;
function close(): Promise<void> { return closing ??= (async () => { try { await app?.close(); } finally { lease?.close(); authorityStore?.close(); if (process.connected) process.disconnect?.(); } })(); }
process.on('message', (message: { kind: string; mode?: 'engineering' | 'product'; bindings?: HostBindings; candidateId?: string; authority?: Authority; secrets?: ApplicationSecrets }) => {
  if (message.kind === 'stop') { void close().catch(() => { process.exitCode = 1; process.disconnect?.(); }); return; }
  if (message.kind !== 'start' || starting) { process.exitCode = 1; process.disconnect?.(); return; }
  starting = true;
  void (async () => {
    if (!message.bindings || !message.candidateId || !message.authority || !message.secrets || !['engineering', 'product'].includes(message.mode ?? '')) throw new Error('Incomplete host startup');
    const candidate = verifyApplication(message.bindings.artifactStore, message.candidateId, message.bindings.nodeBinary);
    const config = materializeConfiguration(candidate, message.bindings);
    authorityStore = new AuthorityStore(join(config.stateDirectory, 'authority.sqlite'));
    authorityStore.assert(message.authority);
    invariant(message.mode === 'engineering' || config.resourceLimits, 'Product startup requires enforced kernel resource ceilings');
    lease = new ProcessLease(join(config.stateDirectory, 'process-lease.sqlite'));
    if (config.resourceLimits) { await initializeResourceDelegation(config.resourceLimits.cgroupRoot); assertResourceConfinement(config.workspaceDirectory, config.resourceLimits); }
    invariant(!closing, 'Application stopped during startup');
    app = new AutarkApplication({ config, secrets: message.secrets, authority: message.authority, authorityStore, lease,
      additionalTools: context => sourceWorkspaceTools({ applicationRoot: config.applicationRoot, workspace: context.workspace, protectedPaths: [config.stateDirectory], nodeBinary: config.nodeBinary, maxFiles: 10000, maxBytes: 50_000_000, timeoutMs: 30000, resourceLimits: config.resourceLimits }) });
    await app.start(); if (!closing && process.connected) process.send?.({ kind: 'ready', candidateId: candidate.manifest.id, authority: message.authority, address: app.directApi.address() });
  })().catch(async (error: unknown) => { console.error(error instanceof Error ? error.stack : 'Frozen application startup failed'); if (process.connected) process.send?.({ kind: 'unavailable', reason: 'Frozen application startup failed; inspect private host readiness evidence' }); await close().catch(() => {}); process.exitCode = 1; });
});
process.once('disconnect', () => { void close().catch(() => {}); });
process.once('SIGTERM', () => { void close().catch(() => {}); });
