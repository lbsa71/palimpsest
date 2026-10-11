import { invariant } from '../../contracts/common.ts';
import { runConfined } from '../../supervisor/confinement.ts';
import type { CommandReceipt } from '../../supervisor/confinement.ts';
import type { WorkspaceOptions } from '../workspace/index.ts';
export interface CommandPolicy extends WorkspaceOptions { executables: string[]; maxArgs: number }
export async function executeCommand(policy: CommandPolicy, args: {executable:string;args:string[];timeoutMs?:number;maxOutputBytes?:number}, signal?:AbortSignal):Promise<CommandReceipt> {
  invariant(policy.executables.includes(args.executable),'executable is not granted');
  invariant(Array.isArray(args.args)&&args.args.length<=policy.maxArgs&&args.args.every(a=>typeof a==='string'&&Buffer.byteLength(a)<=policy.maxBytes),'invalid bounded command arguments');
  const timeoutMs=args.timeoutMs??policy.timeoutMs,maxOutputBytes=args.maxOutputBytes??policy.maxBytes;
  invariant(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=policy.timeoutMs&&Number.isSafeInteger(maxOutputBytes)&&maxOutputBytes>0&&maxOutputBytes<=policy.maxBytes,'command exceeds grant limits');
  return runConfined({workspace:policy.workspace,protectedPaths:policy.protectedPaths,nodeBinary:policy.nodeBinary,resourceLimits:policy.resourceLimits,executable:args.executable,args:args.args,timeoutMs,maxOutputBytes,signal});
}
