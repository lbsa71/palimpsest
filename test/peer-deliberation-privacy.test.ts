import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalServer } from '../src/communications.ts';

test('peer submit including duplicate, status and cancellation never expose private checkpoint fields', async () => {
  const task = { id: 'task', source: 'peer', conversationId: 'peer:ordinary', input: 'Hello', state: 'succeeded', output: 'Public speech', error: null,
    checkpoint: { decisionText: 'PRIVATE_COGNITION', sourceContext: 'PRIVATE_SOURCE' }, selfModificationStatus: 'PRIVATE_HOST_DETAIL', createdAt: 'now', updatedAt: 'now' };
  const token = 'operator-credential-long'; const peerToken = 'peer-credential-long';
  const server = await createLocalServer({ submit: async () => task, status: () => task, cancel: () => task, events: () => [] }, { token, peerToken });
  try {
    const headers = { authorization: `Bearer ${peerToken}`, 'content-type': 'application/json' };
    for (const path of ['/peer/messages', '/peer/messages', '/peer/tasks/task', '/peer/tasks/task/cancel']) {
      const submit = path === '/peer/messages'; const response = await fetch(server.url + path, { headers, method: submit || path.endsWith('/cancel') ? 'POST' : 'GET',
        ...(submit ? { body: JSON.stringify({ id: 'event', conversationId: 'ordinary', text: 'Hello' }) } : {}) });
      assert.equal(response.status, submit ? 202 : 200); const body = await response.json() as Record<string, unknown>;
      assert.equal(body.output, 'Public speech'); assert.equal(body.checkpoint, undefined); assert.equal(body.selfModificationStatus, undefined);
      assert.ok(!JSON.stringify(body).includes('PRIVATE_'));
    }
    const operator = await fetch(server.url + '/tasks/task', { headers: { authorization: `Bearer ${token}` } });
    assert.match(await operator.text(), /PRIVATE_COGNITION/, 'Explicit operator diagnostics remain available');
  } finally { await server.close(); }
});
