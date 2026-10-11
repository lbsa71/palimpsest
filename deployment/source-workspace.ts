import { invariant, type JsonValue } from '../packages/contracts/index.ts';
import { runConfined } from '../packages/supervisor/confinement.ts';
import type { ResourceLimits } from '../packages/supervisor/resource-limits.ts';

export interface SourceWorkspaceOptions { applicationRoot: string; workspace: string; protectedPaths: string[]; nodeBinary: string; maxFiles: number; maxBytes: number; timeoutMs: number; resourceLimits?: ResourceLimits }
export interface SourceTool { name: string; description: string; inputSchema: object; execute(args: JsonValue, signal?: AbortSignal): Promise<JsonValue> }
/** These explicit roots constitute the rewrite source; history and installed packages are not copied. */
export const rewriteSourceEntries = ['packages', 'deployment', 'evaluations', 'experiments/agent-shell', 'docs/rewrite', 'docs/adr', 'AGENTS.md', 'README.md', 'PLAN.md', 'REQUIREMENTS.md', 'GROWTH.md', 'package.json', 'package-lock.json', 'tsconfig.json'];
const snapshotScript = String.raw`
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const config=JSON.parse(process.argv[1]);
if(fs.readdirSync('/work').length)throw Error('Source snapshot requires an empty exclusive workspace');
let bytes=0;const files=[];
function visit(relative){const from=path.join('/app',relative),to=path.join('/work',relative),stat=fs.lstatSync(from);
 if(stat.isSymbolicLink())throw Error('Source symlink rejected');
 if(stat.isDirectory()){fs.mkdirSync(to,{recursive:true});for(const name of fs.readdirSync(from).sort())visit(path.join(relative,name));return;}
 if(!stat.isFile()||stat.nlink!==1)throw Error('Source must contain regular unlinked files');
 if(++config.count>config.maxFiles||(bytes+=stat.size)>config.maxBytes)throw Error('Source snapshot exceeds file/byte grant');
 const content=fs.readFileSync(from);fs.mkdirSync(path.dirname(to),{recursive:true});fs.writeFileSync(to,content,{flag:'wx',mode:stat.mode&0o111?0o700:0o600});
 files.push({path:relative,sha256:crypto.createHash('sha256').update(content).digest('hex'),bytes:content.length});}
for(const entry of config.entries)if(fs.existsSync(path.join('/app',entry)))visit(entry);
console.log(JSON.stringify({files,bytes,source:'accepted application snapshot',copiedAt:new Date().toISOString()}));
`;
function object(args: JsonValue, keys: string[]): Record<string, JsonValue> { invariant(args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).every(key => keys.includes(key)), 'Invalid source tool arguments'); return args; }
export function sourceWorkspaceTools(options: SourceWorkspaceOptions): SourceTool[] {
  const run = (args: string[], maxOutputBytes: number, signal?: AbortSignal) => runConfined({ workspace: options.workspace, applicationRoot: options.applicationRoot, protectedPaths: options.protectedPaths, nodeBinary: options.nodeBinary, executable: '/runtime/node', args, timeoutMs: options.timeoutMs, maxOutputBytes, resourceLimits: options.resourceLimits, signal });
  return [{
    name: 'source_checkout', description: 'Copy the explicit accepted rewrite source into this empty isolated workspace, with source hashes. The candidate can then edit dependencies, prompts, tools, controls and plans for evaluation.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async execute(args, signal) {
      object(args, []);
      const receipt = await run(['--input-type=module', '-e', snapshotScript, JSON.stringify({ entries: rewriteSourceEntries, count: 0, maxFiles: options.maxFiles, maxBytes: options.maxBytes })], Math.min(options.maxBytes, 2_000_000), signal);
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
