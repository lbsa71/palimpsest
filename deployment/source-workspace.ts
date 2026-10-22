import { invariant, type JsonValue } from '../packages/contracts/index.ts';
import { runConfined, type CommandReceipt, type ConfinedCommand } from '../packages/supervisor/confinement.ts';
import type { ResourceLimits } from '../packages/supervisor/resource-limits.ts';

export interface SourceWorkspaceOptions { applicationRoot: string; workspace: string; protectedPaths: string[]; nodeBinary: string; maxFiles: number; maxBytes: number; timeoutMs: number; resourceLimits?: ResourceLimits;
  /** Host-selected one-time coding repository seed; never a model-supplied tool argument. */
  gitRepository?: boolean;
  run?: (command: ConfinedCommand) => Promise<CommandReceipt>;
}
export interface SourceTool { name: string; description: string; inputSchema: object; execute(args: JsonValue, signal?: AbortSignal): Promise<JsonValue> }
/** These explicit roots constitute the rewrite source; history and installed packages are not copied. */
export const rewriteSourceEntries = ['packages', 'deployment', 'evaluations', 'experiments/agent-shell', 'docs/rewrite', 'docs/adr', 'AGENTS.md', 'README.md', 'PLAN.md', 'REQUIREMENTS.md', 'GROWTH.md', 'package.json', 'package-lock.json', 'tsconfig.json'];
const snapshotScript = String.raw`
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import {spawnSync} from 'node:child_process';
const config=JSON.parse(process.argv[1]);
if(fs.readdirSync('/work').length)throw Error('Source snapshot requires an empty exclusive workspace');
let bytes=0,visited=0;const files=[];
function openLocal(relative){let fd=fs.openSync('/app',fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{const parts=relative.split('/');for(let i=0;i<parts.length;i++){const next=fs.openSync('/proc/self/fd/'+fd+'/'+parts[i],fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|(i<parts.length-1?fs.constants.O_DIRECTORY:fs.constants.O_NONBLOCK));fs.closeSync(fd);fd=next;}return fd;}catch(error){fs.closeSync(fd);throw error;}}
function visit(relative){if(++visited>config.maxFiles*2||relative.split('/').length>64)throw Error('Source snapshot exceeds entry/depth grant');
 const to=path.join('/work',relative),fd=openLocal(relative);
 try{const stat=fs.fstatSync(fd,{bigint:true});
 if(stat.isDirectory()){fs.mkdirSync(to,{recursive:true});const directory=fs.opendirSync('/proc/self/fd/'+fd);try{for(let entry=directory.readSync();entry;entry=directory.readSync())visit(relative+'/'+entry.name);}finally{directory.closeSync();}return;}
 if(!stat.isFile()||stat.nlink!==1n)throw Error('Source must contain regular unlinked files');
 if(++config.count>config.maxFiles||stat.size>BigInt(config.maxBytes-bytes))throw Error('Source snapshot exceeds file/byte grant');
 const content=Buffer.alloc(Number(stat.size));let offset=0;
 while(offset<content.length){const count=fs.readSync(fd,content,offset,Math.min(content.length-offset,65536),offset);if(!count)throw Error('Source changed during snapshot');offset+=count;}
 const after=fs.fstatSync(fd,{bigint:true});if(fs.readSync(fd,Buffer.alloc(1),0,1,content.length)||after.size!==stat.size||after.mtimeNs!==stat.mtimeNs||after.ctimeNs!==stat.ctimeNs||after.nlink!==1n)throw Error('Source changed during snapshot');
 bytes+=content.length;fs.mkdirSync(path.dirname(to),{recursive:true});fs.writeFileSync(to,content,{flag:'wx',mode:stat.mode&0o111n?0o700:0o600});
 files.push({path:relative,sha256:crypto.createHash('sha256').update(content).digest('hex'),bytes:content.length});
 }finally{fs.closeSync(fd);}}
for(const entry of config.entries)if(fs.existsSync(path.join('/app',entry)))visit(entry);
files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
let repository;
if(config.gitRepository){
 const git=(args)=>{const result=spawnSync('/usr/bin/git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','commit.gpgsign=false',...args],
  {cwd:'/work',encoding:'utf8',maxBuffer:262144,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}});
  if(result.error||result.status!==0)throw Error('Git repository seed failed: '+(result.error?.message||result.stderr));return result.stdout.trim();};
 git(['init','--quiet','--template=','--initial-branch=main']);
 git(['config','user.name','Autark']);git(['config','user.email','autark@localhost']);
 // Every copied file belongs to the accepted baseline, even if a nested ignore rule matches it.
 git(['add','--force','--all']);git(['commit','--quiet','-m','Initialize accepted source baseline']);
 repository={branch:git(['branch','--show-current']),commit:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}']),clean:git(['status','--porcelain=v1'])===''};
 if(!repository.clean)throw Error('Initial Git source baseline is not clean');
}
console.log(JSON.stringify({files,bytes,source:config.gitRepository?'accepted application seed for persistent Git repository':'accepted application snapshot',
 ...(repository?{git:repository}:{}),copiedAt:new Date().toISOString()}));
`;
function object(args: JsonValue, keys: string[]): Record<string, JsonValue> { invariant(args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).every(key => keys.includes(key)), 'Invalid source tool arguments'); return args; }
export function sourceWorkspaceTools(options: SourceWorkspaceOptions): SourceTool[] {
  options = { ...options, protectedPaths: [...options.protectedPaths], ...(options.resourceLimits ? { resourceLimits: { ...options.resourceLimits } } : {}) };
  const execute = options.run ?? runConfined;
  invariant(Number.isSafeInteger(options.maxFiles) && options.maxFiles > 0 && options.maxFiles <= 100000 && Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0 && options.maxBytes <= 512 * 1024 * 1024, 'Finite bounded source snapshot grants required');
  const run = (args: string[], maxOutputBytes: number, signal?: AbortSignal) => execute({ workspace: options.workspace, applicationRoot: options.applicationRoot, protectedPaths: options.protectedPaths, nodeBinary: options.nodeBinary, executable: '/runtime/node', args, timeoutMs: options.timeoutMs, maxOutputBytes, resourceLimits: options.resourceLimits, signal });
  return [{
    name: 'source_checkout', description: 'Copy the explicit accepted rewrite source into this empty isolated workspace, with source hashes. The candidate can then edit dependencies, prompts, tools, controls and plans for evaluation.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async execute(args, signal) {
      object(args, []);
      const receipt = await run(['--input-type=module', '-e', snapshotScript, JSON.stringify({ entries: rewriteSourceEntries, count: 0, maxFiles: options.maxFiles, maxBytes: options.maxBytes, gitRepository: options.gitRepository === true })], Math.min(options.maxBytes, 2_000_000), signal);
      return JSON.parse(JSON.stringify(receipt)) as JsonValue;
    },
  }, {
    name: 'source_check', description: 'Run the accepted TypeScript compiler over this candidate workspace, with the accepted pinned toolchain available read-only. A compiler pass is engineering evidence, not release acceptance.',
    inputSchema: { type: 'object', properties: { emit: { type: 'boolean' } }, required: ['emit'], additionalProperties: false },
    async execute(args, signal) {
      const a = object(args, ['emit']); invariant(typeof a.emit === 'boolean', 'Explicit emit flag required');
      const argv = ['/app/node_modules/typescript/bin/tsc', '--project', '/work/tsconfig.json', '--typeRoots', '/app/node_modules/@types', '--noEmit', a.emit ? 'false' : 'true'];
      if (a.emit) argv.push('--rewriteRelativeImportExtensions', '--outDir', '/work/dist');
      const receipt = await run(argv, 262144, signal);
      return JSON.parse(JSON.stringify(receipt)) as JsonValue;
    },
  }];
}
