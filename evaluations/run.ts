import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { digest, runScreen } from './execution/screen.ts';
import { referenceActor } from './execution/reference-actor.ts';
import { mechanicalReport } from './report.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name: string) => readFile(new URL(name, import.meta.url), 'utf8');
const protocol = await read('protocol.json');
const protocolProse = await read('../docs/rewrite/evaluation/protocol.md');
const workload = await read('execution/screen.ts');
const evaluator = await read('report.ts');
const actor = await read('execution/reference-actor.ts');
const seed = 7021;
const start = performance.now();
const results = await runScreen(referenceActor, seed);
const report = mechanicalReport({ protocol: digest([protocol, protocolProse]), workload: digest(workload), evaluatorArtifact: digest([workload, evaluator]),
  candidate: { source: digest(actor), dependencies: null, prompts: null, model: null, configuration: digest({ seed, actor: 'scripted-reference' }) },
  evaluatorId: 'A1-L08-author-conformance' }, results, performance.now() - start);
const output = { ...report, provenance: { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), frozenProtocolRevision: '20a4159', runnerDigest: digest(await read('run.ts')) } };
const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (process.argv[2]) await writeFile(process.argv[2], serialized, { flag: 'wx' });
else process.stdout.write(serialized);
if (report.verdict !== 'pass') process.exitCode = 1;
