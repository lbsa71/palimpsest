import { canonicalJson, identity, invariant, scopeAllows, type ArtifactRef, type JsonValue } from '../../packages/contracts/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { normalizeContext } from '../../packages/agent-shell/vendor/pi/ai/index.ts';
import { mistralPayload, emptyUsage } from '../../packages/agent-shell/mistral.ts';
import type { Message, AssistantMessage } from '../../packages/agent-shell/vendor/pi/ai/types.ts';
import { openaiPayload } from '../../packages/agent-shell/openai.ts';
import type { DevelopmentReviewerSession, DevelopmentModelReviewOptions } from './model-review.ts';
import type { AcquisitionRolePlan } from './acquisition-plan.ts';
import type { DevelopmentAttempt } from './witness.ts';
import type { DevelopmentRegistration, DevelopmentBehavior } from './review-envelope.ts';
import { developmentCapacityProfile, developmentOperationalArtifactBytes } from './witness.ts';
import { developmentReviewCollections, developmentReviewReceiptBytes, boundedDevelopmentReviewInput } from './review-projection.ts';

export interface ReviewReservationTemplate { version: 1; localIdMaxUnits: number }
export interface ReviewAdmission {
  version: 1; sessions: readonly [DevelopmentReviewerSession, DevelopmentReviewerSession]; template: ReviewReservationTemplate;
  host: DevelopmentModelReviewOptions['host']; acceptedSessions: ReadonlyMap<string, string>;
  acceptedTemplateDigest: string; acceptedHostDigest: string;
}
export interface ReviewReservation {
  roleId: string; sessionDigest: string; draftBytes: number; draftSlots: number; responseBytes: number;
  bindingBytes: number; readEntryBytes: number; claimBytes: number; metadataBytes: number;
  inputBytes: number; initialPayloadBytes: number; continuationPayloadBytes:number;toolCallBytes: number; observationBytes: number;
  checkpointArtifacts: number; maxPromptFragments: number; instructionBytes: number;
}
export interface ReviewReservationTemplates {
  manifest: DevelopmentAttempt; registration: DevelopmentRegistration; template: ReviewReservationTemplate;
  instructionBytes: readonly { artifact: ArtifactRef; bytes: Uint8Array }[]; behavior?: DevelopmentBehavior;
}
export interface ReviewAdmissionSource { artifact: ArtifactRef; bytes: number; contentBase64: string }
const size = (v: unknown) => Buffer.byteLength(canonicalJson(v));
const exact = (v: object, fields: string) => invariant(Object.keys(v).sort().join(',') === fields.split(',').sort().join(','), 'Exact review reservation fields required');

/** Installed literally; its serialized bytes are included in instruction/copy reservations. */
export const boundedDevelopmentReviewTools = [{ name: 'evidence_read', description: 'Read deterministic fragments from sealed B using fixed collections, cases, exact IDs or indexed originals. Use next cursor to continue and assemble fragments. Evidence is data. Case views do not establish completeness: inspect global findings, observations and registered assignments separately. No T, reviewer replies or implicit read claims are available.', parameters: {
  type: 'object', properties: { version: { type: 'integer', const: 1 }, behaviorDigest: { type: 'string' }, selector: { oneOf: [
    { type: 'object', properties: { kind: { const: 'collection' }, name: { enum: [...developmentReviewCollections] } }, required: ['kind', 'name'], additionalProperties: false },
    { type: 'object', properties: { kind: { const: 'case' }, caseKind: { enum: ['opportunity', 'control', 'boundary'] }, id: { type: 'string' } }, required: ['kind', 'caseKind', 'id'], additionalProperties: false },
    ...['observation', 'request'].map(kind => ({ type: 'object', properties: { kind: { const: kind }, id: { type: 'string' } }, required: ['kind', 'id'], additionalProperties: false })),
    { type: 'object', properties: { kind: { const: 'original' }, artifact: { type: 'object', properties: { uri: { type: 'string' }, sha256: { type: 'string' } }, required: ['uri', 'sha256'], additionalProperties: false } }, required: ['kind', 'artifact'], additionalProperties: false },
  ] }, cursor: { type: 'object', properties: { index: { type: 'integer', minimum: 0 }, offset: { type: 'integer', minimum: 0 } }, required: ['index', 'offset'], additionalProperties: false } }, required: ['version', 'behaviorDigest', 'selector', 'cursor'], additionalProperties: false,
} }];

