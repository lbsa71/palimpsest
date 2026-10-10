/** Palimpsest-owned records. No SDK types, effects, credentials or authority in model input. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export interface RawToolIntent { callId: string; name: string; arguments: string }
export type ToolOutcome = { ok: true; text: string } | { ok: false; kind: 'tool_failed' | 'tool_denied'; message: string };
export type CodingMessage =
  | { role: 'system'; text: string }
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; intents?: RawToolIntent[] | undefined }
  | { role: 'tool'; callId: string; name: string; outcome: ToolOutcome };
export interface CodingStepInput { messages: CodingMessage[]; signal?: AbortSignal | undefined }
/** Known means coherent reported counts, never fabricated defaults or independently verified billing. */
export type Usage = { status: 'known'; input: number; output: number; total: number } | { status: 'unknown' };
export type FailureKind = 'authorization' | 'invalid-input' | 'invalid-intent' | 'invalid-usage' | 'incomplete-response' | 'request-too-large' | 'response-too-large' | 'aborted' | 'deadline' | 'provider';
export type CodingStepResult =
  | { status: 'ok'; text: string; intents: RawToolIntent[]; usage: Usage; finishReason: 'stop' | 'tool-calls' }
  | { status: 'failed'; error: { kind: FailureKind; statusCode?: number }; usage: Usage; dispatch: 'not-sent' | 'uncertain' };
/** Schema advertises data; the trusted synchronous validator independently checks semantics. */
export interface CodingToolDefinition { name: string; description: string; inputSchema: JsonObject; validateArguments(value: unknown): boolean }
export interface CodingProviderLimits {
  maxCatalogEntries?: number; maxIntentsPerStep?: number; maxHistoryMessages?: number; maxHistoryBytes?: number;
  maxRequestBytes?: number; maxResponseBytes?: number; deadlineMs?: number; maxOutputTokens?: number;
}
/** Trusted host hooks are bounded by cancellation; hook completion does not grant tool execution. */
export interface TrustedCodingProviderOptions {
  model: string; apiKey: string; tools: readonly CodingToolDefinition[]; transport: typeof fetch;
  preauthorize(signal: AbortSignal): void | Promise<void>;
  reserve(request: { model: string; bodyBytes: number; bodySha256: string; signal: AbortSignal }): void | Promise<void>;
  limits?: CodingProviderLimits;
}
export interface CodingProviderPort { step(input: CodingStepInput): Promise<CodingStepResult> }
/** Compatibility type name used by the selected baseline fixture suite. */
export type StepInput = CodingStepInput;
