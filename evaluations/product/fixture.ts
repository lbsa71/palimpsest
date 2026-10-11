import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApplicationConfig } from '../../deployment/config.ts';

export function fixtureConfiguration(root: string, applicationRoot: string): ApplicationConfig {
  const stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'workspaces');
  mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind.txt'), compactionPromptFile = join(root, 'compact.txt');
  writeFileSync(promptFile, 'Inspect observations, repair mistakes, verify artifacts, and communicate explicit outcomes.');
  writeFileSync(compactionPromptFile, 'Preserve task constraints, evidence, uncertainties and provenance.');
  const resources = { maxRequests: 64, maxTokens: 30000, maxCostUsd: 0, maxElapsedMs: 60000, maxConcurrency: 2 };
  return { stateDirectory, workspaceDirectory, applicationRoot, nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'evaluation-integration-fixture', controlRevision: 'evaluation-v2-fixture', promptFile, compactionPromptFile,
    model: { id: 'mistral-fixture-v2', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 1024, maxRequestsPerSlice: 12, timeoutMs: 10000, pricesPerMillion: { input: 0, output: 0 } }, resources, conversationResources: resources,
    scheduler: { windowMs: 60000, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: 60000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 1, pollMs: 100, commands: ['/runtime/node'], researchHosts: [],
    direct: { host: '127.0.0.1', port: 0, actorId: 'evaluator', scope: { kind: 'restricted', principals: ['evaluator'] }, modificationEligible: false } };
}
const answer = (message: unknown, finish_reason: string) => ({ status: 200, body: JSON.stringify({ model: 'mistral-fixture-v2', choices: [{ finish_reason, message }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) });
export function boundedCodingFixture() {
  let count = 0;
  return async (payload: string) => {
    if (++count > 12) throw new Error('Fixture response ceiling exceeded');
    const request = JSON.parse(payload) as { messages: { role: string; content: string }[] };
    const tool = (name: string, args: unknown) => answer({ role: 'assistant', content: null, tool_calls: [{ id: `eval${String(count).padStart(5, '0')}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
    const messages = JSON.stringify(request.messages.filter(message => message.role === 'tool'));
    if (count === 1) return tool('workspace_write', { path: 'sum.mjs', content: 'console.log(Number(process.argv[2]) - Number(process.argv[3]));\n', expectedSha256: null });
    if (count === 2) return tool('command_run', { executable: '/runtime/node', args: ['--input-type=module', '-e', "import {execFileSync} from 'node:child_process';const result=execFileSync('/runtime/node',['sum.mjs','2','3'],{encoding:'utf8'}).trim();if(result!=='5')throw Error('Observed seeded defect: '+result);"] });
    if (count === 3) {
      if (!messages.includes('Observed seeded defect')) throw new Error('Fixture did not observe real failing command');
      return tool('workspace_read', { path: 'sum.mjs' });
    }
    if (count === 4) {
      // Use the actual workspace read digest for the compare-and-swap edit.
      const contents = request.messages.filter(message => message.role === 'tool').map(message => { try { return JSON.parse(message.content); } catch { return null; } });
      const findDigest = (value: unknown): string | undefined => {
        if (!value || typeof value !== 'object') return undefined;
        for (const [key, child] of Object.entries(value)) { if (key === 'sha256' && typeof child === 'string') return child; const found = findDigest(child); if (found) return found; }
      };
      const sha = contents.map(findDigest).findLast(Boolean);
      if (!sha) throw new Error('Fixture did not receive actual file digest');
      return tool('workspace_write', { path: 'sum.mjs', content: 'console.log(Number(process.argv[2]) + Number(process.argv[3]));\n', expectedSha256: sha });
    }
    if (count === 5) return tool('command_run', { executable: '/runtime/node', args: ['sum.mjs', '2', '3'] });
    if (count === 6) {
      const frame = request.messages.filter(message => message.role === 'user').map(message => { try { return JSON.parse(message.content); } catch { return {}; } }).findLast(message => message.hostContext)?.hostContext;
      return tool('speech_send', { channel: frame.target.channel, text: 'Created sum.mjs, observed and repaired a failing check, and verified 2 + 3 = 5.', kind: 'message' });
    }
    return answer({ role: 'assistant', content: 'Private final text must not be emitted as speech.' }, 'stop');
  };
}