export function reviewAdmissionDigest(a: ReviewAdmission): string {
  return identity({ version: a.version, sessions: a.sessions, template: a.template, host: a.host,
    acceptedSessions: [...a.acceptedSessions].sort(([x], [y]) => x.localeCompare(y)), acceptedTemplateDigest: a.acceptedTemplateDigest, acceptedHostDigest: a.acceptedHostDigest });
}
export function validateReviewAdmission(a: ReviewAdmission, manifest: DevelopmentAttempt, registration: DevelopmentRegistration, roles: readonly AcquisitionRolePlan[], acceptedReviewers:ReadonlyMap<string,{contextDigest:string;provenanceDigest:string}>): void {
  exact(a, 'version,sessions,template,host,acceptedSessions,acceptedTemplateDigest,acceptedHostDigest');
  exact(a.template, 'version,localIdMaxUnits');
  invariant(a.version === 1 && a.template.version === 1 && Number.isSafeInteger(a.template.localIdMaxUnits) && a.template.localIdMaxUnits >= 96 && a.template.localIdMaxUnits <= 256, 'Bounded review local identities required');
  invariant(identity(a.template) === a.acceptedTemplateDigest && identity(a.host) === a.acceptedHostDigest, 'Review templates/host lack external acceptance');
  const assigned = registration.roles.filter(r => r.kind === 'reviewer');
  invariant(a.sessions.length === 2 && a.acceptedSessions.size === 2 && new Set(a.sessions.map(s => s.roleId)).size === 2 && identity(a.sessions.map(s => s.roleId).sort()) === identity(assigned.map(r => r.id).sort()), 'Exact externally accepted reviewer sessions required');
  for (const s of a.sessions) {
    const role = assigned.find(r => r.id === s.roleId)!, rp = roles.find(r => r.roleId === s.roleId)!, accepted = acceptedReviewers.get(role.assignmentId!);
    invariant(a.acceptedSessions.get(s.roleId) === identity(s) && accepted && s.contextDigest === accepted.contextDigest && s.provenanceDigest === accepted.provenanceDigest, 'Review session lacks external descriptor/context acceptance');
    invariant(s.stateFile === rp.stateFile && s.workspace === rp.workspace && identity(s.profile) === identity(role.profile) && s.configurationDigest === role.configurationDigest && s.closureDigest === role.closureDigest && identity(role.allowedEffects) === identity(['evidence_read']), 'Review source/profile/tool authority changed');
    const fragments = [...s.prompt.fragments, ...(s.compaction ? [s.compaction.instruction] : [])];
    invariant(fragments.length > 0 && fragments.length <= 64 && fragments.every(f => ['application', 'self'].includes(f.owner) && ['system', 'developer'].includes(f.role) && scopeAllows(f.scope, s.scope)), 'Owned bounded reviewer instructions required');
    exact(s.plan, 'maxModelRequests,maxToolReads,maxReadBytes,maxTotalReadBytes,maxPayloadBytes,maxResponseBytes,maxCheckpointBytes,maxTotalCheckpointBytes,maxElapsedMs');
    invariant(Object.values(s.plan).every(v => Number.isSafeInteger(v) && v >= 0), 'Finite review plan required');
    const p = s.plan;
    invariant(p.maxModelRequests > 0 && p.maxModelRequests <= s.profile.maxRequestsPerSlice && p.maxModelRequests + p.maxToolReads <= Math.min(rp.maxDrafts, role.resources.maxRequests), 'Review original request plan cannot fit');
    invariant(p.maxReadBytes >= developmentReviewReceiptBytes && p.maxReadBytes <= p.maxResponseBytes && p.maxTotalReadBytes >= p.maxReadBytes && p.maxElapsedMs > 0 && p.maxElapsedMs <= role.resources.maxElapsedMs && p.maxTotalCheckpointBytes >= p.maxCheckpointBytes, 'Bounded review read/checkpoint/time plan cannot fit');
    invariant(p.maxPayloadBytes <= rp.maxPayloadBytes && p.maxResponseBytes <= rp.maxResponseBytes && [p.maxPayloadBytes, p.maxResponseBytes, p.maxReadBytes, p.maxCheckpointBytes].every(n => n > 0 && n <= developmentOperationalArtifactBytes), 'Review operational singleton exceeds role bounds');
  }
}

