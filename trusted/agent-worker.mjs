import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

// The parent grants this bridge a read-only candidate tree and a private pipe.
// All responses remain untrusted and are validated by the receiving parent.
const { conversationRequest } = await import(pathToFileURL(process.argv[2]).href);
const send = line => process.stdout.write(JSON.stringify(line) + '\n');
const scopeFlag = process.argv.find(value => value.startsWith('--palimpsest-scope='));
const validScope = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
let scope = scopeFlag === undefined ? undefined : JSON.parse(scopeFlag.slice('--palimpsest-scope='.length));
if (scope !== undefined && !validScope(scope)) throw new Error('Invalid worker scope');
const emptyCheckpoint = conversationId => ({ sequence: 0, snapshot: { scope: conversationId }, policyVersion: 'initial' });
let checkpoint;
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  let input;
  try {
    if (Buffer.byteLength(line) > 262144) throw new Error('input too large');
    input = JSON.parse(line);
    let result;
    if (input.method === 'ping') result = { alive: true };
    else if (input.method === 'catchUp') {
      const next = input.payload;
      if (!validScope(next?.snapshot?.scope) || (scope !== undefined && next.snapshot.scope !== scope)) throw new Error('Checkpoint scope mismatch');
      if (!Number.isSafeInteger(next.sequence) || next.sequence < (checkpoint?.sequence ?? 0) || typeof next.policyVersion !== 'string' || !next.policyVersion) throw new Error('Invalid checkpoint');
      checkpoint = next; result = { sequence: checkpoint.sequence };
    }
    else if (input.method === 'request') {
      const { task, memories } = input.payload;
      if (!validScope(task?.conversationId) || (scope !== undefined && scope !== task.conversationId)
        || !Array.isArray(memories) || memories.some(memory => memory.scope !== task.conversationId)) throw new Error('Request scope mismatch');
      scope ??= task.conversationId;
      // A staged checkpoint is never implicitly handed to a different first task.
      if (checkpoint?.snapshot?.scope !== scope) checkpoint = undefined;
      const scoped = checkpoint ?? emptyCheckpoint(scope);
      result = await conversationRequest(task, memories, scoped);
    }
    else if (input.method === 'probe') {
      // Synthetic health never consumes live continuity context, never binds a
      // real scope, and its descriptor is evaluated locally rather than inferred.
      const task = input.payload?.task;
      if (task?.id !== 'health' || task.conversationId !== 'health') throw new Error('Invalid health probe');
      result = await conversationRequest(task, [], emptyCheckpoint('health'));
    }
    else throw new Error('unknown method');
    send({ id: input.id, result });
  } catch { send({ id: input?.id, error: 'worker_request_failed' }); }
}
