import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { OperationalStore } from '../../packages/storage/index.ts';
import { initializeResourceDelegation, type ResourceLimits } from '../../packages/supervisor/resource-limits.ts';
import { runClaudeBaseline, type ClaudeBaselineRun } from './run-claude.ts';

const binarySha256 = '24972e3bc859fab2b46ed4c1e51f7d6130f06d3bd550811a114640de3370d0de';
const markers = ['native-pids-refused', 'native-storage-refused', 'native-inodes-refused', 'native-network-refused', 'native-claude-kernel-proof'];
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
function messagesSSE(model: string, block: Record<string, unknown>, tool: boolean): string {
  const events = [
    { type: 'message_start', message: { id: 'msg_kernel_fixture', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: tool ? { ...block, input: {} } : { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ];
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}
interface ProcessObservation { pid: number; name: string; command: string[]; membership: string }
interface GroupObservation {
  phase: string; group: string; memoryPeakBytes: number; pids: string; cpu: string; processes: ProcessObservation[];
}

test('actual kernel-bounded native Claude CLI, observer and Bash enforce ceilings and clean up', {
  skip: !process.env.AEON_CLAUDE_KERNEL_WORKSPACE, timeout: 45_000,
}, async context => {
  assert.ok(process.env.AEON_CLAUDE_KERNEL_EVIDENCE, 'Persistent external evidence directory required');
  assert.ok(process.env.AEON_CLAUDE_FIXTURE_BINARY, 'Explicit pinned native CLI required');
  const root = mkdtempSync(join(process.env.AEON_CLAUDE_KERNEL_EVIDENCE, 'aeon-claude-kernel-'));
  const checkoutRoot = join(root, 'checkout'), privateRoot = join(root, 'private'), privateStateRoot = join(root, 'state');
  for (const path of [checkoutRoot, privateRoot]) mkdirSync(path, { mode: 0o700 });
  const workspace = realpathSync(process.env.AEON_CLAUDE_KERNEL_WORKSPACE!);
  const cgroupRoot = '/sys/fs/cgroup' + readFileSync('/proc/self/cgroup', 'utf8').trim().slice(3);
  const limits: ResourceLimits = { cgroupRoot, memoryBytes: 768 * 1024 * 1024, pids: 96, cpuQuotaMicros: 50_000, cpuPeriodMicros: 100_000,
    maxFileBytes: 2 * 1024 * 1024, maxOpenFiles: 256, workspaceBytes: 16 * 1024 * 1024, workspaceInodes: 128 };
  const binary = realpathSync(process.env.AEON_CLAUDE_FIXTURE_BINARY);
  assert.equal(createHash('sha256').update(readFileSync(binary)).digest('hex'), binarySha256);
  const observations: GroupObservation[] = [];
  let calls = 0, refusal: unknown, samplingError: unknown, sampler: ReturnType<typeof setInterval> | undefined;
  let group: string | undefined;
  const readGroup = (name: string) => readFileSync(join(group!, name), 'utf8').trim();
  const observe = (phase: string): GroupObservation => {
    assert.ok(group);
    const processes = readGroup('cgroup.procs').split('\n').filter(Boolean).flatMap(pid => {
      try {
        return [{ pid: Number(pid), name: readFileSync(`/proc/${pid}/comm`, 'utf8').trim(),
          command: readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').slice(0, 2),
          membership: readFileSync(`/proc/${pid}/cgroup`, 'utf8').trim() }];
      } catch (error) {
        if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return [];
        throw error;
      }
    });
    return { phase, group, memoryPeakBytes: Number(readGroup('memory.peak')), pids: readGroup('pids.events'), cpu: readGroup('cpu.stat'), processes };
  };
  const input: ClaudeBaselineRun = { checkoutRoot, workspace, privateStateRoot, protectedPaths: [privateRoot],
    native: { claude: binary, version: '2.1.296 (Claude Code)', claudeSha256: binarySha256 },
    prompt: 'Use Bash to verify the confined kernel fixture and write proof.txt, then reply claude-kernel-complete.', maxCliOutputBytes: 1_000_000,
    grant: { id: 'claude-synthetic-original-grant', resources: { maxRequests: 2, maxTokens: 400_040, maxCostUsd: 1, maxElapsedMs: 30_000, maxConcurrency: 1 },
      profile: { provider: 'anthropic-fixture', model: 'claude-haiku-4-5-20251001', effort: 'low', contextContract: 'Synthetic fixture 200000 input-token cap; no live Anthropic contract', contextWindowTokens: 200_000, maxOutputTokens: 20,
        prices: { source: 'explicit synthetic zero prices; no paid entitlement or live pricing', inputUsdPerMillion: 0, cachedInputUsdPerMillion: 0, outputUsdPerMillion: 0 } },
      requestTimeoutMs: 10_000, maxRequestBytes: 1_000_000, maxResponseBytes: 1_000_000 },
    provider: { kind: 'fixture', resourceLimits: limits, transport: async (payload, signal) => {
      try {
        signal.throwIfAborted(); calls++; assert.ok(calls <= 2);
        const groups = readdirSync(cgroupRoot).filter(name => name.startsWith('command-')); assert.equal(groups.length, 1);
        const current = join(cgroupRoot, groups[0]!); assert.ok(!group || group === current); group = current;
        assert.equal(readGroup('memory.max'), String(limits.memoryBytes)); assert.equal(readGroup('memory.swap.max'), '0');
        assert.equal(readGroup('memory.oom.group'), '1'); assert.equal(readGroup('pids.max'), String(limits.pids));
        assert.equal(readGroup('cpu.max'), `${limits.cpuQuotaMicros} ${limits.cpuPeriodMicros}`);
        const observation = observe(`request-${calls}`); observations.push(observation);
        assert.ok(observation.processes.some(value => value.command[0] === '/app/claude'));
        assert.ok(observation.processes.some(value => value.command[0] === '/runtime/node' && value.command[1] === '/app/claude-worker.mjs'));
        const body = JSON.parse(payload);
        assert.equal(body.model, input.grant.profile.model); assert.equal(body.stream, true); assert.equal(body.max_tokens, 20);
        assert.equal(payload.includes('PRIVATE_CLAUDE_KERNEL_EVALUATOR_SENTINEL'), false);
        let block: Record<string, unknown>;
        if (calls === 1) {
          assert.ok(body.tools.some((tool: { name: string }) => tool.name === 'Bash'));
          const probe = `import os, subprocess, time, errno, socket, resource
assert not os.path.exists('/sys/fs/cgroup')
for path in ${JSON.stringify([join(privateRoot, 'answer'), privateStateRoot, join(dirname(workspace), 'workspace.ext4')])}: assert not os.path.exists(path), path
assert not os.environ.get('OPENAI_API_KEY') and not os.environ.get('MISTRAL_API_KEY')
assert os.environ.get('ANTHROPIC_API_KEY') in [None, 'no-provider-authority']
assert resource.getrlimit(resource.RLIMIT_FSIZE) == (2097152,2097152)
assert resource.getrlimit(resource.RLIMIT_NOFILE) == (256,256)
time.sleep(0.2)
children=[]
try:
 for i in range(128): children.append(subprocess.Popen(['/bin/sleep','10'], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
except OSError as e:
 assert e.errno == errno.EAGAIN
 print('native-pids-refused', e.errno)
else: raise AssertionError('No process refusal')
finally:
 for child in children: child.kill()
 for child in children: child.wait()
allocation=bytearray(16*1024*1024)
deadline=time.process_time()+0.3
while time.process_time()<deadline: pass
for kind,count,content in [('storage',24,b'x'*(1024*1024)),('inodes',256,b'')]:
 files=[]
 try:
  for i in range(count):
   name='/work/native-'+kind+'-'+str(i); files.append(name)
   with open(name,'wb') as output: output.write(content)
 except OSError as e:
  assert e.errno == errno.ENOSPC
  print('native-'+kind+'-refused',e.errno)
 else: raise AssertionError('No '+kind+' refusal')
 finally:
  for name in files:
   if os.path.exists(name): os.unlink(name)
s=socket.socket(); s.settimeout(1)
try: s.connect(('1.1.1.1',443))
except OSError as e:
 assert e.errno in [errno.ENETUNREACH,errno.EHOSTUNREACH,errno.EACCES,errno.EPERM]
 print('native-network-refused',e.errno)
else: raise AssertionError('External network accessible')
finally: s.close()
with open('/work/proof.txt','w') as output: output.write('native-claude-kernel-proof')
print('native-claude-kernel-proof')`;
          // Host observation, independent of the tool's own output, binds its actual
          // running Python process and native CLI to the same command cgroup.
          sampler = setInterval(() => {
            try {
              const sample = observe('tool-running');
              if (sample.processes.some(value => value.command[0] === '/usr/bin/python3')) {
                observations.push(sample); clearInterval(sampler); sampler = undefined;
              }
            } catch (error) { samplingError = error; clearInterval(sampler); sampler = undefined; }
          }, 25);
          block = { type: 'tool_use', id: 'tool_kernel_fixture', name: 'Bash', input: {
            command: `/usr/bin/python3 -c ${shellQuote(probe)}`, description: 'Exercise confined kernel ceilings', timeout: 10_000 } };
        } else {
          if (sampler) { clearInterval(sampler); sampler = undefined; }
          assert.equal(samplingError, undefined);
          const toolSample = observations.find(value => value.phase === 'tool-running'); assert.ok(toolSample, 'Actual running tool must be observed by host');
          for (const executable of ['/app/claude', '/usr/bin/python3']) {
            const actual = toolSample.processes.find(value => value.command[0] === executable); assert.ok(actual, executable);
            assert.equal(actual.membership, '0::' + group.slice('/sys/fs/cgroup'.length));
          }
          assert.match(observation.pids, /max [1-9]\d*/); assert.match(observation.cpu, /throttled_usec [1-9]\d*/);
          assert.ok(observation.memoryPeakBytes > 16 * 1024 * 1024 && observation.memoryPeakBytes <= limits.memoryBytes);
          const outputs = body.messages.flatMap((message: { content: unknown }) => Array.isArray(message.content) ? message.content : [])
            .filter((part: { type: string; tool_use_id: string }) => part.type === 'tool_result' && part.tool_use_id === 'tool_kernel_fixture');
          assert.equal(outputs.length, 1); assert.ok(outputs[0].is_error !== true);
          for (const marker of markers) assert.ok(JSON.stringify(outputs[0].content).includes(marker), marker);
          block = { type: 'text', text: 'claude-kernel-complete' };
        }
        return new Response(messagesSSE(body.model, block, calls === 1), { headers: { 'content-type': 'text/event-stream' } });
      } catch (error) { refusal = error; throw error; }
    } } };
  const originalGrant = structuredClone(input.grant);
  try {
    await initializeResourceDelegation(cgroupRoot);
    assert.deepEqual(readdirSync(cgroupRoot).filter(name => name.startsWith('command-')), []);
    writeFileSync(join(privateRoot, 'answer'), 'PRIVATE_CLAUDE_KERNEL_EVALUATOR_SENTINEL');
    const result = await runClaudeBaseline(input);
    writeFileSync(join(root, 'outcome.json'), JSON.stringify({ result, calls, refusal: String(refusal) }, null, 2));
    const outcome = result.outcome as { code: number; stdout: string; stderr: string; exceeded: boolean; refusedRoutes: unknown[] };
    assert.equal(outcome.code, 0, `${outcome.stderr}\n${String(refusal)}\n${outcome.stdout}`); assert.equal(outcome.exceeded, false);
    assert.deepEqual(outcome.refusedRoutes, []); assert.match(outcome.stdout, /claude-kernel-complete/);
    assert.equal(result.qualification, 'kernel-profile'); assert.equal(result.physicalRequests, 2); assert.equal(calls, 2);
    assert.equal(readFileSync(join(workspace, 'proof.txt'), 'utf8'), 'native-claude-kernel-proof');
    assert.equal(readFileSync(join(privateRoot, 'answer'), 'utf8'), 'PRIVATE_CLAUDE_KERNEL_EVALUATOR_SENTINEL');
    const store = new OperationalStore({ filename: join(privateStateRoot, 'observer.sqlite') });
    try {
      const attempts = store.list<any>('baseline-attempts'); assert.equal(attempts.length, 2);
      const requests = store.list<any>('requests'); assert.equal(requests.length, 2);
      for (const attempt of attempts) {
        assert.equal(attempt.value.outcome, 'completed');
        assert.equal(attempt.value.usage.inputTokens, 100); assert.equal(attempt.value.usage.outputTokens, 10); assert.equal(attempt.value.usage.costUsd, 0);
        const before = JSON.parse(Buffer.from(store.readArtifact(attempt.value.before)).toString()), after = JSON.parse(Buffer.from(store.readArtifact(attempt.value.after)).toString());
        assert.deepEqual(before.system, after.system); assert.deepEqual(before.messages, after.messages); assert.deepEqual(before.tools, after.tools);
      }
      for (const request of requests) {
        assert.equal(request.value.request.status, 'succeeded'); assert.equal(request.value.charged.tokens, 110); assert.equal(request.value.charged.costUsd, 0);
      }
      assert.deepEqual(input.grant, originalGrant);
      assert.deepEqual(store.get('baseline-grants', input.grant.id)!.value, originalGrant);
      const allocation = store.get<any>('allocations', input.grant.id)!.value;
      assert.deepEqual(allocation.envelope, originalGrant.resources); assert.equal(allocation.cancelled, true);
      const run = store.get<any>('baseline-run', 'run')!.value; assert.equal(run.status, 'completed');
      assert.equal(run.specification.native.kind, 'claude'); assert.equal(run.specification.providerTransport, 'fixture');
      assert.deepEqual(run.specification.grant, originalGrant); assert.deepEqual(run.specification.kernelLimits, limits);
      assert.equal(run.specification.native.files[0].sha256, binarySha256);
      writeFileSync(join(root, 'durable-summary.json'), JSON.stringify({ manifest: result.manifest, result: result.result,
        grant: originalGrant, allocation, attempts, requests, specification: run.specification }, null, 2));
    } finally { store.close(); }
    await assert.rejects(runClaudeBaseline(input), /unavailable or stopped/); assert.equal(calls, 2, 'Grant replay must not dispatch');
    const fs = statfsSync(workspace, { bigint: true });
    assert.equal(fs.type, 0xef53n); assert.ok(fs.blocks * fs.bsize <= BigInt(limits.workspaceBytes)); assert.ok(fs.files <= BigInt(limits.workspaceInodes));
    context.diagnostic(JSON.stringify({ evidenceKind: 'synthetic-kernel-native-claude-composition', limits, observations, physicalRequests: calls, privateEvidence: root }));
  } catch (error) {
    writeFileSync(join(root, 'failure.json'), JSON.stringify({ calls, refusal: String(refusal), samplingError: String(samplingError), error: String(error) }, null, 2)); throw error;
  } finally {
    if (sampler) clearInterval(sampler);
    const remaining = readdirSync(cgroupRoot).filter(name => name.startsWith('command-'));
    writeFileSync(join(root, 'kernel-observations.json'), JSON.stringify({ limits, observations, remaining, calls, refusal: String(refusal), samplingError: String(samplingError) }, null, 2));
    assert.deepEqual(remaining, [], 'Every native descendant must drain and its group be removed');
  }
});
