/** Synthetic witness helpers. These interpret attribution, never opaque task contents. */
export function codexChildIndex(request: { input?: any[] }): number {
  return [0, 1].findIndex(index => request.input?.some(item => item.type === 'agent_message' && item.author === '/root' && item.recipient === `/root/native_child_${index}`));
}
export function codexObservedToolOutput(request: { input?: any[] }, index: number): boolean {
  return request.input?.some(item => item.type === 'custom_tool_call_output' && item.call_id === `call_child_${index}` && JSON.stringify(item.output).includes(`child-${index + 1}-observed`)) ?? false;
}
/** Bind only the exact acquired directed text final envelope to the public emitted final. */
export function codexParentReceipt(request: { input?: any[] }, index: number): boolean {
  const expected = `Message Type: FINAL_ANSWER\nTask name: /root\nSender: /root/native_child_${index}\nPayload:\nchild-${index + 1}-observed`;
  return request.input?.some(item => item.type === 'agent_message' && item.author === `/root/native_child_${index}` && item.recipient === '/root' && Array.isArray(item.content)
    && item.content.length === 1 && item.content[0].type === 'input_text' && item.content[0].text === expected) ?? false;
}
/** Child classification uses a native HTTP identity distinct from the parent. */
export function claudeChildIdentity(headers: Record<string, unknown>, parentHeaders: Record<string, unknown>): string | undefined {
  const child = headers['x-claude-code-agent-id'];
  if (typeof child !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(child) || child === parentHeaders['x-claude-code-agent-id']) return undefined;
  const session = parentHeaders['x-claude-code-session-id'];
  if (typeof session !== 'string' || headers['x-claude-code-session-id'] !== session) return undefined;
  const parent = headers['x-claude-code-parent-agent-id'];
  if (parent !== undefined && parent !== parentHeaders['x-claude-code-agent-id'] && parent !== session) return undefined;
  return child;
}
/** Only a successful result for an emitted Agent call can convey a public child final. */
export function claudeParentReceipts(request: { messages?: any[] }): string[] {
  const emitted = new Set<string>(), finals = new Map<string, string>();
  for (const message of request.messages ?? []) if (message.role === 'assistant' && Array.isArray(message.content)) for (const part of message.content) {
    if (part.type === 'tool_use' && part.name === 'Agent' && ['tool_spawn_0', 'tool_spawn_1'].includes(part.id)) emitted.add(part.id);
  }
  for (const message of request.messages ?? []) if (message.role === 'user' && Array.isArray(message.content)) {
    for (const part of message.content) if (part.type === 'tool_result' && emitted.has(part.tool_use_id) && part.is_error !== true && Array.isArray(part.content)) {
      const first = part.content[0];
      if (first?.type === 'text' && typeof first.text === 'string') {
        const line = first.text.split('\n')[0];
        if (['child-1-observed', 'child-2-observed'].includes(line)) {
          if (finals.has(part.tool_use_id)) return [];
          finals.set(part.tool_use_id, line);
        }
      }
    }
  }
  return [...finals.values()];
}
