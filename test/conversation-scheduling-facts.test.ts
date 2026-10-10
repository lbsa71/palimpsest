import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conversationSchedulingFacts } from '../src/conversation-host-facts.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) { const value = await read(); if (done(value)) return value; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('Conversation facts fixture timed out');
}
for (const cadence of ['daily', 'hourly'] as const) test(`serve supplies selected ${cadence} facts while actual conversation defers configured growth`, { skip: process.platform !== 'darwin' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'palimpsest-conversation-facts-')); const repo = join(directory, 'repo'), state = join(directory, 'state'), remote = join(directory, 'remote.git');
  mkdirSync(repo);
  for (const path of ['src', 'docs', 'trusted', 'config']) cpSync(join(root, path), join(repo, path), { recursive: true });
  for (const path of ['AGENTS.md', 'GROWTH.md', 'package.json', 'package-lock.json', 'tsconfig.json']) cpSync(join(root, path), join(repo, path));
  const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Facts Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('add', '.'); git('commit', '-qm', 'trusted facts fixture'); git('init', '--bare', remote); git('remote', 'add', 'origin', remote); git('push', 'origin', 'main');
  const captured = join(directory, 'requests.jsonl'); const preload = join(directory, 'provider-fixture.mjs');
  writeFileSync(preload, `import {appendFileSync} from 'node:fs';
const capture=${JSON.stringify(captured)};
globalThis.fetch=async(url,options)=>{
  if(String(url)!=='https://api.mistral.ai/v1/chat/completions')throw new Error('Unexpected fixture transport');
  const payload=JSON.parse(options.body), prompt=JSON.parse(payload.messages[1].content);
  let output;
  if(prompt.hostFacts){appendFileSync(capture,JSON.stringify({hostFacts:prompt.hostFacts,requestLimits:prompt.requestLimits,maxTokens:payload.max_tokens})+'\\n');
    output={version:'autark-turn/1',actions:[{name:'say',arguments:{text:JSON.stringify({plan:prompt.hostFacts.activePlanAllocation,growth:prompt.hostFacts.standingGrowth,eligible:prompt.hostFacts.requester.selfModificationSuggestionEligible})}}],disposition:'converse',rationale:'Informational question; no source change requested.',proposal:null,outcomes:[]};
  }else output={observation:'Fixture timer ran.',lesson:'No source change proposed.',nextQuestion:'Continue bounded observation.',proposedChange:null};
  return new Response(JSON.stringify({model:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:1,completion_tokens:1}}),{status:200});
};`);
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME,
    PALIMPSEST_DATA_DIR: state, PALIMPSEST_CREDENTIALS_FILE: join(directory, 'absent.env'), PALIMPSEST_PROVIDER: 'mistral', MISTRAL_API_KEY: 'fixture-only', MISTRAL_MODEL: 'fixture',
    PALIMPSEST_GROWTH_CALLS_PER_DAY: '1', PALIMPSEST_EVOLUTION_CALLS_PER_DAY: '0', PALIMPSEST_INTERACTIVE_EVOLUTION_CALLS_PER_DAY: '0',
    PALIMPSEST_PLAN_CADENCE: cadence, PALIMPSEST_PLAN_PROPOSAL_CALLS_PER_DAY: cadence==='daily'?'0':'2', PALIMPSEST_PLAN_PROPOSAL_CALLS_PER_HOUR: cadence==='hourly'?'0':'1',
    PALIMPSEST_PLAN_EVOLUTION_CALLS_PER_DAY: '16', PALIMPSEST_PLAN_EVOLUTION_CALLS_PER_HOUR: '8',
    PALIMPSEST_GIT_REMOTE: 'origin', PALIMPSEST_GIT_BRANCH: 'main', PALIMPSEST_GIT_REMOTE_URL: remote };
  let child: ReturnType<typeof spawn> | undefined; let errorOutput = '';
  try {
    execFileSync(process.execPath, [join(root, 'src/cli.ts'), 'init'], { cwd: repo, env, timeout: 30_000, stdio: 'pipe' });
    child = spawn(process.execPath, ['--import', preload, join(root, 'src/cli.ts'), 'serve'], { cwd: repo, env, stdio: ['ignore','pipe','pipe'] });
    let stdout = ''; child.stdout!.on('data', chunk => { stdout += chunk; }); child.stderr!.on('data', chunk => { errorOutput += chunk; });
    const line = await until(async () => { if(child!.exitCode!==null)throw new Error(errorOutput); return stdout.split('\n').find(line=>line.includes('"url"')); }, line=>line!==undefined);
    const startup = JSON.parse(line!); const headers = { authorization: `Bearer ${readFileSync(startup.tokenFile,'utf8')}`, 'content-type':'application/json' };
    const response = await fetch(startup.url+'/messages', {method:'POST',headers,body:JSON.stringify({id:'facts-probe',source:'direct',conversationId:'local',text:'Which cadence is active and is growth configured?'})});
    assert.equal(response.status,202); const submitted = await response.json() as {id:string};
    const task = await until(async()=>{const reply=await fetch(startup.url+'/tasks/'+submitted.id,{headers});assert.equal(reply.status,200);return await reply.json() as {state:string;output?:string;error?:string};},task=>['succeeded','failed'].includes(task.state));
    assert.equal(task.state,'succeeded',task.error); const recorded=JSON.parse(readFileSync(captured,'utf8').trim().split('\n').at(-1)!);
    assert.deepEqual(recorded.hostFacts.activePlanAllocation,{cadence,timeUnit:cadence==='hourly'?'UTC hour':'UTC day',proposalCalls:0,releaseCalls:cadence==='hourly'?8:16,scheduled:true});
    assert.deepEqual(recorded.hostFacts.planAllocationSettings.daily.selected,cadence==='daily');
    assert.deepEqual(recorded.hostFacts.planAllocationSettings.hourly.selected,cadence==='hourly');
    assert.equal(recorded.hostFacts.standingGrowth.configured,true); assert.equal(recorded.hostFacts.standingGrowth.enabled,true);
    assert.equal(recorded.hostFacts.standingGrowth.timerScheduled,true); assert.equal(recorded.hostFacts.standingGrowth.paused,true); assert.equal(recorded.hostFacts.standingGrowth.pauseReason,'user_work');
    assert.equal(recorded.hostFacts.backgroundGrowthScheduled,true,'timer remains scheduled while user priority defers inference');
    assert.equal(recorded.hostFacts.requester.selfModificationSuggestionEligible,true,'authenticated direct operator is independently eligible');
    assert.equal(recorded.maxTokens,8192); assert.deepEqual(recorded.requestLimits,{maxOutputTokens:8192,unit:'output tokens'});
    assert.ok(task.output?.includes('"configured":true')); assert.doesNotMatch(task.output ?? '', /No source modification was dispatched/);
  } finally {
    if(child&&child.exitCode===null){const exited=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill('SIGTERM');const timer=setTimeout(()=>child!.kill('SIGKILL'),10_000);await exited;clearTimeout(timer);}
    rmSync(directory,{recursive:true,force:true});
  }
});