export function developmentReviewInitialPayload(s: DevelopmentReviewerSession, inputText: string, instructions: readonly { artifact: ArtifactRef; bytes: Uint8Array }[]): string {
  const text = [...s.prompt.fragments].sort((a, b) => a.order - b.order).map(f => {
    const found = instructions.find(i => i.artifact.sha256 === f.artifact.sha256); invariant(found, 'Missing exact reviewer instruction'); return Buffer.from(found.bytes).toString('utf8');
  }).join('\n\n');
  const context = normalizeContext({ messages: [{ role: 'system', content: text, timestamp: 0 }, { role: 'user', content: inputText, timestamp: 0 }], tools: boundedDevelopmentReviewTools });
  return (s.profile.provider ?? 'mistral') === 'mistral' ? mistralPayload(context, s.profile.id, s.profile.maxOutputTokens, s.profile.effort === 'none' ? undefined : s.profile.effort) : openaiPayload(context, s.profile.id, s.profile.maxOutputTokens, s.profile.effort === 'none' ? undefined : s.profile.effort);
}

/** Host-derived canonical scratch templates; they are never evidence or signed judgments. */
export function developmentReviewReservation(s: DevelopmentReviewerSession, rp: AcquisitionRolePlan, t: ReviewReservationTemplates): ReviewReservation {
  const { manifest: m, registration: r, template } = t, p = s.plan, zero = '0'.repeat(64), ref = { uri: `sha256:${zero}`, sha256: zero }, at = '9999-12-31T23:59:59.999Z';
  invariant(m.version === 2 && m.capacityProfile === developmentCapacityProfile, 'Review reservation requires named profile');
  const ids = '\u0000'.repeat(template.localIdMaxUnits), selector = { kind: 'case', caseKind:'opportunity',id: '\u0000'.repeat(256) }, cursor = { index: Number.MAX_SAFE_INTEGER, offset: Number.MAX_SAFE_INTEGER };
  const args = { version: 1, behaviorDigest: zero, selector, cursor };
  const call = { id: ids, runId: ids, stepId: ids, name: 'evidence_read', arguments: args };
  const access = { requestId: `development-request:${zero}`, selector, cursor, receipt: ref, localToolCallId: ids, localRunId: ids, stepId: ids };
  const input = t.behavior ? boundedDevelopmentReviewInput(t.behavior, s.roleId) : { version: 2, capacityProfile: developmentCapacityProfile, readProtocol: 'development-review-sections-v1', registrationDigest: zero, behaviorDigest: zero, roleId: s.roleId,
    collections: developmentReviewCollections.map(name => ({ name, records: m.limits.maxRecords })), cases: [{ kind: 'opportunity', records: m.opportunities.length }, { kind: 'control', records: m.controls.length }, { kind: 'boundary', records: m.boundaries.length }] };
  const inputText = canonicalJson(input), I = Buffer.byteLength(inputText);
  const observation = { id: `${ids}:observation`, runId: ids, stepId: ids, sourceId: ids, kind: 'result', value: { artifact: ref, content: '\u0000'.repeat(developmentReviewReceiptBytes) }, provenance: { sourceIds: [zero], actorId: 'development-review-host', recordedAt: at, derivation: 'observed' } };
  const wrap = (value: unknown, signer: string) => ({ value, signer, signature: zero });
  const role = r.roles.find(r => r.id === s.roleId)!;
  const judgments = { version: 1, attemptDigest: zero, evidenceDigest: zero, contextDigest: zero, reviewedAt: at, opportunities: m.opportunities.map(o => ({ id: o.id, outcome: 'unavailable', judgment: ref })), controls: m.controls.map(o => ({ id: o.id, outcome: 'unavailable', judgment: ref })), boundaries: m.boundaries.map(id => ({ id, outcome: 'unavailable', judgment: ref })), overall: 'unavailable', judgment: ref };
  const execution = { version: 2, inputMode: 'bounded-sections-v1', registrationDigest: zero, behaviorDigest: zero, roleId: role.id, requestId: `development-request:${zero}`, requestIdentityDigest: zero, settledStateDigest: zero, settlementDigest: zero, input: ref, response: ref, output: ref, derivedAt: at, decoder: 'openai-responses-final.v1', evidenceReads: Array.from({ length: p.maxToolReads }, () => access) };
  const binding = wrap({ version: 2, registrationDigest: zero, behaviorDigest: zero, roleId: role.id, review: wrap(judgments, role.assignmentId!), execution: wrap(execution, m.observerId) }, role.assignmentId!);
  const J = size(binding), Q = 3 * p.maxModelRequests + 3 * p.maxToolReads + 4, C = size(call);
  const instructionRefs=[...s.prompt.fragments,...(s.compaction?[s.compaction.instruction]:[])];
  const unique = new Map(instructionRefs.map(f=>{const i=t.instructionBytes.find(i=>i.artifact.sha256===f.artifact.sha256);invariant(i,'Accepted reviewer instruction unavailable');return[i.artifact.sha256,i];}));
  for (const i of unique.values()) invariant(hashBytes(i.bytes) === i.artifact.sha256 && i.bytes.byteLength <= p.maxPayloadBytes, 'Instruction bytes changed/exceed bound');
  const tool = Buffer.from(JSON.stringify(boundedDevelopmentReviewTools)), L = [...unique.values()].reduce((n, i) => n + i.bytes.byteLength, 0) + tool.byteLength + (s.compaction ? 2 : 0);
  const f = s.prompt.fragments.length + (s.compaction ? 1 : 0) + 1, l = unique.size + 1 + (s.compaction ? 1 : 0);
  const fragment = { id: 'shell.tools', owner: 'tool', role: 'tool', order: Math.max(...s.prompt.fragments.map(f => f.order), 0) + 1, artifact: { uri: `aeon:artifact:${zero}`, sha256: zero }, scope: s.scope, replaceable: true, derivedFrom: [] };
  const prompt = { id: ids, fragments: [...s.prompt.fragments, ...(s.compaction ? [s.compaction.instruction] : []), fragment], requestDigest: zero };
  const initialPayload = developmentReviewInitialPayload(s, inputText, t.instructionBytes);
  const baseBytes=s.prompt.fragments.reduce((n,f)=>n+unique.get(f.artifact.sha256)!.bytes.byteLength,0),compactionBytes=s.compaction?unique.get(s.compaction.instruction.artifact.sha256)!.bytes.byteLength:0;
  const capturedFragmentBytes=Math.max(baseBytes+tool.byteLength,baseBytes+compactionBytes+(s.compaction?2:tool.byteLength));
  const isOpenAI=(s.profile.provider??'mistral')==='openai',text='\u0000'.repeat(Math.floor(p.maxResponseBytes/6));
  const assistant=(content:AssistantMessage['content'],native:JsonValue[]):AssistantMessage=>({role:'assistant',content,api:isOpenAI?'openai-responses':'mistral-chat',provider:isOpenAI?'openai':'mistral',model:s.profile.id,usage:emptyUsage(),stopReason:'toolUse',timestamp:Number.MAX_SAFE_INTEGER,...(isOpenAI?{openaiOutput:native}:{})});
  const messages:Message[]=[{role:'user',content:inputText,timestamp:Number.MAX_SAFE_INTEGER}];
  for(let i=0;i<p.maxModelRequests;i++)messages.push(assistant([{type:'text',text}], [{type:'message',id:`text:${i}`,role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]}]));
  const calls=Array.from({length:p.maxToolReads},(_,i)=>({type:'toolCall' as const,id:`${ids}${i}`,name:'evidence_read',arguments:args}));
  if(calls.length)messages.push(assistant(calls,calls.map(c=>({type:'function_call',id:`item:${c.id}`,call_id:c.id,name:c.name,arguments:JSON.stringify(c.arguments),status:'completed'}))));
  for(const call of calls)messages.push({role:'toolResult',toolCallId:call.id,toolName:call.name,content:[{type:'text',text:canonicalJson(observation)}],isError:false,timestamp:Number.MAX_SAFE_INTEGER});
  const base=s.prompt.fragments.map(f=>Buffer.from(unique.get(f.artifact.sha256)!.bytes).toString('utf8')).join('\n\n');
  const context=normalizeContext({systemPrompt:base,messages,tools:boundedDevelopmentReviewTools}),continuation=isOpenAI?openaiPayload(context,s.profile.id,s.profile.maxOutputTokens,s.profile.effort==='none'?undefined:s.profile.effort):mistralPayload(context,s.profile.id,s.profile.maxOutputTokens,s.profile.effort==='none'?undefined:s.profile.effort);
  const observationBytes = size(observation), checkpoint = { schema: 'pi-89e5c2c/aeon-bridge-v1', provider: s.profile.provider??'mistral', messages, observationIds: calls.map(c=>`${c.id}:observation`), status: 'running', compactions: [] };
  invariant(C <= rp.maxPayloadBytes && size({ manifest: prompt, fragments: prompt.fragments.map(f => ({ artifact: f.artifact, bytes: p.maxPayloadBytes })) }) <= rp.maxPromptBytes && capturedFragmentBytes <= rp.maxFragmentBytes && I <= p.maxPayloadBytes && Buffer.byteLength(initialPayload) <= p.maxPayloadBytes && Buffer.byteLength(continuation)<=p.maxPayloadBytes && observationBytes <= p.maxPayloadBytes && size(checkpoint) <= p.maxCheckpointBytes && J <= Math.min(p.maxPayloadBytes, developmentOperationalArtifactBytes), 'Canonical review input/tool/observation/checkpoint/binding cannot fit operational bounds');
  const V = p.maxResponseBytes, D = p.maxModelRequests * (rp.maxPayloadBytes + rp.maxPromptBytes + rp.maxFragmentBytes) + p.maxToolReads * (C + developmentReviewReceiptBytes) + I + J + L + p.maxTotalCheckpointBytes + 2 * V;
  invariant(Number.isSafeInteger(D) && D <= rp.maxDrafts * (rp.maxPayloadBytes + rp.maxPromptBytes + rp.maxFragmentBytes), 'Conservative reviewer draft copies cannot fit');
  const caseCount = m.opportunities.length + m.controls.length + m.boundaries.length;
  const draftSlots = p.maxModelRequests * (2 + f) + 2 * p.maxToolReads + 2 + l + Q + caseCount + 2;
  const claimBytes = size({ bindingDigest: zero, source: { state: ids, workspace: ids }, status: 'unavailable', reason: '\u0000'.repeat(512), binding, evidenceReads: execution.evidenceReads, checkpointBytes: p.maxTotalCheckpointBytes, toolReads: p.maxToolReads, readBytes: p.maxTotalReadBytes, checkpoints: Q });
  // Separate local operational draft/checkpoint copies, claim, raw/final binding copies and read metadata.
  const metadataBytes = D + (p.maxModelRequests+p.maxToolReads)*V + p.maxToolReads * observationBytes + claimBytes + 2 * J + p.maxToolReads * size(access);
  return { roleId: s.roleId, sessionDigest: identity(s), draftBytes: D, draftSlots, responseBytes: (p.maxModelRequests + p.maxToolReads) * V, bindingBytes: J, readEntryBytes: size(access), claimBytes, metadataBytes, inputBytes: I, initialPayloadBytes: Buffer.byteLength(initialPayload),continuationPayloadBytes:Buffer.byteLength(continuation), toolCallBytes: C, observationBytes, checkpointArtifacts: Q, maxPromptFragments: f, instructionBytes: L };
}

