import { runNativeBaseline } from './run-native.ts';
import type { NativeBaselineRun, NativeBaselineResult } from './run-native.ts';

export interface ClaudeBaselineRun extends Omit<NativeBaselineRun, 'kind' | 'native' | 'provider'> {
  native: { claude: string; version: string; claudeSha256: string };
  provider: Extract<NativeBaselineRun['provider'], { kind: 'fixture' }>;
}
/** Actual native CLI, synthetic Messages transport only. No paid/account path exists. */
export function runClaudeBaseline(input: ClaudeBaselineRun): Promise<NativeBaselineResult> {
  return runNativeBaseline({ ...input, kind: 'claude', native: { version: input.native.version,
    files: [{ path: input.native.claude, name: 'claude', sha256: input.native.claudeSha256 }] } });
}
