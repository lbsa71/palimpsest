import { chmodSync, lstatSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { createConnection, createServer, type Server } from 'node:net';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invariant } from '../packages/contracts/index.ts';
import type { ReleaseProof } from '../packages/release/controller.ts';
import { freezeApplication, verifyApplication, type DeploymentInputs } from './candidate.ts';
import { environmentSecrets } from './config.ts';
import { contentAddressedEvidence, loadHostPolicy, readHostFile } from './host-policy.ts';
import type { HostBindings } from './materialize.ts';
import { ServiceSupervisor, type SupervisorCommand } from './supervisor.ts';

export interface SupervisorFile {
  host: HostBindings;
  mode: 'engineering' | 'product';
  evidenceDirectory: string;
  /** Digests and locations are configured by the host owner, never by release requests. */
  policyFiles: [string, string][];
  bootstrap?: { proofFile: string; policyDigest: string };
}
export function controlSocket(stateDirectory: string): string { return join(stateDirectory, 'host-control', 'supervisor.sock'); }
const maxMessageBytes = 8 * 1024 * 1024;
export async function serveControls(supervisor: ServiceSupervisor, stateDirectory: string): Promise<Server> {
  const directory = join(stateDirectory, 'host-control'); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  invariant(realpathSync(directory) === directory && stat.isDirectory() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, 'Control directory must be private to the host owner');
  const path = controlSocket(stateDirectory);
  try { const existing = lstatSync(path); invariant(existing.isSocket() && existing.uid === process.getuid?.(), 'Control socket location is occupied'); rmSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const server = createServer(socket => {
    socket.setTimeout(10000, () => socket.destroy());
    let bytes = 0, input = '', received = false;
    socket.on('error', () => {});
    socket.on('data', chunk => {
      if (received) { socket.destroy(); return; }
      bytes += chunk.length; if (bytes > maxMessageBytes) { socket.destroy(); return; }
      input += chunk.toString('utf8'); if (!input.includes('\n')) return;
      received = true; socket.setTimeout(0);
      void (async () => {
        try {
          invariant(input.endsWith('\n') && input.indexOf('\n') === input.length - 1, 'One JSON control request required');
          const command = JSON.parse(input) as SupervisorCommand;
          const fields: Record<string, string> = { status: 'kind', recover: 'kind', release: 'kind,proof', probation: 'kind,proof', 'stage-control': 'kind,policyDigest,proof', 'activate-control': 'kind,stageId' };
          invariant(command && Object.keys(command).sort().join(',') === fields[command.kind], 'Exact host control fields required');
          socket.end(JSON.stringify({ ok: true, result: await supervisor.command(command) }) + '\n');
        } catch (error) { socket.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Host operation failed' }) + '\n'); }
      })();
    });
  });
  try {
    await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(path, () => { server.off('error', reject); accept(); }); });
    chmodSync(path, 0o600);
    server.once('close', () => rmSync(path, { force: true }));
    return server;
  } catch (error) { server.close(); throw error; }
}
export async function requestControl(stateDirectory: string, command: SupervisorCommand): Promise<unknown> {
  invariant(isAbsolute(stateDirectory) && resolve(stateDirectory) === stateDirectory, 'Absolute host state directory required');
  return await new Promise((accept, reject) => {
    const socket = createConnection(controlSocket(stateDirectory)); let output = '', bytes = 0;
    socket.setTimeout(60000, () => socket.destroy(new Error('Host control deadline exceeded')));
    socket.once('error', reject);
    socket.once('connect', () => socket.write(JSON.stringify(command) + '\n'));
    socket.on('data', chunk => { bytes += chunk.length; if (bytes > maxMessageBytes) socket.destroy(new Error('Host control response too large')); else output += chunk.toString('utf8'); });
    socket.once('end', () => {
      try { const response = JSON.parse(output) as { ok: boolean; result?: unknown; error?: string }; if (!response.ok) throw new Error(response.error); accept(response.result); }
      catch (error) { reject(error); } finally { socket.destroy(); }
    });
  });
}
export async function runCli(args: string[]): Promise<void> {
  const [command, ...values] = args;
  const print = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
  const proof = (path: string) => JSON.parse(readHostFile(path).toString('utf8')) as ReleaseProof;
  if (command === 'freeze' && values.length === 3) {
    const [source, store, inputs] = values as [string, string, string];
    print(freezeApplication(source, store, JSON.parse(readHostFile(inputs).toString('utf8')) as DeploymentInputs).manifest); return;
  }
  if (command === 'inspect' && values.length === 3) {
    const [store, id, node] = values as [string, string, string]; print(verifyApplication(store, id, node).manifest); return;
  }
  if (command === 'supervise' && values.length === 1) {
    const config = JSON.parse(readHostFile(values[0]!).toString('utf8')) as SupervisorFile;
    invariant(Object.keys(config).sort().join(',') === (config.bootstrap ? 'bootstrap,evidenceDirectory,host,mode,policyFiles' : 'evidenceDirectory,host,mode,policyFiles'), 'Exact supervisor configuration fields required');
    invariant(Array.isArray(config.policyFiles) && config.policyFiles.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string')) && new Set(config.policyFiles.map(([id]) => id)).size === config.policyFiles.length, 'Exact configured policy registry required');
    const paths = new Map(config.policyFiles);
    const supervisor = await ServiceSupervisor.open({ host: config.host, mode: config.mode, secrets: environmentSecrets(process.env),
      readArtifact: contentAddressedEvidence(config.evidenceDirectory), getPolicy(digest) {
        const path = paths.get(digest); invariant(path, 'Policy digest is absent from the host registry');
        const policy = loadHostPolicy(path, [config.host.workspaceDirectory, config.host.artifactStore]); invariant(policy.policyDigest === digest, 'Host policy registry identity changed'); return policy;
      }, ...(config.bootstrap ? { bootstrap: () => ({ proof: proof(config.bootstrap!.proofFile), policyDigest: config.bootstrap!.policyDigest }) } : {}) });
    let server: Server;
    try { server = await serveControls(supervisor, config.host.stateDirectory); }
    catch (error) { await supervisor.close(); throw error; }
    print(supervisor.status());
    const stopped = new Promise<void>(accept => {
      const stop = () => { process.off('SIGTERM', stop); process.off('SIGINT', stop); accept(); };
      process.once('SIGTERM', stop); process.once('SIGINT', stop);
    });
    await stopped;
    const controlsClosed = new Promise<void>(accept => server.close(() => accept()));
    await supervisor.close(); await controlsClosed; return;
  }
  if ((command === 'status' || command === 'recover') && values.length === 1) { print(await requestControl(values[0]!, { kind: command })); return; }
  if ((command === 'release' || command === 'probation') && values.length === 2) { print(await requestControl(values[0]!, { kind: command, proof: proof(values[1]!) })); return; }
  if (command === 'stage-control' && values.length === 3) { print(await requestControl(values[0]!, { kind: command, proof: proof(values[1]!), policyDigest: values[2]! })); return; }
  if (command === 'activate-control' && values.length === 2) { print(await requestControl(values[0]!, { kind: command, stageId: values[1]! })); return; }
  throw new Error('Usage: cli.ts freeze SOURCE STORE INPUTS | inspect STORE ID NODE | supervise HOST_CONFIG | status STATE | recover STATE | release STATE PROOF | probation STATE PROOF | stage-control STATE PROOF POLICY_DIGEST | activate-control STATE STAGE_ID');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runCli(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : 'Host command failed'); process.exitCode = 1; });
}
