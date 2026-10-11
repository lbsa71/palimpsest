import { readdirSync, realpathSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { canonicalJson, identity, invariant, type JsonValue } from '../packages/contracts/index.ts';
import { freezeCandidate, verifyCandidate, inventoryCandidateSource, type FrozenCandidate } from '../packages/release/artifacts.ts';
import { rewriteSourceEntries } from './source-workspace.ts';
import type { ApplicationConfig } from './config.ts';
import type { ResourceLimits } from '../packages/supervisor/resource-limits.ts';
import { runtimeBundlePath, validateRuntime, verifyRuntimeFile, type RuntimeIdentity } from './runtime-bundle.ts';

export interface DeploymentInputs {
  configuration: Omit<ApplicationConfig, 'stateDirectory' | 'workspaceDirectory' | 'applicationRoot' | 'nodeBinary' | 'workerEntrypoint' | 'artifactId' | 'controlRevision' | 'promptFile' | 'compactionPromptFile' | 'resourceLimits'> & { resourceLimits?: Omit<ResourceLimits, 'cgroupRoot'> };
  prompts: { mind: string; compaction: string };
  runtime: RuntimeIdentity;
  policy: JsonValue;
  createdBy: string;
}
interface Entry { path: string; sha256: string }
/** Host-executed authority/effect/storage/admission code and its entire transitive library closure. */
function isControl(path: string): boolean {
  // The external dispatcher executes this prior-owned observation boundary on the host.
  if (path.startsWith('evaluations/offline-review/')) return !path.endsWith('.test.ts') && !path.endsWith('.md');
  if (path.startsWith('node_modules/')) return true;
  if (path.startsWith('deployment/')) return !path.startsWith('deployment/prompts/') && !path.endsWith('.test.ts');
  if (!path.startsWith('packages/')) return path === runtimeBundlePath || ['package.json', 'package-lock.json', 'tsconfig.json', 'AGENTS.md', 'REQUIREMENTS.md'].includes(path);
  if (path.endsWith('.test.ts') || path.includes('/test/') || path.endsWith('.md')) return false;
  // Even developmental APIs are host mutation receivers; changing their checks is a control change.
  return !path.startsWith('packages/agent-shell/vendor/pi/agent/');
}
export function deploymentEntries(sourceRoot: string, runtime?: RuntimeIdentity): string[] {
  const rootNames = new Set(readdirSync(sourceRoot));
  const source = rewriteSourceEntries.filter(path => rootNames.has(path.split('/')[0]!));
  // The source runtime needs no installed runtime packages; these are the explicitly retained check/build tools.
  const toolchain = ['node_modules/typescript', 'node_modules/@types/node', 'node_modules/undici-types', `node_modules/@typescript/typescript-${process.platform}-${process.arch}`];
  return [...source, ...toolchain, ...(runtime?.bundle ? [runtimeBundlePath] : [])];
}
export function freezeApplication(sourceRoot: string, artifactStore: string, inputs: DeploymentInputs): FrozenCandidate {
  validateRuntime(inputs.runtime);
  if (inputs.runtime.bundle) verifyRuntimeFile(sourceRoot, runtimeBundlePath, inputs.runtime);
  const entries = deploymentEntries(sourceRoot, inputs.runtime), files = inventoryCandidateSource(sourceRoot, entries).map(({ path, sha256 }) => ({ path, sha256 }));
  const nodeModules = files.filter(file => file.path.startsWith('node_modules/'));
  const forkFiles = files.filter(file => file.path.startsWith('packages/agent-shell/vendor/') || file.path.startsWith('packages/narrow-schema/vendor/'));
  const controls = { classifier: 'host-execution-closure-v1', files: files.filter(file => isControl(file.path)), runtime: inputs.runtime, policy: inputs.policy };
  const dependencies = { installedRuntime: [], lockfile: files.find(file => file.path === 'package-lock.json')!.sha256, retainedForks: forkFiles, checkBuildToolchain: nodeModules, runtime: inputs.runtime };
  const frozen = freezeCandidate(sourceRoot, artifactStore, entries, { dependencies: dependencies as unknown as JsonValue, prompts: inputs.prompts,
    model: inputs.configuration.model as unknown as JsonValue, configuration: inputs.configuration as unknown as JsonValue, controls: controls as unknown as JsonValue, createdBy: inputs.createdBy });
  const actualFiles = frozen.files.map(file => ({ path: file.path, sha256: file.sha256 }));
  invariant(identity(actualFiles) === identity(files), 'Source changed between execution-closure classification and freezing');
  return frozen;
}
/** Verify metadata against actual executable files, rather than accepting a candidate-authored category label. */
export function verifyApplication(artifactStore: string, candidateId: string, nodeBinary: string): FrozenCandidate {
  const frozen = verifyCandidate(artifactStore, candidateId);
  const controls = frozen.inputs.controls as unknown as { classifier: string; files: Entry[]; runtime: DeploymentInputs['runtime']; policy: JsonValue };
  invariant(controls.classifier === 'host-execution-closure-v1', 'Unrecognized deployment control classifier');
  const actualFiles = frozen.files.map(file => ({ path: file.path, sha256: file.sha256 }));
  invariant(identity(actualFiles.filter(file => isControl(file.path))) === identity(controls.files), 'Control declaration does not match the executable closure');
  validateRuntime(controls.runtime);
  const executable = candidateNodeBinary(frozen, artifactStore, nodeBinary);
  verifyRuntimeFile(dirname(executable), basename(executable), controls.runtime);
  if (realpathSync(executable) === realpathSync(process.execPath)) invariant(process.version === controls.runtime.nodeVersion, 'Running runtime version differs from frozen descriptor');
  if (controls.runtime.bundle) invariant(frozen.files.some(file => file.path === runtimeBundlePath && file.sha256 === controls.runtime.nodeSha256 && file.executable), 'Runtime bundle absent from executable closure');
  const dependencies = frozen.inputs.dependencies as unknown as { installedRuntime: unknown[]; lockfile: string; retainedForks: Entry[]; checkBuildToolchain: Entry[]; runtime: DeploymentInputs['runtime'] };
  invariant(dependencies.installedRuntime.length === 0 && canonicalJson(dependencies.runtime) === canonicalJson(controls.runtime), 'Unclassified runtime dependency');
  invariant(identity(dependencies.retainedForks) === identity(actualFiles.filter(file => file.path.startsWith('packages/agent-shell/vendor/') || file.path.startsWith('packages/narrow-schema/vendor/'))), 'Fork dependency declaration changed');
  invariant(identity(dependencies.checkBuildToolchain) === identity(actualFiles.filter(file => file.path.startsWith('node_modules/'))), 'Build toolchain declaration changed');
  invariant(actualFiles.find(file => file.path === 'package-lock.json')?.sha256 === dependencies.lockfile, 'Lockfile declaration changed');
  return frozen;
}

/** Call after verifyApplication. The fallback is used only by candidates without an explicit bundle. */
export function candidateNodeBinary(candidate: FrozenCandidate, artifactStore: string, fallbackNodeBinary: string): string {
  const runtime = (candidate.inputs.controls as unknown as { runtime: RuntimeIdentity }).runtime;
  validateRuntime(runtime);
  return runtime.bundle ? join(artifactStore, candidate.manifest.id, 'payload', runtimeBundlePath) : fallbackNodeBinary;
}
