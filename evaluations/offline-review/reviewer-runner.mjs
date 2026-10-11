// Entirely within the sibling candidate namespace; this key has no admission authority.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// A different entrypoint requires its own case; this first case cannot qualify wrapper edits.
const adapter = createHash('sha256').update(readFileSync('/work/reviewer.mjs')).digest('hex');
if (adapter !== readFileSync('/work/adapter.sha256', 'utf8')) throw Error('Candidate reviewer adapter differs from prior-bound entrypoint');
const inputs = JSON.parse(readFileSync('/work/inputs.json', 'utf8'));
const clone = structuredClone, from = Buffer.from.bind(Buffer), stringify = JSON.stringify.bind(JSON);
// Keep a lexical copy before candidate module initialization can rewrite visible inputs.
const { reviewOfflinePacket } = await import('/work/review-core.ts');
const results = [];
for (const input of inputs) {
  try {
    const response = reviewOfflinePacket(clone(input.packet), clone(input.plan), from(input.keyHex, 'hex'));
    results.push({ kind: 'result', response });
  } catch (error) { results.push({ kind: error?.code === 'OFFLINE_REVIEW_REFUSED' ? 'refused' : 'error' }); }
}
process.stdout.write(stringify(results));
