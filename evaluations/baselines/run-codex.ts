import { runNativeBaseline } from './run-native.ts';
import type { NativeBaselineRun, NativeBaselineResult } from './run-native.ts';

export interface CodexBaselineRun extends Omit<NativeBaselineRun, 'kind' | 'native'> {
  native: { codex: string; helper: string; version: string; codexSha256: string; helperSha256: string };
}
export type CodexBaselineResult = NativeBaselineResult;
/** Concrete Codex entry point; shared lifecycle retains its original grant and isolation. */
export function runCodexBaseline(input: CodexBaselineRun): Promise<CodexBaselineResult> {
  return runNativeBaseline({ ...input, kind: 'codex', native: { version: input.native.version, files: [
    { path: input.native.codex, name: 'codex', sha256: input.native.codexSha256 },
    { path: input.native.helper, name: 'codex-code-mode-host', sha256: input.native.helperSha256 },
  ] } });
}
