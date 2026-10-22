import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson, identity, type Run } from '../packages/contracts/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { Validator, type Schema } from '../packages/narrow-schema/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { admitCandidate, admissionPolicyIdentity, type AdmissionPolicy } from '../packages/release/admission.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import { policyDescriptor } from '../packages/release/controller.ts';
import { freezeApplication, type DeploymentInputs } from './candidate.ts';
import { assertEngineeringExecutionControls, createEngineeringPlan, engineeringCases, engineeringPlanMount, nodeEngineeringReviewEnvironment, parseEngineeringPlan, reconstructSourceAfter, runEngineeringReview, type EngineeringReviewOptions } from './engineering-review.ts';
import { reviewerDescriptor, type ReviewerFile } from './evaluation-dispatch.ts';
import type { EvaluationRequest } from './evolution-tools.ts';
import type { ModelProfile } from './model-grants.ts';
import { rewriteSourceEntries } from './source-workspace.ts';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const model: ModelProfile = { provider: 'mistral', id: 'mistral-large-4-0', contextWindow: 262144, reasoning: false, effort: 'none',
  maxOutputTokens: 2048, maxRequestsPerSlice: 1, timeoutMs: 10000, pricesPerMillion: { input: 0.5, output: 1.5 } };
const passed = { exitCode: 0, signal: null, stdout: '', stderr: '', elapsedMs: 1 } as const;

test('lossless source decoder preserves exact segments and rejects malformed grammar instead of guessing source', () => {
  const before = '\uFEFFfirst 漢🙂\r\nsecond\nunterminated\r', encoded = { kind: 'copy-before-lines', parts: [{ beforeLines: [2, 3] }, { text: '\ninsert\r\n' }, { beforeLines: [0, 2] }, { beforeLines: [0, 1] }] };
  assert.equal(reconstructSourceAfter(before, encoded), 'unterminated\r\ninsert\r\n\uFEFFfirst 漢🙂\r\nsecond\n\uFEFFfirst 漢🙂\r\n');
  assert.equal(reconstructSourceAfter(before, { kind: 'copy-before-lines', parts: [] }), '');
  assert.equal(reconstructSourceAfter(null, '\uFEFFnew\r\nno newline'), '\uFEFFnew\r\nno newline'); assert.equal(reconstructSourceAfter(before, null), null);
  for (const after of [undefined, 4, true, [], {}, { kind: 'other', parts: [] }, { kind: 'copy-before-lines' }, { kind: 'copy-before-lines', parts: null },
    { kind: 'copy-before-lines', parts: [], extra: true }]) assert.throws(() => reconstructSourceAfter(before, after));
  assert.throws(() => reconstructSourceAfter(null, encoded), 'Copied source cannot refer to an absent before file');
  assert.throws(() => reconstructSourceAfter(before, Object.assign(Object.create({ kind: 'copy-before-lines' }), { parts: [], extra: true })));
  assert.throws(() => reconstructSourceAfter(before, Object.assign(Object.create({ parts: [] }), { kind: 'copy-before-lines', extra: true })));
  assert.throws(() => reconstructSourceAfter(before, { kind: 'copy-before-lines', parts: [Object.assign(Object.create({ beforeLines: [0, 1] }), { extra: true })] }));
  for (const part of [null, [], 'literal', {}, { text: 4 }, { text: 'x', beforeLines: [0, 1] }, { text: 'x', extra: true }, { unknown: true },
    ...[[], [0], [0, 1, 2], [-1, 1], [0, 0], [1, 0], [0, 4], [0.5, 1], [0, Infinity], [0, NaN], [0, Number.MAX_SAFE_INTEGER + 1], ['0', 1]].map(beforeLines => ({ beforeLines }))]) {
    assert.throws(() => reconstructSourceAfter(before, { kind: 'copy-before-lines', parts: [part] }));
  }
  assert.throws(() => reconstructSourceAfter('', { kind: 'copy-before-lines', parts: [{ beforeLines: [0, 1] }] }));
  assert.throws(() => reconstructSourceAfter('ab\n', { kind: 'copy-before-lines', parts: [{ beforeLines: [0, 1] }, { beforeLines: [0, 1] }] }, 5), /byte bound/);
  const unicodeCopy = { kind: 'copy-before-lines', parts: [{ beforeLines: [0, 1] }, { text: '🙂' }] };
  assert.equal(reconstructSourceAfter('漢\n', unicodeCopy, 8), '漢\n🙂');
  assert.throws(() => reconstructSourceAfter('漢\n', unicodeCopy, 7), /byte bound/);
  assert.equal(reconstructSourceAfter(null, '漢🙂', 7), '漢🙂'); assert.throws(() => reconstructSourceAfter(null, '漢🙂', 6), /byte bound/);
  const plan = { ...createEngineeringPlan({ ...model, contextWindow: 1000000 }), maxChangedFiles: 64, maxDiffBytes: 786432 };
  assert.equal(parseEngineeringPlan(Buffer.from(canonicalJson(plan))).maxDiffBytes, 786432);
  assert.equal(reconstructSourceAfter(before, encoded, plan.maxDiffBytes), reconstructSourceAfter(before, encoded));
  assert.throws(() => parseEngineeringPlan(Buffer.from(canonicalJson({ ...plan, maxDiffBytes: 1048577 }))));
  for (const bound of [-1, Infinity, NaN, 0.5, 1048577]) assert.throws(() => reconstructSourceAfter(before, null, bound));
});

