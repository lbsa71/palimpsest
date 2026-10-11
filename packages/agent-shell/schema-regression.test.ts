import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toolDefinitions } from '../tools/index.ts';
import { validateToolArguments, validateToolCall } from './vendor/pi/ai/utils/validation.ts';
import type { Tool, ToolCall } from './vendor/pi/ai/types.ts';
const tools: Tool[] = [...toolDefinitions];
function validate(name: string, arguments_: Record<string, unknown>): Record<string, unknown> {
  return validateToolCall(tools, { type: 'toolCall', id: 'schema-test', name, arguments: arguments_ as ToolCall["arguments"] });
}
const child = {
  id: 'child', parentRunId: 'parent', parentGoalId: 'goal', objective: 'verify an artifact',
  inputs: [{ uri: 'artifact:test', sha256: 'a'.repeat(64) }],
  provenance: { sourceIds: ['source'], actorId: 'actor', recordedAt: '2026-10-11T00:00:00Z', derivation: 'observed' },
  scope: { kind: 'restricted', principals: ['alice'] }, acceptanceCriteria: ['verified'], writablePaths: ['/workspace'],
  allowedEffects: ['workspace.read'], resources: { maxRequests: 1, maxTokens: 100, maxCostUsd: 0, maxElapsedMs: 1000, maxConcurrency: 1 },
  modelPolicy: { provider: 'mistral', model: 'fixture', effort: null }, outputLocation: '/workspace/result', cancellationConditions: ['deadline'], maxDepth: 1,
};

test('all actual host tool schemas validate ordinary complete arguments', () => {
  const argumentsByName: Record<string, Record<string, unknown>> = {
    workspace_discover: {}, workspace_search: { text: 'needle' }, workspace_read: { path: 'file' },
    workspace_write: { path: 'file', content: 'body', expectedSha256: null },
    workspace_patch: { path: 'file', oldText: 'old', newText: 'new', expectedSha256: 'a'.repeat(64) },
    workspace_delete: { path: 'file', expectedSha256: 'a'.repeat(64) },
    workspace_move: { path: 'file', to: 'new', expectedSha256: 'a'.repeat(64) }, workspace_diff: { path: 'file', before: 'body' },
    command_run: { executable: 'node', args: ['--version'] }, research_fetch: { url: 'https://example.com' },
    speech_send: { channel: 'fixture', text: 'explicit speech', kind: 'report' }, delegation_start: child,
    delegation_start_batch: { tasks: [child] },
  };
  assert.equal(Object.keys(argumentsByName).length, tools.length);
  for (const tool of tools) assert.deepEqual(validate(tool.name, argumentsByName[tool.name]), argumentsByName[tool.name]);
});
test('invalid tool calls fail with useful nested paths and never alter their input', () => {
  const bad = structuredClone(child); bad.resources.maxRequests = -1;
  assert.throws(() => validate('delegation_start', bad), /#\/resources\/maxRequests/);
  assert.equal(bad.resources.maxRequests, -1);
  for (const [name, args] of [
    ['command_run', { executable: 'node', args: [17] }], ['workspace_read', { path: 'file', unwanted: true }],
    ['workspace_read', {}], ['speech_send', { channel: 'fixture', text: 'message', kind: 'unexpected' }],
  ] as const) assert.throws(() => validate(name, args), /Validation failed/);
  assert.throws(() => validate('unknown_tool', {}), /not found/);
});
test('nested unions, uniqueItems, patterns, enum, required and additionalProperties are enforced', () => {
  const mutations: ((value: typeof child) => void)[] = [
    value => { value.inputs[0].sha256 = 'not-a-digest'; },
    value => { value.scope.principals = ['alice', 'alice']; },
    value => { value.scope.principals = []; },
    value => { (value.scope as unknown as Record<string, unknown>).kind = 'unknown'; },
    value => { (value.resources as unknown as Record<string, unknown>).extra = true; },
    value => { value.modelPolicy.provider = null as unknown as string; },
    value => { value.provenance.derivation = 'fiction'; },
    value => { delete (value.resources as Partial<typeof child.resources>).maxTokens; },
    value => { value.acceptanceCriteria = []; },
    value => { value.maxDepth = 1.5; },
    value => { value.resources.maxElapsedMs = 0; },
  ];
  for (const mutate of mutations) { const candidate = structuredClone(child); mutate(candidate); assert.throws(() => validate('delegation_start', candidate), /Validation failed/); }
  const publicChild = { ...child, scope: { kind: 'public' } }; assert.deepEqual(validate('delegation_start', publicChild), publicChild);
});
test('optional-null and primitive coercion policy is strict while explicit null remains intact', () => {
  for (const timeoutMs of [null, '10', true, 0.5]) assert.throws(() => validate('command_run', { executable: 'node', args: [], timeoutMs }), /Validation failed/);
  assert.deepEqual(validate('command_run', { executable: 'node', args: [] }), { executable: 'node', args: [] });
  assert.deepEqual(validate('command_run', { executable: 'node', args: [], timeoutMs: 10 }), { executable: 'node', args: [], timeoutMs: 10 });
  assert.equal(validate('workspace_write', { path: 'file', content: 'text', expectedSha256: null }).expectedSha256, null);
  assert.throws(() => validate('workspace_write', { path: 'file', content: null, expectedSha256: null }), /Validation failed/);
  assert.throws(() => validate('speech_send', { channel: 'fixture', text: false }), /Validation failed/);
});
test('validation leaves emitted schemas and argument objects unchanged and rejects non-JSON values', () => {
  const before = JSON.stringify(tools); const args = structuredClone(child); const validated = validate('delegation_start', args);
  assert.notEqual(validated, args); assert.deepEqual(validated, args); assert.equal(JSON.stringify(tools), before);
  for (const maxCostUsd of [NaN, Infinity, undefined]) { const invalid = structuredClone(child); invalid.resources.maxCostUsd = maxCostUsd as number; assert.throws(() => validate('delegation_start', invalid), /JSON/); }
  const circular: Record<string, unknown> = {}; circular.self = circular;
  assert.throws(() => validate('workspace_discover', circular), /cyclic JSON/);
  assert.throws(() => validate('workspace_discover', { path: new Date() }), /plain JSON/);
});
test('nested arrays and referenced optional null reject invalid values without normalization', () => {
  const tool = { name: 'nested', description: '', parameters: { type: 'object', $defs: { entry: { type: 'object', properties: { n: { type: 'integer', minimum: 1 }, note: { type: ['string', 'null'] } }, required: ['n'], additionalProperties: false } }, properties: { entries: { type: 'array', items: { $ref: '#/$defs/entry' } } }, required: ['entries'], additionalProperties: false } };
  const validateNested = (arguments_: Record<string, unknown>) => validateToolArguments(tool, { type: 'toolCall', name: 'nested', id: 'nested', arguments: arguments_ as ToolCall["arguments"] });
  assert.deepEqual(validateNested({ entries: [{ n: 1, note: null }] }), { entries: [{ n: 1, note: null }] });
  for (const n of [null, '1', 0]) assert.throws(() => validateNested({ entries: [{ n }] }), /#\/entries\/0\/n/);
});
