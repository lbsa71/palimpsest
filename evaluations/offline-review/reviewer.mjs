// Prior-policy sealed reviewer. It never imports or executes candidate modules.
import { readFileSync } from 'node:fs';
import { reviewOfflinePacket } from './review-core.ts';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const packet = JSON.parse(input), plan = JSON.parse(readFileSync('/reviewer/offline-plan.json', 'utf8'));
process.stdout.write(JSON.stringify(reviewOfflinePacket(packet, plan, readFileSync('/reviewer-key'))));