export function reviewAdmissionSources(a: ReviewAdmission, read: (ref: ArtifactRef, bound: number) => Uint8Array): ReviewAdmissionSource[] {
  const items = new Map<string, ReviewAdmissionSource>();
  const add = (bytes: Uint8Array) => { const sha256 = hashBytes(bytes); items.set(sha256, { artifact: { uri: `sha256:${sha256}`, sha256 }, bytes: bytes.byteLength, contentBase64: Buffer.from(bytes).toString('base64') }); };
  for (const s of a.sessions) for (const f of [...s.prompt.fragments, ...(s.compaction ? [s.compaction.instruction] : [])]) {
    const bytes = Uint8Array.from(read({uri:`sha256:${f.artifact.sha256}`,sha256:f.artifact.sha256}, s.plan.maxPayloadBytes)); invariant(bytes.byteLength <= s.plan.maxPayloadBytes && hashBytes(bytes) === f.artifact.sha256, 'Accepted reviewer instruction changed'); add(bytes);
  }
  add(Buffer.from(canonicalJson({ version: a.version, sessions: a.sessions, template: a.template, host: a.host, acceptedSessions: [...a.acceptedSessions].sort(([x],[y])=>x.localeCompare(y)), acceptedTemplateDigest: a.acceptedTemplateDigest, acceptedHostDigest: a.acceptedHostDigest })));
  add(Buffer.from(JSON.stringify(boundedDevelopmentReviewTools))); if (a.sessions.some(s => s.compaction)) add(Buffer.from('[]'));
  invariant([...items.values()].every(i => i.bytes <= developmentOperationalArtifactBytes), 'Review source descriptor exceeds operational bound');
  return [...items.values()];
}