test('growth facts distinguish timer quiescence, disabled inference and nonserving commands', () => {
  const config = {planCadence:'hourly' as const,planProposalCallsPerDay:2,planEvolutionCallsPerDay:16,planProposalCallsPerHour:1,planEvolutionCallsPerHour:8,growthCallsPerDay:4};
  const state = {serving:true,ready:true,stopping:false,planScheduled:true,growthTimerScheduled:false,userWork:false,backgroundQuiescing:true};
  const paused = conversationSchedulingFacts(config,state).standingGrowth;
  assert.equal(paused.configured,true); assert.equal(paused.enabled,true); assert.equal(paused.timerScheduled,false); assert.equal(paused.paused,true); assert.equal(paused.pauseReason,'background_quiescence');
  const resumed = conversationSchedulingFacts(config,{...state,growthTimerScheduled:true,backgroundQuiescing:false}).standingGrowth;
  assert.equal(resumed.configured,true); assert.equal(resumed.paused,false); assert.equal(resumed.pauseReason,null);
  const disabled = conversationSchedulingFacts({...config,growthCallsPerDay:0},state).standingGrowth;
  assert.equal(disabled.configured,true); assert.equal(disabled.enabled,false); assert.equal(disabled.paused,false);
  const nonserving = conversationSchedulingFacts(config,{...state,serving:false,planScheduled:false});
  assert.equal(nonserving.standingGrowth.configured,false); assert.equal(nonserving.standingGrowth.enabled,false); assert.equal(nonserving.activePlanAllocation.scheduled,false);
  const unknownPause = conversationSchedulingFacts(config,{...state,backgroundQuiescing:false}).standingGrowth;
  assert.equal(unknownPause.paused,true); assert.equal(unknownPause.pauseReason,null,'absent timer alone does not invent a cause');
});
