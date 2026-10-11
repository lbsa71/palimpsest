// Entirely within the sibling candidate namespace; this key has no admission authority.
import { readFileSync } from 'node:fs';
const inputs = JSON.parse(readFileSync('/work/inputs.json', 'utf8'));
const clone = structuredClone, from = Buffer.from.bind(Buffer), stringify = JSON.stringify.bind(JSON);
// Keep a lexical copy before candidate module initialization can rewrite visible inputs.
const { reviewOfflinePacket } = await import('/app/evaluations/offline-review/review-core.ts');
const results = [];
for (const input of inputs) {
  try {
    const response = reviewOfflinePacket(clone(input.packet), clone(input.plan), from(input.keyHex, 'hex'));
    results.push({ kind: 'result', response });
  } catch (error) { results.push({ kind: error?.code === 'OFFLINE_REVIEW_REFUSED' ? 'refused' : 'error' }); }
}
process.stdout.write(stringify(results));
