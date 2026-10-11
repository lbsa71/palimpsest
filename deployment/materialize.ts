import { lstatSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
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
  const promptRoot = join(host.stateDirectory, 'prompt-materializations', candidate.manifest.prompts); mkdirSync(promptRoot, { recursive: true, mode: 0o700 });
  invariant(realpathSync(promptRoot) === promptRoot, 'Prompt materialization must not traverse links');
  for (const name of ['mind', 'compaction'] as const) {
    const content = prompts[name];
    const path = join(promptRoot, `${name}.txt`);
    try { writeFileSync(path, content, { flag: 'wx', mode: 0o400 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; const stat = lstatSync(path); invariant(stat.isFile() && stat.nlink === 1 && !stat.isSymbolicLink() && readFileSync(path, 'utf8') === content, 'Frozen prompt materialization changed'); }
  }
  const logical = candidate.inputs.configuration as unknown as DeploymentInputs['configuration'];
  invariant(identity(logical.model) === candidate.manifest.model, 'Configuration model differs from frozen profile');
  invariant(!logical.resourceLimits || host.cgroupRoot, 'Frozen kernel resource ceilings require a physical host delegation');
  const payload = join(host.artifactStore, candidate.manifest.id, 'payload');
  invariant(candidate.files.some(file => file.path === 'deployment/shell-worker.ts'), 'Frozen worker entrypoint absent');
  return validateConfiguration({ ...logical, resourceLimits: logical.resourceLimits ? { ...logical.resourceLimits, cgroupRoot: host.cgroupRoot! } : undefined, stateDirectory: host.stateDirectory, workspaceDirectory: host.workspaceDirectory, applicationRoot: payload, nodeBinary: host.nodeBinary,
    workerEntrypoint: 'deployment/shell-worker.ts', artifactId: candidate.manifest.id, controlRevision: candidate.manifest.controls,
    promptFile: join(promptRoot, 'mind.txt'), compactionPromptFile: join(promptRoot, 'compaction.txt') });
}
