import { canonicalJson } from '../packages/contracts/index.ts';
import { digest } from '../packages/agent-shell/mistral.ts';
import type { ToolResultMessage } from '../packages/agent-shell/vendor/pi/ai/types.ts';

/** Model context only: the full successful command receipt remains durable. */
export function projectSourceObservation(message: ToolResultMessage): ToolResultMessage {
  if (message.toolName !== 'source_checkout' || message.isError || message.content.length !== 1 || message.content[0]?.type !== 'text') return message;
  try {
    const receipt = JSON.parse(message.content[0].text);
    if (!receipt || receipt.exitCode !== 0 || receipt.signal || receipt.stoppedFor || typeof receipt.stdout !== 'string') return message;
    const inventory = JSON.parse(receipt.stdout);
    if (!inventory || inventory.source !== 'accepted application snapshot' || typeof inventory.copiedAt !== 'string' || !Number.isSafeInteger(inventory.bytes) || inventory.bytes < 0 || !Array.isArray(inventory.files)) return message;
    let bytes = 0;
    for (const file of inventory.files) {
      if (!file || typeof file.path !== 'string' || !file.path || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) return message;
      bytes += file.bytes;
    }
    if (bytes !== inventory.bytes) return message;
    const summary = { projection: 'source_checkout_inventory', toolCallId: message.toolCallId, source: inventory.source, copiedAt: inventory.copiedAt,
      fileCount: inventory.files.length, bytes: inventory.bytes, originalStdoutSha256: digest(receipt.stdout), inventoryOmitted: true };
    return { ...message, content: [{ type: 'text', text: canonicalJson({ ...receipt, stdout: canonicalJson(summary) }) }] };
  } catch { return message; }
}
