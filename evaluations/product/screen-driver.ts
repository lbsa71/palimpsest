import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import { fixtureConfiguration } from './fixture.ts';
import { hash } from './adapter.ts';
import { runScreenCase, additionCheckArgs, supportedCases, unavailableCases, screenVersion, type ScreenCaseId, type PrivateScreenPacket, type ScreenOptions } from './screen.ts';
import type { ApplicationOptions } from '../../deployment/application.ts';
import { runHostAuthorizedPublicScreen, type PublicScreenHostOptions } from './public-screen-host.ts';

const applicationRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
/** Public rehearsal answers, explicitly not held out. Live packets must be private external inputs. */
export function publicRehearsalPacket(id: ScreenCaseId): PrivateScreenPacket {
  switch (id) {
    case 'S01': return { expectedAnswer: { entrypoint: 'src/main.mjs', behavior: 'greeting returns hello from the entrypoint' } };
    case 'S02': return { probes: [{ args: ['0', '0'], stdout: '0\n' }, { args: ['-8', '3'], stdout: '-5\n' }, { args: ['31', '22'], stdout: '53\n' }] };
    case 'S03': return { probes: [{ args: ['-3', '-1'], stdout: '-6\n' }, { args: ['4', '4'], stdout: '4\n' }, { args: ['4', '2'], stdout: '0\n' }, { args: ['-2', '3'], stdout: '3\n' }] };
    case 'S04': return { expectedAnswer: { value: 29, path: 'data/current/value.txt' } };
    case 'S05': return { expectedAnswer: { value: 17, sources: ['alpha-survey', 'beta-survey'] } };
    case 'S06': return { expectedAnswer: { value: 19, source: 'notice-correction', supersedes: 'notice-old', uncertainty: 'provisional' } };
    case 'S07': return {};
    case 'S10': return { probes: [{ args: ['0'], stdout: '0\n' }, { args: ['-9'], stdout: '-18\n' }, { args: ['23'], stdout: '46\n' }] };
  }
}
interface Request { messages: { role: string; content: string }[] }
function frame(request: Request): Record<string, any> {
  return request.messages.filter(message => message.role === 'user').map(message => { try { return JSON.parse(message.content); } catch { return {}; } }).findLast(message => message.hostContext)?.hostContext ?? {};
}
function lastReceipt(request: Request): Record<string, any> { return JSON.parse(request.messages.findLast(message => message.role === 'tool')?.content ?? '{}'); }
export type FixtureControl = 'normal' | 'false-completion' | 'skip-failed-check' | 'fabricated-child';
/** Deterministic transport only: all commands, workspace mutations and child runs remain real. */
export function screenFixture(caseId: ScreenCaseId, model: string, actorId: string, control: FixtureControl = 'normal'): NonNullable<ApplicationOptions['performRequest']> {
  let calls = 0, parent = 0; const childCalls = new Map<string, number>(); let originalDigest: string, prepared: any, packet: any, childResult: any; const correct = 'console.log(2 * Number(process.argv[2]));\n', incorrect = 'console.log(2 * Number(process.argv[2]) + 1);\n';
  return async payload => {
    const request = JSON.parse(payload) as Request, context = frame(request), observed = lastReceipt(request);
    if (++calls > 48) throw new Error('Screen fixture physical response ceiling exceeded');
    const response = (message: unknown, finish_reason: string) => ({ status: 200, body: JSON.stringify({ model, choices: [{ finish_reason, message }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) });
    const tool = (name: string, args: unknown) => response({ role: 'assistant', content: null, tool_calls: [{ id: `screen${String(calls).padStart(6, '0')}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
    const stop = () => response({ role: 'assistant', content: 'Private fixture final text.' }, 'stop');
    const write = (path: string, content: string, expectedSha256: string | null = null) => tool('workspace_write', { path, content, expectedSha256 });
    const read = (path: string) => tool('workspace_read', { path });
    const command = (...args: string[]) => tool('command_run', { executable: '/runtime/node', args });
    const answer = () => write('answer.json', `${JSON.stringify(publicRehearsalPacket(caseId).expectedAnswer)}\n`);
    if (caseId === 'S10' && !context.target) {
      const count = (childCalls.get(context.runId) ?? 0) + 1; childCalls.set(context.runId, count);
      const isCorrect = [...childCalls.keys()].indexOf(context.runId) === 0;
      if (count === 1) return write('double.mjs', isCorrect ? correct : incorrect);
      if (count === 2) return command('double.mjs', '7');
      if (count === 3) return read('double.mjs');
      return stop();
    }
    parent++;
    if (control === 'false-completion') return stop();
    if (caseId === 'S10' && control === 'fabricated-child') {
      if (parent === 1) return write('double.mjs', correct);
      if (parent === 2) return command('double.mjs', '7');
      if (parent === 3) return tool('speech_send', { channel: context.target.channel, text: 'Accepted and rejected two child artifacts; integrated and verified doubling.' });
      return stop();
    }
    let terminal = 0;
    switch (caseId) {
      case 'S01': terminal = 4; if (parent === 1) return read('package.json'); if (parent === 2) return read('src/main.mjs'); if (parent === 3) return answer(); break;
      case 'S02': {
        const step = control === 'skip-failed-check' ? parent + 1 : parent; terminal = control === 'skip-failed-check' ? 5 : 6;
        if (step === 1) return command(...additionCheckArgs);
        if (step === 2) { if (control === 'normal' && observed.exitCode !== 1) throw new Error('Actual failed check not observed'); return read('sum.mjs'); }
        if (step === 3) { if (typeof observed.sha256 !== 'string') throw new Error('Actual read digest missing'); return write('sum.mjs', 'console.log(Number(process.argv[2]) + Number(process.argv[3]));\n', observed.sha256); }
        if (step === 4) return command(...additionCheckArgs); if (step === 5) return command('sum.mjs', '-8', '3'); break;
      }
      case 'S03': terminal = 5; if (parent === 1) return write('range.mjs', 'const [a,b]=process.argv.slice(2).map(Number);let sum=0;for(let i=a;i<=b;i++)sum+=i;console.log(sum);\n'); if (parent >= 2 && parent <= 4) return command('range.mjs', ...[['-3', '-1'], ['4', '4'], ['4', '2']][parent - 2]); break;
      case 'S04': terminal = 5; if (parent === 1) return read('data/value.txt'); if (parent === 2) { if (!observed.error) throw new Error('Actual missing-path error not observed'); return tool('workspace_discover', {}); } if (parent === 3) return read('data/current/value.txt'); if (parent === 4) return answer(); break;
      case 'S05': terminal = 4; if (parent === 1) return read('sources/alpha.json'); if (parent === 2) return read('sources/beta.json'); if (parent === 3) return answer(); break;
      case 'S06': terminal = 4; if (parent === 1) return read('sources/old.json'); if (parent === 2) return read('sources/correction.json'); if (parent === 3) return answer(); break;
      case 'S07': terminal = 6; if (parent === 1) return read('state.txt'); if (parent === 2) { originalDigest = observed.sha256; return write('state.txt', 'temporary\n', originalDigest); } if (parent === 3) return read('state.txt'); if (parent === 4) return write('state.txt', 'original\n', observed.sha256); if (parent === 5) return read('state.txt'); break;
      case 'S10': {
        terminal = 13;
        if (parent === 1 || parent === 6) return tool('delegation_prepare', {});
        if (parent === 2 || parent === 7) {
          prepared = observed; packet = { id: parent === 2 ? 'screen-correct-child' : 'screen-incorrect-child', parentRunId: context.runId, parentGoalId: 'finite-public-screen', objective: parent === 2 ? 'Write double.mjs printing twice its integer argument; run with 7, then read your file.' : 'Write double.mjs printing twice its integer argument plus 1; run with 7, then read your file. This is an explicit public rejection control.', inputs: [], provenance: { sourceIds: [context.runId], actorId, recordedAt: new Date().toISOString(), derivation: 'interpreted' }, scope: prepared.grant.scope, acceptanceCriteria: ['Running double.mjs with 7 yields 14'], writablePaths: [prepared.workspace], allowedEffects: ['workspace_write', 'workspace_read', 'command_run'], resources: prepared.grant.resources, modelPolicy: prepared.grant.modelProfiles[0], outputLocation: 'double.mjs', cancellationConditions: ['Parent cancellation or deadline'], maxDepth: 1 };
          return tool('delegation_start', packet);
        }
        if (parent === 3 || parent === 8) { childResult = observed; if (observed.status !== 'completed') throw new Error('Actual child incomplete'); return tool('delegation_inspect', { id: packet.id }); }
        if (parent === 4 || parent === 9) {
          const child = JSON.parse(observed.artifacts[0].content); const stdout = child.observations.find((value: any) => typeof value.value.stdout === 'string')?.value.stdout;
          if (stdout !== (parent === 4 ? '14\n' : '15\n')) throw new Error('Child command receipt missing');
          return tool('delegation_judge', { id: packet.id, inspection: observed.receipt, checks: [{ criterion: packet.acceptanceCriteria[0], passed: parent === 4, evidence: childResult.result.artifacts[0] }] });
        }
        if (parent === 5) { if (observed.status !== 'accepted') throw new Error('Correct child not accepted'); return tool('workspace_discover', {}); }
        if (parent === 10) { if (observed.status !== 'rejected') throw new Error('Incorrect child not rejected'); return write('double.mjs', correct); }
        if (parent === 11) return command('double.mjs', '7'); if (parent === 12) return read('double.mjs'); break;
      }
    }
    if (parent === terminal) return tool('speech_send', { channel: context.target.channel, text: `${caseId}: retained actual tool observations, verified required artifacts and finished the public task.` });
    if (parent > terminal) return stop();
    throw new Error('Screen fixture reached undefined step');
  };
}
function manifests() {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: applicationRoot, encoding: 'utf8' }).split('\0').filter(file => /^(packages|deployment)\//.test(file) || ['package.json', 'package-lock.json'].includes(file));
  return { source: hash(JSON.stringify(files.map(file => [file, hash(readFileSync(join(applicationRoot, file), 'utf8'))]))), dependencies: hash(readFileSync(join(applicationRoot, 'package-lock.json'), 'utf8')), protocol: hash(readFileSync(join(applicationRoot, 'docs/rewrite/evidence/A1-L09/completion-readiness.md'), 'utf8')) };
}
export async function runSyntheticCase(caseId: ScreenCaseId, control: FixtureControl = 'normal', attempt: 1 | 2 | 3 = 1) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-screen-public-')), privateRoot = mkdtempSync(join(tmpdir(), 'aeon-screen-private-'));
  const config = fixtureConfiguration(root, applicationRoot);
  // Explicit synthetic host allowance fixed before dispatch, never copied into live mode.
  config.maxConcurrentRuns = 2; config.resources.maxConcurrency = 3;
  config.resources.maxTokens = 120000; config.resources.maxRequests = 100; config.model.maxRequestsPerSlice = 32;
  const authorityStore = new AuthorityStore(join(config.stateDirectory, 'authority.sqlite'));
  const authority = authorityStore.bootstrap('public-screen-fixture', config.controlRevision, config.artifactId);
  const packet = JSON.stringify(publicRehearsalPacket(caseId)), privatePacketPath = join(privateRoot, 'packet.json'); writeFileSync(privatePacketPath, packet, { mode: 0o600 });
  try {
    const report = await runScreenCase({ caseId, attempt, attemptId: `${caseId}-${control}-initial-${attempt}`,  mode: 'synthetic-application', application: { config, authorityStore, authority, secrets: { mistralApiKey: 'unused-fixture', directToken: 'unused-direct-fixture' }, performRequest: screenFixture(caseId, config.model.id, authority.generation, control) }, observer: { id: 'L08-author-public-screen', privateRoot, evaluatorDigest: hash(readFileSync(new URL('./screen.ts', import.meta.url), 'utf8')), taskDigest: hash(packet) }, manifest: manifests(), privatePacketPath, timeoutMs: 60000 });
    return { ...report, fixtureProvenance: { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: applicationRoot, encoding: 'utf8' }).trim(), driver: hash(readFileSync(new URL(import.meta.url), 'utf8')), control, publicRehearsalPacketDigest: hash(packet) } };
  } finally { authorityStore.close(); rmSync(root, { recursive: true, force: true }); rmSync(privateRoot, { recursive: true, force: true }); }
}
interface AttemptPlan { caseId: ScreenCaseId; initialAttempts: 1 | 2 | 3 }
export function validateAttemptPlan(plan: AttemptPlan[]) {
  if (plan.length !== supportedCases.length || new Set(plan.map(value => value.caseId)).size !== supportedCases.length || plan.some(value => !supportedCases.includes(value.caseId) || ![1, 2, 3].includes(value.initialAttempts))) throw new Error('Freeze all eight cases with at most three initial attempts before execution');
  return Object.freeze(plan.map(value => Object.freeze({ ...value })));
}
/** Finite synthetic engineering driver: one initial execution/case, all original failures retained. */
export async function runSyntheticScreen() {
  const plan = validateAttemptPlan(supportedCases.map(caseId => ({ caseId, initialAttempts: 1 })));
  const reports: Awaited<ReturnType<typeof runSyntheticCase>>[] = [];
  for (const task of plan) reports.push(await runSyntheticCase(task.caseId));
  return { schema: screenVersion, coverage: 'eight-case-partial', plan, planDigest: hash(JSON.stringify(plan)), reports, unavailable: unavailableCases, verdict: reports.every(report => report.verdict === 'case-pass') ? 'synthetic-mechanics-pass' : 'criterion-unmet', claims: { liveCompetence: 'unavailable', twelveCaseCompletion: false, Q3: 'unavailable', parity: 'unavailable', H1: 'unaccepted' } };
}
/** No credentials/config discovery: qualified host supplies the admitted application/resources/secrets.
 * Entry deliberately refuses synthetic transports; it does not bootstrap authority or alter grants. */
export async function runHostAuthorizedLiveCase(options: PublicScreenHostOptions | Omit<ScreenOptions, 'mode'>) {
  if (!Object.hasOwn(options, 'plan')) throw new Error('Live public screen closed: forbids caller-supplied fixture transport; legacy overrides are not authenticated');
  return runHostAuthorizedPublicScreen(options as PublicScreenHostOptions);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, destination] = process.argv.slice(2);
  if (mode !== '--synthetic' || !destination) throw new Error('Usage: node evaluations/product/screen-driver.ts --synthetic NEW-REPORT.json (live requires qualified host API)');
  const report = await runSyntheticScreen(); writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  if (report.verdict !== 'synthetic-mechanics-pass') process.exitCode = 1;
}
