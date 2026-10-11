import { createHash } from 'node:crypto';

/** Synthetic witness helpers. These interpret attribution, never opaque task contents. */
export function codexChildIndex(request: { input?: any[] }): number {
  return [0, 1].findIndex(index => request.input?.some(item => item.type === 'agent_message' && item.author === '/root' && item.recipient === `/root/native_child_${index}`));
}
export function codexObservedToolOutput(request: { input?: any[] }, index: number): boolean {
  return request.input?.some(item => item.type === 'custom_tool_call_output' && item.call_id === `call_child_${index}` && JSON.stringify(item.output).includes(`child-${index + 1}-observed`)) ?? false;
}
/** Compare opaque native bytes against the emitted public synthetic final; do not decode them. */
export function codexParentReceipt(request: { input?: any[] }, index: number): boolean {
  const expected = createHash('sha256').update(`child-${index + 1}-observed`).digest('hex');
  return request.input?.some(item => item.type === 'agent_message' && item.author === `/root/native_child_${index}` && item.recipient === '/root' && Array.isArray(item.content)
    && item.content.some((part: any) => part.type === 'input_text' && typeof part.text === 'string' && part.text.startsWith('Message Type: FINAL_ANSWER\n'))
    && item.content.some((part: any) => part.type === 'encrypted_content' && typeof part.encrypted_content === 'string' && createHash('sha256').update(part.encrypted_content).digest('hex') === expected)) ?? false;
}
