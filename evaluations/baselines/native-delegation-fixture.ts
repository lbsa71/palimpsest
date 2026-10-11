/** Synthetic witness helpers. These interpret attribution, never opaque task contents. */
export function codexChildIndex(request: { input?: any[] }): number {
  return [0, 1].findIndex(index => request.input?.some(item => item.type === 'agent_message' && item.author === '/root' && item.recipient === `/root/native_child_${index}`));
}
export function codexObservedToolOutput(request: { input?: any[] }, index: number): boolean {
  return request.input?.some(item => {
    if (item.type !== 'custom_tool_call_output' || item.call_id !== `call_child_${index}` || !Array.isArray(item.output) || item.output.length !== 2) return false;
    const [envelope, observation] = item.output;
    if (envelope?.type !== 'input_text' || typeof envelope.text !== 'string' || !/^Script completed\nWall time [0-9]+(?:\.[0-9]+)? seconds\nOutput:\n$/.test(envelope.text)
      || observation?.type !== 'input_text' || typeof observation.text !== 'string') return false;
    try {
      const result = JSON.parse(observation.text);
      return result !== null && typeof result === 'object' && !Array.isArray(result)
        && Object.keys(result).every(key => ['chunk_id', 'wall_time_seconds', 'exit_code', 'original_token_count', 'output'].includes(key))
        && typeof result.chunk_id === 'string' && result.chunk_id.length > 0
        && Number.isFinite(result.wall_time_seconds) && result.wall_time_seconds >= 0
        && Number.isSafeInteger(result.original_token_count) && result.original_token_count >= 0
        && result.exit_code === 0 && result.output === `child-${index + 1}-observed\n`;
    } catch { return false; }
  }) ?? false;
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

/** Bind actual completed CLI task events to native request identities and parent Agent results. */
export function claudeTaskBindings(stdout: string, childIds: string[], parentRequest: { messages?: any[] }): boolean {
  const events = stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const starts = events.filter(event => event.type === 'system' && event.subtype === 'task_started' && event.task_type === 'local_agent' && event.subagent_type === 'general-purpose' && event.spawn_depth === 1 && event.is_backgrounded === false);
  if (childIds.length !== 2 || new Set(childIds).size !== 2 || starts.length !== 2) return false;
  const calls = new Set<string>();
  for (const [index, childId] of childIds.entries()) {
    const start = starts.find(event => event.task_id === childId);
    if (!start || !['tool_spawn_0', 'tool_spawn_1'].includes(start.tool_use_id) || calls.has(start.tool_use_id)) return false;
    calls.add(start.tool_use_id);
    const receipt = parentRequest.messages?.some(message => message.role === 'user' && Array.isArray(message.content) && message.content.some((part: any) => part.type === 'tool_result' && part.tool_use_id === start.tool_use_id && part.is_error !== true && Array.isArray(part.content)
      && part.content[0]?.type === 'text' && typeof part.content[0].text === 'string' && part.content[0].text.split('\n')[0] === `child-${index + 1}-observed`
      && part.content[0].text.split('\n').some((line: string) => line === `agentId: ${childId}` || line.startsWith(`agentId: ${childId} (`))));
    if (!receipt) return false;
  }
  return true;
}
