import { canonicalJson } from '../packages/contracts/index.ts';
import { digest } from '../packages/agent-shell/mistral.ts';
import type { ToolResultMessage } from '../packages/agent-shell/vendor/pi/ai/types.ts';

function projectWorkspaceInventory(message: ToolResultMessage): ToolResultMessage {
  if (message.isError || message.content.length !== 1 || message.content[0]?.type !== 'text') return message;
  try {
    const text = message.content[0].text, receipt = JSON.parse(text);
    if (!receipt || Object.keys(receipt).length !== 1 || !Array.isArray(receipt.files) || !receipt.files.every((path: unknown) => typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('\\') && path.split('/').every(part => part && part !== '..' && part !== '.'))) return message;
    const files = [...receipt.files as string[]].sort(), counts = new Map<string, number>(), rootFiles: string[] = [];
    for (const file of files) { const slash = file.indexOf('/'); if (slash < 0) rootFiles.push(file); else { const directory = file.slice(0, slash); counts.set(directory, (counts.get(directory) ?? 0) + 1); } }
    const directories = [...counts].map(([directory, fileCount]) => ({ directory, fileCount }));
    const summary = { projection: 'workspace_discover_inventory', toolCallId: message.toolCallId, fileCount: files.length, originalResultSha256: digest(text), inventoryOmitted: true,
      directoryCount: directories.length, rootFileCount: rootFiles.length, directories: directories.slice(0, 16), rootFiles: rootFiles.slice(0, 16), preview: files.slice(0, 8),
      guidance: 'Use workspace_search with path/text and workspace_read for targeted files.' };
    let rendered = canonicalJson(summary);
    while (Buffer.byteLength(rendered) > 8192 && (summary.preview.length || summary.rootFiles.length || summary.directories.length)) {
      if (summary.preview.length) summary.preview.pop(); else if (summary.rootFiles.length) summary.rootFiles.pop(); else summary.directories.pop();
      rendered = canonicalJson(summary);
    }
    return Buffer.byteLength(rendered) <= 8192 ? { ...message, content: [{ type: 'text', text: rendered }] } : message;
  } catch { return message; }
}

/** Model context only: the full successful command receipt remains durable. */
export function projectSourceObservation(message: ToolResultMessage): ToolResultMessage {
  if (message.toolName === 'workspace_discover') return projectWorkspaceInventory(message);
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
