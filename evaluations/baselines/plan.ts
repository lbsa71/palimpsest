import { isAbsolute } from 'node:path';
import { digest } from '../execution/screen.ts';

export interface BaselineGrant { id: string; maxCostUsd: number; maxPhysicalRequests: number; wallMs: number; }
export interface BaselinePlanInput { executable: string; workspace: string; model: string; effort: string; prompt: string; grant: BaselineGrant; configurationDigest: string; observerId: string; }
/** Build reviewable invocation data; never executes or accesses authentication. Host enforces the grant. */
export function prepareCodexBaseline(input: BaselinePlanInput) {
  if (!isAbsolute(input.executable) || !isAbsolute(input.workspace)) throw new Error('Baseline paths must be absolute');
  if (!input.model || !input.effort || !input.prompt || !input.observerId || !/^[a-f0-9]{64}$/.test(input.configurationDigest)) throw new Error('Unfrozen baseline configuration');
  const grant = input.grant;
  if (!grant.id || !Number.isFinite(grant.maxCostUsd) || grant.maxCostUsd <= 0 || !Number.isSafeInteger(grant.maxPhysicalRequests) || grant.maxPhysicalRequests < 1 || grant.maxPhysicalRequests > 64 || !Number.isSafeInteger(grant.wallMs) || grant.wallMs < 1 || grant.wallMs > 900000) throw new Error('Missing or invalid finite resource grant');
  const args = ['exec', '--ignore-user-config', '--ephemeral', '--sandbox', 'workspace-write', '--json', '--color', 'never', '--cd', input.workspace, '--model', input.model, '-c', `model_reasoning_effort=${JSON.stringify(input.effort)}`, '-'];
  return { executable: input.executable, args, stdin: input.prompt, environment: 'isolated explicit allowlist required', grant: structuredClone(grant), observerId: input.observerId, configurationDigest: input.configurationDigest, promptDigest: digest(input.prompt), execution: 'not-run' as const, prerequisite: 'Host observer must enforce requests/cost/time outside CLI and capture all effective instructions; argv alone does not enforce grants.' };
}
