import { workerSource } from './worker-source.ts';
import { invariant } from '../../contracts/common.ts';
import type { JsonValue } from '../../contracts/common.ts';
import { runConfined } from '../../supervisor/confinement.ts';
import type { ResourceLimits } from '../../supervisor/resource-limits.ts';
export const workspaceOperations = ['discover','search','read','write','patch','delete','move','diff'] as const;
export type WorkspaceOperation = typeof workspaceOperations[number];
export class WorkspaceFailure extends Error {
  readonly mayHaveApplied:boolean;
  constructor(message:string,mayHaveApplied:boolean){super(message);this.mayHaveApplied=mayHaveApplied;}
}
export interface WorkspaceOptions { workspace: string; protectedPaths: string[]; nodeBinary: string; timeoutMs: number; maxBytes: number; maxFiles: number; resourceLimits?: ResourceLimits }
/** A grant owns an exclusive workspace. The receiver serializes commands and edits on that grant. */
export class WorkspaceTools {
  readonly options: WorkspaceOptions;
  private readonly source = workerSource;
  constructor(options: WorkspaceOptions) { this.options=options; invariant(Number.isSafeInteger(options.maxFiles)&&options.maxFiles>0,'finite file limit required');invariant(Number.isSafeInteger(options.maxBytes)&&options.maxBytes>0,'finite byte limit required'); }
  async execute(operation: WorkspaceOperation, args: JsonValue, signal?: AbortSignal): Promise<JsonValue> {
    invariant(workspaceOperations.includes(operation),'unknown workspace operation');
    invariant(Buffer.byteLength(JSON.stringify(args))<=this.options.maxBytes*2+4096,'workspace arguments exceed limit');
    const result=await runConfined({workspace:this.options.workspace,protectedPaths:this.options.protectedPaths,nodeBinary:this.options.nodeBinary,resourceLimits:this.options.resourceLimits,executable:'/runtime/node',args:['--input-type=module','-e',this.source,JSON.stringify({operation,args,limit:this.options.maxBytes,maxFiles:this.options.maxFiles})],timeoutMs:this.options.timeoutMs,maxOutputBytes:this.options.maxBytes*3+4096,signal});
    let value:JsonValue|undefined;
    try{value=JSON.parse(result.stdout) as JsonValue;}catch{}
    if(result.exitCode!==0||result.stoppedFor) {
      const error=value&&typeof value==='object'&&!Array.isArray(value)?value:undefined;
      const mutation=['write','patch','delete','move'].includes(operation);
      throw new WorkspaceFailure(`workspace operation failed: ${error?.toolError || result.stderr || result.stoppedFor}`,typeof error?.mutationMayHaveStarted==='boolean'?error.mutationMayHaveStarted:mutation);
    }
    invariant(value!==undefined,'invalid workspace receipt');return value;
  }
}