test('independent engineering review binds actual compiler, exact prompt source and fresh model verdict to prior controls', { timeout: 180000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'engineering-review-'));
  const host = { stateDirectory: join(root, 'state'), workspaceDirectory: join(root, 'work'), artifactStore: join(root, 'artifacts'), nodeBinary: realpathSync(process.execPath) };
  for (const directory of Object.values(host).filter(path => path !== host.nodeBinary)) mkdirSync(directory);
  const source = join(root, 'source'); mkdirSync(join(source, 'deployment/prompts'), { recursive: true }); mkdirSync(join(source, 'packages'));
  writeFileSync(join(source, 'package.json'), '{"type":"module"}'); writeFileSync(join(source, 'package-lock.json'), '{"lockfileVersion":3}');
  writeFileSync(join(source, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'esnext', module: 'nodenext', strict: true, types: [] }, include: ['packages/*.ts'] }));
  writeFileSync(join(source, 'deployment/shell-worker.ts'), 'export {};\n');
  writeFileSync(join(source, 'deployment/prompts/mind.md'), 'Keep evidence exact.\n'); writeFileSync(join(source, 'deployment/prompts/compaction.md'), 'Retain provenance.\n');
  writeFileSync(join(source, 'packages/example.ts'), 'export const observed: number = 42;\n');
  cpSync(realpathSync(join(repository, 'node_modules')), join(source, 'node_modules'), { recursive: true });
  const key = Buffer.alloc(32, 79), evaluatorId = 'independent-engineering-fixture', assets = join(root, 'reviewer'); mkdirSync(assets);
  const reviewerNode = join(assets, 'node'); writeFileSync(reviewerNode, readFileSync(host.nodeBinary), { mode: 0o500 });
  const keyFile = join(assets, 'key'); writeFileSync(keyFile, key, { mode: 0o400 });
  const rules = { kind: 'engineering' as const, requiredCases: [...engineeringCases], evaluatorKeys: new Map([[evaluatorId, key]]), evaluatorArtifacts: new Map([[evaluatorId, identity('bootstrap')]]) };
  const resources = { maxRequests: 100, maxTokens: 10000000, maxCostUsd: 10, maxElapsedMs: 600000, maxConcurrency: 1 };
  const inputs: DeploymentInputs = { createdBy: 'author', prompts: { mind: 'Keep evidence exact.\n', compaction: 'Retain provenance.\n' },
    runtime: { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch }, policy: policyDescriptor(rules),
    configuration: { bootstrapInitiative: false, model, resources, conversationResources: resources,
      scheduler: { windowMs: 1000, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources },
      maxConcurrentRuns: 1, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'public' }, modificationEligible: true } } };
  const accepted = freezeApplication(source, host.artifactStore, inputs);
  const nextPrompt = 'Keep evidence exact. Inspect each actual observation before reporting success.\n'; writeFileSync(join(source, 'deployment/prompts/mind.md'), nextPrompt);
  const candidate = freezeApplication(source, host.artifactStore, { ...inputs, prompts: { ...inputs.prompts, mind: nextPrompt } });
  const authority = { generation: 'author', epoch: 1, controlRevision: accepted.manifest.controls };
  const store = new OperationalStore({ filename: join(host.stateDirectory, 'operations.sqlite') });
  let number = 0;
  function fixture(overrides: Partial<EngineeringReviewOptions> = {}, alterPlan?: (plan: ReturnType<typeof createEngineeringPlan>) => void) {
    const plan = createEngineeringPlan(model); alterPlan?.(plan);
    const planPath = join(assets, `plan-${++number}.json`); const bytes = canonicalJson(plan); writeFileSync(planPath, bytes, { mode: 0o400 });
    const config: ReviewerFile = { evaluatorId, files: [{ path: reviewerNode, mount: '/reviewer/node', sha256: hashBytes(readFileSync(reviewerNode)) },
      { path: planPath, mount: engineeringPlanMount, sha256: hashBytes(bytes) }], executable: '/reviewer/node', args: [], keyFile,
      pollMs: 10, maxElapsedMs: 60000, maxOutputBytes: 4 * 1024 * 1024, maxClosureBytes: 128 * 1024 * 1024, memoryBytes: 1024 * 1024 * 1024 };
    const evaluatorDigest = hashBytes(reviewerDescriptor(config)), fields = { ...rules, controlRevision: authority.controlRevision, evaluatorArtifacts: new Map([[evaluatorId, evaluatorDigest]]) };
    const policy: AdmissionPolicy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
    const id = `review-${number}`, ledger = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 }); ledger.allocate(id, resources);
    store.put('runs', id, { id, status: 'waiting', authority, scope: { kind: 'public' } } as Run, null);
    const request: EvaluationRequest = { requestId: id, policyDigest: policy.policyDigest, candidate, proposal: { id, runId: id, authority, scope: { kind: 'public' },
      state: 'frozen', candidate: candidate.manifest, justification: 'Inspect actual evidence before a success claim.', goal: { objective: 'Improve source-owned mind instructions.', successCriteria: ['prompt requires actual evidence'] },
      provenance: { kind: 'self', inputId: id, actorId: 'author', goalId: 'finite' }, experience: store.putArtifact('Observed an unsupported success claim.') } };
    let calls = 0;
    const respond = (payload: string, verdict: 'pass' | 'fail' | 'refuse' = 'pass', changedBinding = false) => {
      const envelope = JSON.parse(payload), packet = JSON.parse(envelope.messages[1].content);
      assert.equal(envelope.model, model.id); assert.equal(envelope.reasoning_effort, undefined); assert.equal(envelope.messages.length, 2);
      assert.equal(packet.changes.length, 1); assert.equal(packet.changes[0].path, 'deployment/prompts/mind.md');
      assert.equal(packet.changes[0].before, inputs.prompts.mind); assert.equal(packet.changes[0].after, nextPrompt);
      assert.deepEqual(packet.inputChanges, [{ field: 'prompts', path: '/prompts/mind', beforePresent: true, afterPresent: true, before: inputs.prompts.mind, after: nextPrompt }]);
      const content = { requestId: changedBinding ? 'another-request' : id, candidateId: candidate.manifest.id, policyDigest: policy.policyDigest,
        verdict, reason: verdict === 'pass' ? 'The exact prompt requires actual observation and preserves accepted controls.' : 'The finite evidence does not justify accepting this change.', findings: verdict === 'pass' ? [] : ['Concrete fixture concern.'] };
      return { status: 200, body: JSON.stringify({ model: model.id, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }], usage: { prompt_tokens: 800, completion_tokens: 100 } }) };
    };
    const options: EngineeringReviewOptions = { store, request, evaluatorId, evaluatorDigest, maxElapsedMs: config.maxElapsedMs,
      environment: { ...nodeEngineeringReviewEnvironment(), assertExecutionControls(_host, revision) {
        assert.equal(revision, authority.controlRevision, 'Development fixture explicitly supplies its accepted execution controls');
        return { candidateId: accepted.manifest.id, controls: accepted.manifest.controls, source: accepted.manifest.source };
      } },
      assertAuthority(value) { assert.deepEqual(value, authority); }, dispatchAuthority(_value, operation) { operation(); },
      timeoutSignal: ms => AbortSignal.timeout(ms), runCommand: async command => {
        assert.ok(command.protectedPaths.includes(keyFile)); assert.ok(command.protectedPaths.includes(host.stateDirectory));
        assert.equal(command.applicationRoot, join(host.artifactStore, accepted.manifest.id, 'payload'));
        assert.equal(command.args[0], '/app/node_modules/typescript/bin/tsc'); assert.ok(command.args.includes('/work/tsconfig.json'));
        assert.equal(readFileSync(join(command.workspace, 'deployment/prompts/mind.md'), 'utf8'), nextPrompt); return passed;
      }, performRequest: async payload => { calls++; return respond(payload); }, ...overrides };
    return { config, policy, request, options, ledger, respond, get calls() { return calls; } };
  }
  try {
    await t.test('lossless review source packet reconstructs separated edits with UTF-8 BOM, mixed line endings and source metadata under the unchanged shared bound', async () => {
      const f = fixture(), directory = join(root, 'lossless-packet-source');
      cpSync(join(host.artifactStore, accepted.manifest.id, 'payload'), directory, { recursive: true });
      mkdirSync(join(directory, 'docs/rewrite'), { recursive: true });
      mkdirSync(join(directory, 'docs/adr'), { recursive: true });
      const path = 'docs/rewrite/packet-existing.md', removed = 'docs/rewrite/packet-removed.md', added = 'docs/rewrite/packet-added.md', modePath = 'docs/rewrite/packet-mode.md';
      const lines = Array.from({ length: 1100 }, (_, i) => `${i}:漢字🙂 ${'x'.repeat(80)}${i % 2 ? '\n' : '\r\n'}`);
      lines[0] = '\uFEFF' + lines[0]; lines.push('last line 漢🙂 without newline');
      const before = lines.join(''), edited = [...lines];
      edited[70] = 'first independent replacement 漢🙂\r\n'; edited[901] = 'second independent replacement\n';
      edited.splice(400, 0, 'inserted line\r\n'); edited.splice(650, 1); const after = edited.join('');
      writeFileSync(join(directory, path), before); writeFileSync(join(directory, removed), 'deleted 漢🙂\r\n');
      writeFileSync(join(directory, modePath), 'mode unchanged text\r\nno final newline'); chmodSync(join(directory, modePath), 0o644);
      const baseline = freezeApplication(directory, host.artifactStore, inputs);
      writeFileSync(join(directory, path), after); rmSync(join(directory, removed)); writeFileSync(join(directory, added), '\uFEFFnew 漢🙂\r\nno final newline');
      chmodSync(join(directory, modePath), 0o755);
      const target = freezeApplication(directory, host.artifactStore, { ...inputs, configuration: { ...inputs.configuration, pollMs: 201 } });
      assert.equal(target.manifest.controls, baseline.manifest.controls, 'The large real frozen fixture changes non-control source only');
      const request = { ...f.request, candidate: target, proposal: { ...f.request.proposal, candidate: target.manifest } }; let models = 0, captured = '';
      const result = await runEngineeringReview(f.config, host, request, f.policy, baseline.manifest.id, { ...f.options, request, runCommand: async () => passed,
        performRequest: async payload => {
          models++; captured = payload; const envelope = JSON.parse(payload), packet = JSON.parse(envelope.messages[1].content);
          const changes = packet.changes as Array<{ path: string; before: string | null; after: unknown; beforeSha256: string | null; afterSha256: string | null; beforeExecutable: boolean | null; afterExecutable: boolean | null }>;
          const change = changes.find(change => change.path === path)!;
          assert.equal(change.before, before, 'BOM and original line terminators are exact before bytes');
          assert.ok(change.after && typeof change.after === 'object', 'Oversized duplicated text uses the lossless after representation');
          const encoded = change.after as { kind: string; parts: Array<{ beforeLines?: [number, number]; text?: string }> };
          assert.deepEqual(Object.keys(encoded).sort(), ['kind', 'parts']); assert.equal(encoded.kind, 'copy-before-lines');
          const originalLines = before.match(/[^\n]*\n|[^\n]+$/g)!; let copies = 0, literals = 0;
          const reconstructed = encoded.parts.map(part => {
            if (Object.hasOwn(part, 'beforeLines')) {
              assert.deepEqual(Object.keys(part), ['beforeLines']); const [start, end] = part.beforeLines!;
              assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < end && end <= originalLines.length);
              copies++; return originalLines.slice(start, end).join('');
            }
            assert.deepEqual(Object.keys(part), ['text']); assert.equal(typeof part.text, 'string'); literals++; return part.text!;
          }).join('');
          assert.ok(copies > 0 && literals > 0, 'The exact after mixes retained original source and literal changes');
          assert.equal(reconstructed, after); assert.equal(hashBytes(reconstructed), change.afterSha256); assert.equal(hashBytes(before), change.beforeSha256);
          assert.equal(change.beforeExecutable, false); assert.equal(change.afterExecutable, false);
          for (const entry of changes.filter(change => change.path !== path)) {
            assert.ok(entry.after === null || typeof entry.after === 'string', 'New/deleted and small mode changes retain literal/null form');
            if (entry.before !== null) assert.equal(hashBytes(entry.before), entry.beforeSha256);
            if (typeof entry.after === 'string') assert.equal(hashBytes(entry.after), entry.afterSha256);
          }
          assert.deepEqual(changes.find(change => change.path === added), { path: added, before: null, after: '\uFEFFnew 漢🙂\r\nno final newline', beforeSha256: null, afterSha256: hashBytes('\uFEFFnew 漢🙂\r\nno final newline'), beforeExecutable: null, afterExecutable: false });
          assert.deepEqual(changes.find(change => change.path === removed), { path: removed, before: 'deleted 漢🙂\r\n', after: null, beforeSha256: hashBytes('deleted 漢🙂\r\n'), afterSha256: null, beforeExecutable: false, afterExecutable: null });
          const modeChange = changes.find(change => change.path === modePath)!;
          assert.equal(modeChange.before, modeChange.after); assert.equal(modeChange.beforeExecutable, false); assert.equal(modeChange.afterExecutable, true);
          assert.deepEqual(packet.inputChanges, [{ field: 'configuration', path: '/configuration/pollMs', beforePresent: true, afterPresent: true, before: 100, after: 201 }]);
          const full = { changes: changes.map(change => change.path === path ? { ...change, after } : change), inputChanges: packet.inputChanges };
          assert.ok(Buffer.byteLength(canonicalJson(full)) > createEngineeringPlan(model).maxDiffBytes);
          assert.ok(Buffer.byteLength(canonicalJson({ changes, inputChanges: packet.inputChanges })) <= createEngineeringPlan(model).maxDiffBytes);
          assert.ok(Buffer.byteLength(payload) + model.maxOutputTokens <= model.contextWindow);
          assert.ok(envelope.messages[0].content.startsWith(createEngineeringPlan(model).instructions));
          assert.match(envelope.messages[0].content, /copy-before-lines/);
          return { status: 200, body: JSON.stringify({ model: model.id, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ requestId: request.requestId, candidateId: target.manifest.id,
            policyDigest: f.policy.policyDigest, verdict: 'pass', reason: 'Every complete source byte, edit and mode is independently reconstructible under the unchanged bound.', findings: [] }) } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }) };
        } });
      assert.equal(models, 1, 'Lossless factoring permits exactly one actual independent review dispatch'); assert.equal(result.result.receipt.evidence[0]!.verdict, 'pass');
      const physical = f.ledger.request(`engineering-model:${request.requestId}`)!;
      const retained = store.get<{ prompt: import('../packages/contracts/index.ts').ArtifactRef }>('host.engineering-prompts', physical.id)!.value.prompt;
      assert.equal(Buffer.from(store.readArtifact(retained)).toString('utf8'), captured); assert.equal(physical.requestDigest, hashBytes(captured)); assert.equal(physical.status, 'succeeded');
    });
    await t.test('lossless review source packet honestly refuses unique source and oversized deployment inputs without model dispatch', async () => {
      const directory = join(root, 'unfactorable-source'); cpSync(join(host.artifactStore, accepted.manifest.id, 'payload'), directory, { recursive: true });
      mkdirSync(join(directory, 'docs/rewrite'), { recursive: true }); mkdirSync(join(directory, 'docs/adr'), { recursive: true }); const path = join(directory, 'docs/rewrite/unique.md');
      writeFileSync(path, 'A'.repeat(110000) + '\n'); const baseline = freezeApplication(directory, host.artifactStore, inputs);
      for (const kind of ['unique-source', 'deployment-input', 'binary-source', 'invalid-utf8-source'] as const) {
        const f = fixture();
        writeFileSync(path, kind === 'unique-source' ? 'B'.repeat(110000) + '\n' : 'A'.repeat(110000) + '\nsmall edit\n');
        if (kind === 'binary-source') writeFileSync(path, Buffer.from([0x41, 0, 0x42]));
        if (kind === 'invalid-utf8-source') writeFileSync(path, Buffer.from([0xc3, 0x28]));
        const target = freezeApplication(directory, host.artifactStore, kind === 'deployment-input' ? { ...inputs, configuration: { ...inputs.configuration, semanticFixture: 'C'.repeat(100000) } as DeploymentInputs['configuration'] } : inputs);
        const request = { ...f.request, candidate: target, proposal: { ...f.request.proposal, candidate: target.manifest } }; let models = 0;
        const result = await runEngineeringReview(f.config, host, request, f.policy, baseline.manifest.id, { ...f.options, request, runCommand: async () => passed,
          performRequest: async () => { models++; throw Error('No complete bounded review representation exists'); } });
        assert.equal(result.result.receipt.evidence[0]!.verdict, 'inconclusive', kind); assert.equal(models, 0, kind);
        assert.equal(f.ledger.request(`engineering-model:${request.requestId}`), undefined, 'Refusal does not reserve or fabricate a model review');
      }
    });
    await t.test('raw model request strictly constrains the exact review envelope without changing verdict choices or local accounting', async () => {
      const f = fixture(); let calls = 0, captured = '';
      f.options.performRequest = async payload => {
        calls++; captured = payload;
        const envelope = JSON.parse(payload), format = envelope.response_format;
        assert.ok(format, 'Outgoing review request must include response_format before provider dispatch');
        assert.equal(format.type, 'json_schema'); assert.equal(format.json_schema.name, 'engineering_source_verdict'); assert.equal(format.json_schema.strict, true);
        assert.equal(Object.hasOwn(format.json_schema, 'schema_definition'), false, 'Python SDK input alias is not a raw HTTP field');
        assert.equal(Object.hasOwn(format.json_schema, 'schemaDefinition'), false, 'TypeScript SDK input alias is not a raw HTTP field');
        const schema = format.json_schema.schema;
        assert.ok(schema, 'Raw Mistral HTTP serializes the schema under json_schema.schema');
        assert.equal(schema.type, 'object'); assert.equal(schema.additionalProperties, false);
        const fields = ['requestId', 'candidateId', 'policyDigest', 'verdict', 'reason', 'findings'];
        assert.deepEqual([...schema.required].sort(), [...fields].sort()); assert.deepEqual(Object.keys(schema.properties).sort(), [...fields].sort());
        for (const [field, value] of [['requestId', f.request.requestId], ['candidateId', candidate.manifest.id], ['policyDigest', f.policy.policyDigest]]) {
          assert.deepEqual(schema.properties[field], { type: 'string', enum: [value] }, `${field} is an exact host-issued constant`);
        }
        assert.deepEqual(schema.properties.verdict, { type: 'string', enum: ['pass', 'fail', 'refuse'] });
        assert.equal(schema.properties.reason.type, 'string'); assert.equal(schema.properties.findings.type, 'array'); assert.equal(schema.properties.findings.items.type, 'string');
        const validator = new Validator(schema as Schema), valid = { requestId: f.request.requestId, candidateId: candidate.manifest.id, policyDigest: f.policy.policyDigest, verdict: 'pass', reason: 'Exact engineering evidence.', findings: [] };
        for (const verdict of ['pass', 'fail', 'refuse']) assert.equal(validator.validate({ ...valid, verdict }).valid, true, `${verdict} remains expressible`);
        for (const changed of [{ requestId: f.request.requestId.slice(0, -1) }, { candidateId: 'short-candidate' }, { policyDigest: 'short-policy' }, { verdict: 'accept' }, { reason: 1 }, { findings: ['retained concern', 2] }, { extra: true }]) {
          assert.equal(validator.validate({ ...valid, ...changed }).valid, false, JSON.stringify(changed));
        }
        for (const field of fields) { const missing = { ...valid } as Record<string, unknown>; delete missing[field]; assert.equal(validator.validate(missing).valid, false, `Missing ${field} refuses`); }
        return f.respond(payload);
      };
      const result = await runEngineeringReview(f.config, host, f.request, f.policy, accepted.manifest.id, f.options);
      assert.equal(calls, 1); assert.equal(result.result.receipt.evidence[0]!.verdict, 'pass');
      const physical = f.ledger.request(`engineering-model:${f.request.requestId}`)!;
      const retained = store.get<{ prompt: import('../packages/contracts/index.ts').ArtifactRef }>('host.engineering-prompts', physical.id)!.value.prompt;
      assert.equal(Buffer.from(store.readArtifact(retained)).toString('utf8'), captured); assert.equal(physical.requestDigest, hashBytes(captured));
      assert.equal(physical.status, 'succeeded'); assert.equal(f.ledger.snapshot(f.request.proposal.runId).concurrent, 0);
    });
    await t.test('real sibling compiler and fresh independent model produce admissible signed evidence', async () => {
      const f = fixture({ runCommand: undefined });
      const result = await runEngineeringReview(f.config, host, f.request, f.policy, accepted.manifest.id, f.options);
      assert.equal(result.result.receipt.evidence[0]!.verdict, 'pass'); assert.equal(f.calls, 1);
      const blobs = new Map(result.artifacts.map(blob => [blob.sha256, Buffer.from(blob.base64, 'base64')]));
      assert.equal(admitCandidate(host.artifactStore, result.result.proof.proposal, authority, f.policy, result.result.proof.signed, uri => blobs.get(uri.slice(7))!).candidateId, candidate.manifest.id);
      const requests = store.list<{ request: { runId: string; purpose: string; provider: string; usage: { inputTokens: number; costUsd: number } } }>('requests').map(row => row.value.request).filter(value => value.runId === f.request.proposal.runId);
      assert.equal(requests.length, 2); const modelRequest = requests.find(request => request.provider === 'mistral')!;
      assert.equal(modelRequest.purpose, 'review'); assert.equal(modelRequest.usage.inputTokens, 800); assert.equal(modelRequest.usage.costUsd, 0.00055);
      assert.equal(f.ledger.snapshot(f.request.proposal.runId).concurrent, 0);
      await assert.rejects(runEngineeringReview(f.config, host, f.request, f.policy, accepted.manifest.id, f.options), /already used|unused prepared/);
      assert.equal(f.calls, 1, 'A repeated review identity must not make another model call');
    });
    for (const verdict of ['fail', 'refuse'] as const) await t.test(`known independent ${verdict} remains signed feedback`, async () => {
      const f = fixture(); f.options.performRequest = async payload => f.respond(payload, verdict);
      const result = await runEngineeringReview(f.config, host, f.request, f.policy, accepted.manifest.id, f.options);
      assert.equal(result.result.receipt.evidence[0]!.verdict, verdict === 'fail' ? 'fail' : 'inconclusive'); assert.equal(result.result.proof.signed.length, 1);
      assert.throws(() => admitCandidate(host.artifactStore, result.result.proof.proposal, authority, f.policy, result.result.proof.signed, () => Buffer.alloc(0)), /passing evidence/);
    });
    await t.test('failed compiler yields known failure and never requests model judgment', async () => {
      const f = fixture({ runCommand: async () => ({ ...passed, exitCode: 2, stdout: 'Exact TS fixture error.' }) });
      const result = await runEngineeringReview(f.config, host, f.request, f.policy, accepted.manifest.id, f.options);
      assert.equal(result.result.receipt.evidence[0]!.verdict, 'fail'); assert.equal(f.calls, 0);
      assert.deepEqual(result.result.receipt.evidence[0]!.caseResults.map(value => value.status), ['fail', 'unavailable']);
    });
    await t.test('oversized exact source refuses without truncation or model request', async () => {
      const f = fixture({}, plan => { plan.maxDiffBytes = 10; });
      const result = await runEngineeringReview(f.config, host, f.request, f.policy, accepted.manifest.id, f.options);
      assert.equal(result.result.receipt.evidence[0]!.verdict, 'inconclusive'); assert.equal(f.calls, 0);
    });
    for (const failure of ['binding', 'http', 'malformed', 'transport', 'cancelled'] as const) await t.test(`${failure} never signs or automatically retries model evidence`, async () => {
      const controller = new AbortController(), f = fixture({ signal: controller.signal }); let calls = 0;
      f.options.performRequest = async payload => { calls++;
        if (failure === 'transport') throw Error('Unknown transport outcome');
        if (failure === 'cancelled') controller.abort(Error('cancelled independent review'));
        if (failure === 'http') return { status: 503, body: '{"error":"unknown provider outcome"}' };
        if (failure === 'malformed') return { status: 200, body: '{"model":"mistral-large-4-0","choices":[]}' };
        return f.respond(payload, 'pass', failure === 'binding');
      };
      await assert.rejects(runEngineeringReview(f.config, host, f.request, f.policy, accepted.manifest.id, f.options));
      assert.equal(calls, 1); const physical = f.ledger.request(`engineering-model:${f.request.requestId}`)!;
      assert.ok(['uncertain', 'succeeded'].includes(physical.status)); assert.equal(store.get('host.engineering-responses', physical.id) !== undefined, failure !== 'transport');
      assert.equal(f.ledger.snapshot(f.request.proposal.runId).concurrent, 0);
    });
    await t.test('another required policy case is refused before physical work', async () => {
      const f = fixture(); const fields = { ...f.policy, requiredCases: [...engineeringCases, 'unobserved-behavior'] }; const policy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
      await assert.rejects(runEngineeringReview(f.config, host, f.request, policy, accepted.manifest.id, f.options), /other or product cases/); assert.equal(f.calls, 0);
      assert.equal(f.ledger.snapshot(f.request.proposal.runId).requests, 0);
    });
    await t.test('mutable or wrong execution controls fail before command, provider request or signing', async () => {
      const f = fixture(); let commands = 0;
      f.options.environment = nodeEngineeringReviewEnvironment(); f.options.runCommand = async () => { commands++; return passed; };
      assert.throws(() => assertEngineeringExecutionControls(host, authority.controlRevision), /exact frozen host payload/);
      await assert.rejects(runEngineeringReview(f.config, host, f.request, f.policy, accepted.manifest.id, f.options), /exact frozen host payload/);
      assert.equal(commands, 0); assert.equal(f.calls, 0); assert.equal(f.ledger.snapshot(f.request.proposal.runId).requests, 0);
    });
    await t.test('changed sealed plan, key and authority cannot use a previously admitted reviewer', async () => {
      for (const changed of ['plan', 'key', 'authority'] as const) {
        const f = fixture(); let commands = 0;
        f.options.runCommand = async () => { commands++; return passed; };
        if (changed === 'plan') { const path = f.config.files.find(file => file.mount === engineeringPlanMount)!.path; chmodSync(path, 0o600);
          writeFileSync(path, canonicalJson({ ...createEngineeringPlan(model), maxChangedFiles: 1 })); }
        if (changed === 'key') { chmodSync(keyFile, 0o600); writeFileSync(keyFile, Buffer.alloc(32, 80)); }
        if (changed === 'authority') f.options.assertAuthority = () => { throw Error('Withdrawn original author authority'); };
        try { await assert.rejects(runEngineeringReview(f.config, host, f.request, f.policy, accepted.manifest.id, f.options));
          assert.equal(commands, 0); assert.equal(f.calls, 0); assert.equal(f.ledger.snapshot(f.request.proposal.runId).requests, 0);
        } finally { if (changed === 'key') writeFileSync(keyFile, key); }
      }
    });
    for (const field of ['configuration', 'prompts'] as const) await t.test(`exact ${field}-only change is independently reviewed without fabricating a source edit`, async () => {
      const f = fixture(), changedInputs = field === 'configuration' ? { ...inputs, configuration: { ...inputs.configuration, pollMs: 200 } }
        : { ...inputs, prompts: { ...inputs.prompts, mind: 'Retain actual observation provenance before reporting success.' } };
      const target = freezeApplication(join(host.artifactStore, accepted.manifest.id, 'payload'), host.artifactStore, changedInputs);
      assert.equal(target.manifest.source, accepted.manifest.source); assert.notEqual(target.manifest[field], accepted.manifest[field]);
      const request = { ...f.request, candidate: target, proposal: { ...f.request.proposal, candidate: target.manifest } }; let models = 0;
      const result = await runEngineeringReview(f.config, host, request, f.policy, accepted.manifest.id, { ...f.options, request,
        runCommand: async command => { assert.equal(readFileSync(join(command.workspace, 'deployment/prompts/mind.md'), 'utf8'), inputs.prompts.mind); return passed; },
        performRequest: async payload => { models++; const envelope = JSON.parse(payload), packet = JSON.parse(envelope.messages[1].content);
          assert.deepEqual(packet.changes, []);
          assert.deepEqual(packet.inputChanges, field === 'configuration' ? [{ field, path: '/configuration/pollMs', beforePresent: true, afterPresent: true, before: 100, after: 200 }]
            : [{ field, path: '/prompts/mind', beforePresent: true, afterPresent: true, before: inputs.prompts.mind, after: changedInputs.prompts.mind }]);
          assert.equal(envelope.messages[0].content, createEngineeringPlan(model).instructions);
          return { status: 200, body: JSON.stringify({ model: model.id, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ requestId: request.requestId,
            candidateId: target.manifest.id, policyDigest: f.policy.policyDigest, verdict: 'pass', reason: `The exact ${field} change meets the finite fixture objective.`, findings: [] }) } }],
            usage: { prompt_tokens: 500, completion_tokens: 100 } }) };
        } });
      assert.equal(models, 1); assert.equal(result.result.receipt.evidence[0]!.verdict, 'pass');
      const summary = result.artifacts.find(blob => blob.sha256 === result.result.receipt.evidence[0]!.artifact.sha256)!;
      assert.deepEqual(JSON.parse(Buffer.from(summary.base64, 'base64').toString('utf8')).changedInputs, [field]);
    });
    await t.test('createdBy-only candidates remain empty changes and never request an independent model', async () => {
      const f = fixture(), target = freezeApplication(join(host.artifactStore, accepted.manifest.id, 'payload'), host.artifactStore, { ...inputs, createdBy: 'different-author' });
      assert.notEqual(target.manifest.id, accepted.manifest.id); const request = { ...f.request, candidate: target, proposal: { ...f.request.proposal, candidate: target.manifest } };
      const result = await runEngineeringReview(f.config, host, request, f.policy, accepted.manifest.id, { ...f.options, request, runCommand: async () => passed });
      assert.equal(f.calls, 0); assert.equal(result.result.receipt.evidence[0]!.verdict, 'inconclusive');
    });
    await t.test('recursive input changes preserve escaped keys, null presence, array length and container types', async () => {
      const f = fixture(), payloadRoot = join(host.artifactStore, accepted.manifest.id, 'payload');
      const baseline = freezeApplication(payloadRoot, host.artifactStore, { ...inputs, configuration: { ...inputs.configuration,
        semanticFixture: { 'a/b~': { removed: null, retained: 1 }, array: [null, 'old', 'removed'], empty: {}, expanded: [null], removedEmpty: {} } } as DeploymentInputs['configuration'] });
      const target = freezeApplication(payloadRoot, host.artifactStore, { ...inputs, configuration: { ...inputs.configuration,
        semanticFixture: { 'a/b~': { added: null, retained: 1 }, array: [null, 'new'], empty: [], expanded: [null, null], addedEmpty: {} } } as DeploymentInputs['configuration'] });
      const request = { ...f.request, candidate: target, proposal: { ...f.request.proposal, candidate: target.manifest } }; let models = 0;
      const result = await runEngineeringReview(f.config, host, request, f.policy, baseline.manifest.id, { ...f.options, request, runCommand: async () => passed,
        performRequest: async payload => { models++; const packet = JSON.parse(JSON.parse(payload).messages[1].content);
          assert.deepEqual(packet.changes, []);
          const change = (path: string, before: unknown, after: unknown, beforePresent = true, afterPresent = true) =>
            ({ field: 'configuration', path: `/configuration/semanticFixture/${path}`, beforePresent, afterPresent, before, after });
          assert.deepEqual(packet.inputChanges, [change('a~1b~0/added', null, null, false), change('a~1b~0/removed', null, null, true, false),
            change('addedEmpty', null, {}, false), { ...change('array', ['old', 'removed'], ['new']), arraySplice: { index: 1, beforeLength: 3, afterLength: 2 } },
            change('empty', {}, []), { ...change('expanded', [], [null]), arraySplice: { index: 1, beforeLength: 1, afterLength: 2 } }, change('removedEmpty', {}, null, true, false)]);
          return { status: 200, body: JSON.stringify({ model: model.id, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ requestId: request.requestId,
            candidateId: target.manifest.id, policyDigest: f.policy.policyDigest, verdict: 'pass', reason: 'The exact inert structural changes are present for independent inspection.', findings: [] }) } }],
            usage: { prompt_tokens: 1000, completion_tokens: 100 } }) };
        } });
      assert.equal(models, 1); assert.equal(result.result.receipt.evidence[0]!.verdict, 'pass');
    });
    await t.test('deployment input bytes consume the same finite diff allowance without truncation', async () => {
      const f = fixture({}, plan => { plan.maxDiffBytes = 100; }), target = freezeApplication(join(host.artifactStore, accepted.manifest.id, 'payload'), host.artifactStore,
        { ...inputs, prompts: { ...inputs.prompts, mind: 'X'.repeat(1024) } });
      const request = { ...f.request, candidate: target, proposal: { ...f.request.proposal, candidate: target.manifest } };
      const result = await runEngineeringReview(f.config, host, request, f.policy, accepted.manifest.id, { ...f.options, request, runCommand: async () => passed });
      assert.equal(f.calls, 0); assert.equal(result.result.receipt.evidence[0]!.verdict, 'inconclusive');
    });
    await t.test('combined executable metadata and prompt changes are both supplied exactly', async () => {
      const f = fixture(), executablePath = join(source, 'packages/example.ts'); chmodSync(executablePath, 0o755);
      const target = freezeApplication(source, host.artifactStore, { ...inputs, prompts: { ...inputs.prompts, mind: nextPrompt } }); chmodSync(executablePath, 0o644);
      const request = { ...f.request, candidate: target, proposal: { ...f.request.proposal, candidate: target.manifest } }; let models = 0;
      const result = await runEngineeringReview(f.config, host, request, f.policy, accepted.manifest.id, { ...f.options, request,
        performRequest: async payload => { models++; const packet = JSON.parse(JSON.parse(payload).messages[1].content);
          assert.equal(packet.changes.length, 2); const modeChange = packet.changes.find((change: { path: string }) => change.path === 'packages/example.ts');
          assert.equal(modeChange.before, modeChange.after); assert.equal(modeChange.beforeSha256, modeChange.afterSha256);
          assert.equal(modeChange.beforeExecutable, false); assert.equal(modeChange.afterExecutable, true);
          return { status: 200, body: JSON.stringify({ model: model.id, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ requestId: request.requestId,
            candidateId: target.manifest.id, policyDigest: f.policy.policyDigest, verdict: 'refuse', reason: 'The unrelated executable permission change lacks a justified purpose.', findings: ['Unjustified executable metadata change.'] }) } }],
            usage: { prompt_tokens: 1000, completion_tokens: 100 } }) };
        } });
      assert.equal(models, 1); assert.equal(result.result.receipt.evidence[0]!.verdict, 'inconclusive');
    });
    await t.test('two exact frozen accepted host generations inherit one unchanged sealed plan and the successor reviews a later change', async () => {
      const fullSource = join(root, 'full-host-source'); mkdirSync(fullSource);
      for (const entry of rewriteSourceEntries) {
        mkdirSync(dirname(join(fullSource, entry)), { recursive: true }); cpSync(join(repository, entry), join(fullSource, entry), { recursive: true });
      }
      cpSync(realpathSync(join(repository, 'node_modules')), join(fullSource, 'node_modules'), { recursive: true });
      const prompts = { mind: readFileSync(join(fullSource, 'deployment/prompts/mind.md'), 'utf8'), compaction: readFileSync(join(fullSource, 'deployment/prompts/compaction.md'), 'utf8') };
      const hostA = freezeApplication(fullSource, host.artifactStore, { ...inputs, prompts });
      writeFileSync(join(fullSource, 'packages/accepted-host-revision.ts'), 'export const independentlyAcceptedHostRevision = 2;\n');
      const hostB = freezeApplication(fullSource, host.artifactStore, { ...inputs, prompts }); assert.notEqual(hostB.manifest.controls, hostA.manifest.controls);
      const moduleA = await import(pathToFileURL(join(host.artifactStore, hostA.manifest.id, 'payload/deployment/engineering-review.ts')).href) as typeof import('./engineering-review.ts');
      const moduleB = await import(pathToFileURL(join(host.artifactStore, hostB.manifest.id, 'payload/deployment/engineering-review.ts')).href) as typeof import('./engineering-review.ts');
      assert.equal(moduleA.assertEngineeringExecutionControls(host, hostA.manifest.controls).candidateId, hostA.manifest.id);
      assert.equal(moduleB.assertEngineeringExecutionControls(host, hostB.manifest.controls).candidateId, hostB.manifest.id);
      assert.throws(() => moduleB.assertEngineeringExecutionControls(host, hostA.manifest.controls), /prior accepted controls/);
      const f = fixture(), planBefore = readFileSync(f.config.files.find(file => file.mount === engineeringPlanMount)!.path);
      assert.equal(moduleA.loadEngineeringPlan(f.config)!.digest, moduleB.loadEngineeringPlan(f.config)!.digest);
      const futurePrompt = prompts.mind + '\nInspect actual successor behavior before reporting this finite improvement.\n';
      writeFileSync(join(fullSource, 'deployment/prompts/mind.md'), futurePrompt);
      const future = freezeApplication(fullSource, host.artifactStore, { ...inputs, prompts: { ...prompts, mind: futurePrompt } });
      const nextAuthority = { generation: 'accepted-successor', epoch: 2, controlRevision: hostB.manifest.controls };
      const policyFields = { ...f.policy, controlRevision: nextAuthority.controlRevision }, policy = { ...policyFields, policyDigest: admissionPolicyIdentity(policyFields) };
      const request = { ...f.request, candidate: future, policyDigest: policy.policyDigest,
        proposal: { ...f.request.proposal, authority: nextAuthority, candidate: future.manifest } };
      const run = store.get<Run>('runs', request.proposal.runId)!; store.put('runs', run.value.id, { ...run.value, authority: nextAuthority }, run.revision);
      const originalAllocation = store.get('allocations', run.value.id)!.value; let commands = 0, models = 0;
      const response = await moduleB.runEngineeringReview(f.config, host, request, policy, hostB.manifest.id, { ...f.options, request,
        environment: moduleB.nodeEngineeringReviewEnvironment(), assertAuthority(value) { assert.deepEqual(value, nextAuthority); },
        runCommand: async command => { commands++; assert.equal(command.applicationRoot, join(host.artifactStore, hostB.manifest.id, 'payload')); return passed; },
        performRequest: async payload => { models++; const packet = JSON.parse(JSON.parse(payload).messages[1].content);
          assert.equal(packet.changes.length, 1); assert.equal(packet.changes[0].before, prompts.mind); assert.equal(packet.changes[0].after, futurePrompt);
          return { status: 200, body: JSON.stringify({ model: model.id, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ requestId: request.requestId,
            candidateId: future.manifest.id, policyDigest: policy.policyDigest, verdict: 'pass', reason: 'The exact later prompt preserves accepted controls and requires actual successor evidence.', findings: [] }) } }],
            usage: { prompt_tokens: 1000, completion_tokens: 100 } }) };
        } });
      assert.equal(commands, 1); assert.equal(models, 1); assert.equal(response.result.receipt.evidence[0]!.verdict, 'pass');
      assert.deepEqual(readFileSync(f.config.files.find(file => file.mount === engineeringPlanMount)!.path), planBefore, 'Accepted source succession never rewrites or self-hashes the sealed plan');
      assert.deepEqual((store.get('allocations', run.value.id)!.value as { envelope: unknown }).envelope, (originalAllocation as { envelope: unknown }).envelope);
      const summary = response.artifacts.find(blob => blob.sha256 === response.result.receipt.evidence[0]!.artifact.sha256)!;
      assert.deepEqual(JSON.parse(Buffer.from(summary.base64, 'base64').toString('utf8')).execution, { candidateId: hostB.manifest.id, controls: hostB.manifest.controls, source: hostB.manifest.source });
      writeFileSync(join(fullSource, 'deployment/prompts/mind.md'), prompts.mind);
      const codePath = 'packages/initiative/goals/index.ts', codeBefore = readFileSync(join(fullSource, codePath), 'utf8'), codeAfter = codeBefore + '\n// Finite accepted-control source review fixture.\n';
      writeFileSync(join(fullSource, codePath), codeAfter);
      const futureCode = freezeApplication(fullSource, host.artifactStore, { ...inputs, prompts }), g = fixture();
      assert.ok(hostB.files.length > 1500, 'Regression uses the actual complete repository inventory');
      const codeRequest = { ...g.request, candidate: futureCode, policyDigest: policy.policyDigest,
        proposal: { ...g.request.proposal, authority: nextAuthority, candidate: futureCode.manifest } };
      const codeRun = store.get<Run>('runs', codeRequest.proposal.runId)!;
      store.put('runs', codeRun.value.id, { ...codeRun.value, authority: nextAuthority }, codeRun.revision); let codeModels = 0;
      const codeResult = await moduleB.runEngineeringReview(f.config, host, codeRequest, policy, hostB.manifest.id, { ...g.options, request: codeRequest,
        environment: moduleB.nodeEngineeringReviewEnvironment(), assertAuthority(value) { assert.deepEqual(value, nextAuthority); }, runCommand: async () => passed,
        performRequest: async payload => { codeModels++; const packet = JSON.parse(JSON.parse(payload).messages[1].content);
          assert.equal(packet.changes.length, 1); assert.equal(packet.changes[0].path, codePath);
          assert.equal(packet.changes[0].before, codeBefore); assert.equal(packet.changes[0].after, codeAfter);
          assert.equal(packet.inputChanges.length, 1); assert.equal(packet.inputChanges[0].field, 'controls');
          assert.match(packet.inputChanges[0].path, /^\/controls\/files\/\d+\/sha256$/);
          assert.equal(packet.inputChanges[0].before, hashBytes(codeBefore)); assert.equal(packet.inputChanges[0].after, hashBytes(codeAfter));
          assert.ok(Buffer.byteLength(canonicalJson({ changes: packet.changes, inputChanges: packet.inputChanges })) < createEngineeringPlan(model).maxDiffBytes);
          return { status: 200, body: JSON.stringify({ model: model.id, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ requestId: codeRequest.requestId,
            candidateId: futureCode.manifest.id, policyDigest: policy.policyDigest, verdict: 'pass', reason: 'The one exact code change and its control hash are independently inspectable within the bound.', findings: [] }) } }],
            usage: { prompt_tokens: 1000, completion_tokens: 100 } }) };
        } });
      assert.equal(codeModels, 1); assert.equal(codeResult.result.receipt.evidence[0]!.verdict, 'pass');
      writeFileSync(join(fullSource, codePath), codeBefore);
      const addedPath = 'deployment/new-source-component.ts', addedCode = 'export const finiteSourceAddition = true;\n';
      writeFileSync(join(fullSource, addedPath), addedCode);
      const futureAddition = freezeApplication(fullSource, host.artifactStore, { ...inputs, prompts }), h = fixture();
      const additionRequest = { ...h.request, candidate: futureAddition, policyDigest: policy.policyDigest,
        proposal: { ...h.request.proposal, authority: nextAuthority, candidate: futureAddition.manifest } };
      const additionRun = store.get<Run>('runs', additionRequest.proposal.runId)!;
      store.put('runs', additionRun.value.id, { ...additionRun.value, authority: nextAuthority }, additionRun.revision); let additionModels = 0;
      const additionResult = await moduleB.runEngineeringReview(f.config, host, additionRequest, policy, hostB.manifest.id, { ...h.options, request: additionRequest,
        environment: moduleB.nodeEngineeringReviewEnvironment(), assertAuthority(value) { assert.deepEqual(value, nextAuthority); }, runCommand: async () => passed,
        performRequest: async payload => { additionModels++; const packet = JSON.parse(JSON.parse(payload).messages[1].content);
          assert.deepEqual(packet.changes, [{ path: addedPath, before: null, after: addedCode, beforeSha256: null, afterSha256: hashBytes(addedCode), beforeExecutable: null, afterExecutable: false }]);
          const controlsBefore = (hostB.inputs.controls as unknown as { files: unknown[] }).files;
          const controlsAfter = (futureAddition.inputs.controls as unknown as { files: Array<{ path: string; sha256: string }> }).files;
          const index = controlsAfter.findIndex(file => file.path === addedPath);
          assert.deepEqual(packet.inputChanges, [{ field: 'controls', path: '/controls/files', beforePresent: true, afterPresent: true,
            before: [], after: [{ path: addedPath, sha256: hashBytes(addedCode) }], arraySplice: { index, beforeLength: controlsBefore.length, afterLength: controlsAfter.length } }]);
          assert.ok(Buffer.byteLength(canonicalJson({ changes: packet.changes, inputChanges: packet.inputChanges })) < createEngineeringPlan(model).maxDiffBytes);
          return { status: 200, body: JSON.stringify({ model: model.id, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ requestId: additionRequest.requestId,
            candidateId: futureAddition.manifest.id, policyDigest: policy.policyDigest, verdict: 'pass', reason: 'The exact new source file and inserted control entry fit the inherited review bounds.', findings: [] }) } }],
            usage: { prompt_tokens: 1000, completion_tokens: 100 } }) };
        } });
      assert.equal(additionModels, 1); assert.equal(additionResult.result.receipt.evidence[0]!.verdict, 'pass');
      const changedSource = join(host.artifactStore, hostB.manifest.id, 'payload/packages/accepted-host-revision.ts');
      chmodSync(changedSource, 0o600);
      writeFileSync(changedSource, 'Unaccepted host mutation.\n');
      assert.throws(() => moduleB.assertEngineeringExecutionControls(host, hostB.manifest.controls), /payload changed/);
    });
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
