import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { identity, invariant } from '../packages/contracts/index.ts';
import type { FrozenCandidate } from '../packages/release/artifacts.ts';
import { beneath, validateConfiguration, type ApplicationConfig } from './config.ts';
import type { DeploymentInputs } from './candidate.ts';

export interface HostBindings { stateDirectory: string; workspaceDirectory: string; artifactStore: string; nodeBinary: string; cgroupRoot?: string }
/** Physical paths and credentials never come from model output or mutable candidate source. */
export function materializeConfiguration(candidate: FrozenCandidate, host: HostBindings): ApplicationConfig {
  for (const path of Object.values(host)) invariant(path === resolve(path) && realpathSync(path) === path, 'Canonical existing host bindings required');
  for (const a of [host.stateDirectory, host.workspaceDirectory, host.artifactStore]) for (const b of [host.stateDirectory, host.workspaceDirectory, host.artifactStore]) if (a !== b) invariant(!beneath(a, b), 'Host state, source artifacts and workspaces must be disjoint');
  invariant(new Set([host.stateDirectory, host.workspaceDirectory, host.artifactStore]).size === 3, 'Host state, source artifacts and workspaces must be distinct');
  const prompts = candidate.inputs.prompts as unknown as DeploymentInputs['prompts'];
  invariant(typeof prompts?.mind === 'string' && typeof prompts.compaction === 'string' && Object.keys(prompts).sort().join(',') === 'compaction,mind', 'Exact frozen prompt payload required');
  invariant(identity(prompts) === candidate.manifest.prompts, 'Frozen prompt identity mismatch');
  invariant(identity(candidate.inputs.configuration) === candidate.manifest.configuration, 'Frozen configuration identity mismatch');
  const promptRoot = join(host.stateDirectory, 'prompt-materializations', candidate.manifest.prompts);
  let directory = openSync(host.stateDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const name of ['prompt-materializations', candidate.manifest.prompts]) {
      const path = `/proc/self/fd/${directory}/${name}`;
      try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const next = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      closeSync(directory); directory = next;
    }
    for (const name of ['mind', 'compaction'] as const) {
      const content = Buffer.from(prompts[name]), path = `/proc/self/fd/${directory}/${name}.txt`;
      let fd: number;
      try { fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
        catch { throw new Error('Frozen prompt materialization changed'); }
        try {
          const stat = fstatSync(fd, { bigint: true });
          invariant(stat.isFile() && stat.nlink === 1n && stat.size === BigInt(content.length), 'Frozen prompt materialization changed');
          const actual = Buffer.alloc(content.length); let offset = 0;
          while (offset < actual.length) { const count = readSync(fd, actual, offset, actual.length - offset, offset); invariant(count > 0, 'Frozen prompt materialization changed'); offset += count; }
          const after = fstatSync(fd, { bigint: true });
          invariant(readSync(fd, Buffer.alloc(1), 0, 1, content.length) === 0 && actual.equals(content) && after.nlink === 1n && after.size === stat.size && after.mtimeNs === stat.mtimeNs && after.ctimeNs === stat.ctimeNs, 'Frozen prompt materialization changed');
        } finally { closeSync(fd); }
        continue;
      }
      try { writeFileSync(fd, content); } finally { closeSync(fd); }
    }
  } finally { closeSync(directory); }
  const logical = candidate.inputs.configuration as unknown as DeploymentInputs['configuration'];
  invariant(identity(logical.model) === candidate.manifest.model, 'Configuration model differs from frozen profile');
  invariant(!logical.resourceLimits || host.cgroupRoot, 'Frozen kernel resource ceilings require a physical host delegation');
  const payload = join(host.artifactStore, candidate.manifest.id, 'payload');
  invariant(candidate.files.some(file => file.path === 'deployment/shell-worker.ts'), 'Frozen worker entrypoint absent');
  return validateConfiguration({ ...logical, resourceLimits: logical.resourceLimits ? { ...logical.resourceLimits, cgroupRoot: host.cgroupRoot! } : undefined, stateDirectory: host.stateDirectory, workspaceDirectory: host.workspaceDirectory, applicationRoot: payload, nodeBinary: host.nodeBinary,
    workerEntrypoint: 'deployment/shell-worker.ts', artifactId: candidate.manifest.id, controlRevision: candidate.manifest.controls,
    promptFile: join(promptRoot, 'mind.txt'), compactionPromptFile: join(promptRoot, 'compaction.txt') });
}
