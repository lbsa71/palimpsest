import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { OperationalStore } from '../../packages/storage/index.ts';
import { runClaudeBaseline } from './run-claude.ts';
import type { ClaudeBaselineRun } from './run-claude.ts';

function messagesSSE(model: string, block: Record<string, unknown>, tool = false): string {
  const events = [
    { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: tool ? { ...block, input: {} } : { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ];
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}
function fixture() {
  const evidence = process.env.AEON_CLAUDE_FIXTURE_EVIDENCE;
  const root = mkdtempSync(join(evidence ?? tmpdir(), 'aeon-claude-fixture-'));
  const checkoutRoot = join(root, 'checkout'), workspace = join(root, 'work'), privateRoot = join(root, 'private'), privateStateRoot = join(root, 'state');
  for (const path of [checkoutRoot, workspace, privateRoot]) mkdirSync(path, { mode: 0o700 });
  const input: ClaudeBaselineRun = { checkoutRoot, workspace, privateStateRoot, protectedPaths: [privateRoot],
    native: { claude: '/usr/bin/true', version: 'synthetic-unlaunched', claudeSha256: '0'.repeat(64) },
    prompt: 'Use Bash to verify the fixture and write proof.txt, then reply claude-fixture-complete.', maxCliOutputBytes: 1_000_000,
    grant: { id: 'claude-synthetic-original-grant', resources: { maxRequests: 2, maxTokens: 400_040, maxCostUsd: 1, maxElapsedMs: 30_000, maxConcurrency: 1 },
      profile: { provider: 'anthropic-fixture', model: 'claude-haiku-4-5-20251001', effort: 'low', contextContract: 'Synthetic fixture 200000 input-token cap; no live Anthropic contract', contextWindowTokens: 200_000, maxOutputTokens: 20,
        prices: { source: 'explicit synthetic zero prices; no paid entitlement or live pricing', inputUsdPerMillion: 0, cachedInputUsdPerMillion: 0, outputUsdPerMillion: 0 } },
      requestTimeoutMs: 10_000, maxRequestBytes: 1_000_000, maxResponseBytes: 1_000_000 },
    provider: { kind: 'fixture', transport: async () => { throw new Error('unlaunched validation only'); } } };
  return { root, input, privateRoot, dispose() { if (!evidence) rmSync(root, { recursive: true, force: true }); } };
}
test('Claude entry refuses live pricing, protocol mismatch and changed closure before launch', async () => {
  const f = fixture();
  try {
    const priced = structuredClone(f.input.grant); priced.profile.prices.inputUsdPerMillion = 1;
    await assert.rejects(runClaudeBaseline({ ...f.input, grant: priced }), /live accounting unavailable/);
    assert.equal(existsSync(f.input.privateStateRoot), false);
    await assert.rejects(runClaudeBaseline({ ...f.input, grant: { ...f.input.grant, profile: { ...f.input.grant.profile, provider: 'openai' } } }), /protocol\/profile/);
    await assert.rejects(runClaudeBaseline(f.input), /unavailable or stopped/);
    const store = new OperationalStore({ filename: join(f.input.privateStateRoot, 'observer.sqlite') });
    try { assert.equal(store.list('requests').length, 0); } finally { store.close(); }
  } finally { f.dispose(); }
});

test('actual Claude Code native Bash, synthetic Messages and original finite grant compose', {
  skip: process.env.AEON_CLAUDE_RUNNER_FIXTURE !== '1' || !process.env.AEON_CLAUDE_FIXTURE_BINARY, timeout: 45_000,
}, async context => {
  const f = fixture(); let calls = 0, refusal: unknown;
  try {
    f.input.native = { claude: process.env.AEON_CLAUDE_FIXTURE_BINARY!, version: '2.1.296 (Claude Code)',
      claudeSha256: '24972e3bc859fab2b46ed4c1e51f7d6130f06d3bd550811a114640de3370d0de' };
    writeFileSync(join(f.privateRoot, 'answer'), 'PRIVATE_CLAUDE_EVALUATOR_SENTINEL');
    f.input.provider = { kind: 'fixture', transport: async (payload, signal) => {
      try {
        signal.throwIfAborted(); calls++; assert.ok(calls <= 2); const body = JSON.parse(payload);
        assert.equal(body.model, f.input.grant.profile.model); assert.equal(body.stream, true); assert.equal(body.max_tokens, 20);
        assert.equal(payload.includes('PRIVATE_CLAUDE_EVALUATOR_SENTINEL'), false);
        let block: Record<string, unknown>;
        if (calls === 1) {
          assert.ok(body.tools.some((tool: { name: string }) => tool.name === 'Bash'));
          const program = `const fs=require('node:fs'),net=require('node:net');if(fs.existsSync(${JSON.stringify(join(f.privateRoot, 'answer'))})||process.env.OPENAI_API_KEY||process.env.MISTRAL_API_KEY||(process.env.ANTHROPIC_API_KEY&&process.env.ANTHROPIC_API_KEY!=='no-provider-authority'))process.exit(2);const s=net.connect({host:'1.1.1.1',port:443});s.setTimeout(1000);s.on('connect',()=>process.exit(3));s.on('timeout',()=>process.exit(4));s.on('error',()=>{fs.writeFileSync('proof.txt','native-claude-observed-command');console.log('native-claude-observed-command');});`;
          block = { type: 'tool_use', id: 'tool_fixture', name: 'Bash', input: { command: `/runtime/node -e '${program.replaceAll("'", "'\\''")}'`, description: 'Verify confined synthetic transport', timeout: 5000 } };
        } else {
          assert.ok(body.messages.some((message: any) => Array.isArray(message.content) && message.content.some((part: any) => part.type === 'tool_result' && part.tool_use_id === 'tool_fixture' && JSON.stringify(part.content).includes('native-claude-observed-command'))));
          block = { type: 'text', text: 'claude-fixture-complete' };
        }
        return new Response(messagesSSE(body.model, block, calls === 1), { headers: { 'content-type': 'text/event-stream' } });
      } catch (error) { refusal = error; throw error; }
    } };
    const result = await runClaudeBaseline(f.input);
    const outcome = result.outcome as { code: number; stdout: string; stderr: string; exceeded: boolean };
    writeFileSync(join(f.root, 'outcome.json'), JSON.stringify({ result, calls, refusal: String(refusal) }, null, 2));
    assert.equal(outcome.code, 0, `${outcome.stderr}\n${String(refusal)}\n${outcome.stdout}`); assert.equal(outcome.exceeded, false);
    assert.match(outcome.stdout, /claude-fixture-complete/); assert.equal(result.physicalRequests, 2); assert.equal(calls, 2);
    assert.equal(readFileSync(join(f.input.workspace, 'proof.txt'), 'utf8'), 'native-claude-observed-command');
    assert.equal(readFileSync(join(f.privateRoot, 'answer'), 'utf8'), 'PRIVATE_CLAUDE_EVALUATOR_SENTINEL');
    const store = new OperationalStore({ filename: join(f.input.privateStateRoot, 'observer.sqlite') });
    try {
      const attempts = store.list<any>('baseline-attempts'); assert.equal(attempts.length, 2);
      for (const attempt of attempts) {
        assert.equal(attempt.value.outcome, 'completed'); assert.equal(attempt.value.usage.inputTokens, 100); assert.equal(attempt.value.usage.outputTokens, 10); assert.equal(attempt.value.usage.costUsd, 0);
        const before = JSON.parse(Buffer.from(store.readArtifact(attempt.value.before)).toString()), after = JSON.parse(Buffer.from(store.readArtifact(attempt.value.after)).toString());
        assert.deepEqual(before.system, after.system); assert.deepEqual(before.messages, after.messages); assert.deepEqual(before.tools, after.tools);
      }
      assert.equal(store.get<any>('baseline-grants', f.input.grant.id)!.value.id, f.input.grant.id);
      const spec = store.get<any>('baseline-run', 'run')!.value.specification;
      assert.equal(spec.native.kind, 'claude'); assert.equal(spec.native.files[0].sha256, f.input.native.claudeSha256);
      assert.equal(spec.providerTransport, 'fixture'); assert.equal(spec.kernelLimits, null);
    } finally { store.close(); }
    await assert.rejects(runClaudeBaseline(f.input), /unavailable or stopped/); assert.equal(calls, 2);
    context.diagnostic(JSON.stringify({ evidence: f.root, physicalRequests: calls, binarySha256: createHash('sha256').update(readFileSync(f.input.native.claude)).digest('hex') }));
  } catch (error) {
    writeFileSync(join(f.root, 'failure.json'), JSON.stringify({ calls, refusal: String(refusal), error: String(error) }, null, 2)); throw error;
  } finally { f.dispose(); }
});
