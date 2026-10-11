import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomInt } from 'node:crypto';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import { environmentSecrets, readConfiguration } from '../../deployment/config.ts';
import { assertPrivateRoot, hash, runApplicationCase, type AdapterOptions, type PublicTask } from './adapter.ts';
import { boundedCodingFixture, fixtureConfiguration } from './fixture.ts';
import { evaluateCoding } from './coding-evaluator.ts';

const applicationRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
function manifests() {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: applicationRoot, encoding: 'utf8' }).split('\0').filter(Boolean).filter(file => /^(packages|deployment)\//.test(file) || ['package.json', 'package-lock.json'].includes(file));
  return { source: hash(JSON.stringify(files.map(file => [file, hash(readFileSync(join(applicationRoot, file), 'utf8'))]))), dependencies: hash(readFileSync(join(applicationRoot, 'package-lock.json'), 'utf8')), protocol: hash(readFileSync(join(applicationRoot, 'docs/rewrite/evaluation/protocol.md'), 'utf8')) };
}
export async function runFixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-product-evaluation-'));
  const privateRoot = mkdtempSync(join(tmpdir(), 'aeon-private-evaluation-'));
  const config = fixtureConfiguration(root, applicationRoot);
  const authorityStore = new AuthorityStore(join(config.stateDirectory, 'authority.sqlite'));
  const authority = authorityStore.bootstrap('evaluation-fixture', config.controlRevision, config.artifactId);
  const task: PublicTask = { id: 'actual-coding-fixture-v2', prompt: 'Create sum.mjs accepting two signed integer command-line arguments and printing their sum. Run a check, repair any observed failure, and report the verified result.' };
  const inputs: [number, number][] = [[0, 0], [-1, 1], [randomInt(-10000, -2), randomInt(2, 10000)]];
  const privatePacket = JSON.stringify({ task, inputs }); writeFileSync(join(privateRoot, 'case.json'), privatePacket, { mode: 0o600 });
  try {
    const report = await runApplicationCase({ application: { config, secrets: { mistralApiKey: 'fixture-only-no-provider-access', directToken: 'fixture-direct-token' }, authorityStore, authority, performRequest: boundedCodingFixture() }, task, mode: 'integration',
      observer: { id: 'L08-author-integration', privateRoot, evaluatorDigest: hash(readFileSync(new URL('./coding-evaluator.ts', import.meta.url), 'utf8')), taskDigest: hash(privatePacket) }, manifest: manifests(), timeoutMs: 60000,
      evaluate: observation => evaluateCoding(observation, inputs, [privateRoot, config.applicationRoot, config.stateDirectory]) });
    return { ...report, provenance: { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: applicationRoot, encoding: 'utf8' }).trim(), runner: hash(readFileSync(new URL(import.meta.url), 'utf8')), fixture: hash(readFileSync(new URL('./fixture.ts', import.meta.url), 'utf8')) } };
  } finally { authorityStore.close(); rmSync(root, { recursive: true, force: true }); rmSync(privateRoot, { recursive: true, force: true }); }
}

/** Explicit live entry, unused in the engineering handoff. Grants and observer trust come from L09. */
async function runLive(specificationPath: string) {
  const spec = JSON.parse(readFileSync(specificationPath, 'utf8')) as { configurationFile: string; privateRoot: string; caseFile: string; evaluatorModule: string; observerId: string; timeoutMs: number; liveSeal: AdapterOptions['liveSeal'] };
  const config = readConfiguration(spec.configurationFile);
  if (config.applicationRoot !== applicationRoot) throw new Error('Runner and application must use the same frozen checkout');
  assertPrivateRoot(spec.privateRoot, [config.applicationRoot, config.workspaceDirectory, config.stateDirectory]);
  for (const path of [spec.caseFile, spec.evaluatorModule]) {
    if (!realpathSync(path).startsWith(`${spec.privateRoot}/`)) throw new Error('Private case and evaluator must stay outside candidate mounts');
  }
  const packet = readFileSync(spec.caseFile, 'utf8');
  const task = JSON.parse(packet) as PublicTask;
  const evaluator = await import(pathToFileURL(spec.evaluatorModule).href) as { evaluate: AdapterOptions['evaluate'] };
  if (typeof evaluator.evaluate !== 'function') throw new Error('External evaluator must export evaluate(observation)');
  const authorityStore = new AuthorityStore(join(config.stateDirectory, 'authority.sqlite'));
  try {
    const current = authorityStore.current();
    if (!current?.generation) throw new Error('Live evaluation requires host-issued application authority; runner does not bootstrap it');
    return await runApplicationCase({ application: { config, secrets: environmentSecrets(process.env), authorityStore, authority: { generation: current.generation, controlRevision: current.controlRevision, epoch: current.epoch } },
      task: { id: task.id, prompt: task.prompt }, mode: 'live-product', observer: { id: spec.observerId, privateRoot: spec.privateRoot, evaluatorDigest: hash(readFileSync(spec.evaluatorModule, 'utf8')), taskDigest: hash(packet) }, manifest: manifests(), timeoutMs: spec.timeoutMs, liveSeal: spec.liveSeal, evaluate: evaluator.evaluate });
  } finally { authorityStore.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, destination, spec] = process.argv.slice(2);
  if (!destination || !['--fixture', '--live'].includes(mode) || mode === '--live' && !spec) throw new Error('Usage: node evaluations/product/run.ts --fixture OUTPUT.json | --live OUTPUT.json PRIVATE-SPEC.json');
  const report = mode === '--fixture' ? await runFixture() : await runLive(spec!);
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  if (report.verdict !== 'case-pass') process.exitCode = 1;
}
