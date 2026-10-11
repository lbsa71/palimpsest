export type ClaudeNativeOptions = { tools: string; modelRoles?: { haiku?: string; sonnet?: string; opus?: string; subagent?: string }; delegation?: 'isolated-native' }

/** Pure native invocation construction: fixture restrictions never spill into the real profile. */
export function claudeInvocation(start: { model: string; effort: string; profile?: string; claudeOptions?: ClaudeNativeOptions; nativeRecovery?: { mode: 'start' | 'resume'; sessionId: string } }, port: number) {
  const real = start.profile === 'anthropic';
  if (real && (!start.claudeOptions || typeof start.claudeOptions.tools !== 'string' || start.claudeOptions.tools.length === 0)) throw new Error('Explicit native Claude tools required');
  const delegation = start.claudeOptions?.delegation;
  if (start.claudeOptions && Object.keys(start.claudeOptions).some(key => !['tools', 'modelRoles', 'delegation'].includes(key))) throw new Error('Unknown native Claude options');
  if (delegation !== undefined && (delegation !== 'isolated-native' || !real)) throw new Error('Synthetic real-profile isolated native delegation required');
  if (delegation && (['haiku', 'sonnet', 'opus', 'subagent'] as const).some(role => start.claudeOptions?.modelRoles?.[role] !== start.model)) throw new Error('Explicit same-model native child roles required');
  const recovery = start.nativeRecovery;
  if (recovery && (Object.keys(recovery).some(key => !['mode', 'sessionId'].includes(key)) || !['start', 'resume'].includes(recovery.mode) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(recovery.sessionId))) throw new Error('Exact native recovery session required');
  const home = recovery ? '/work/.aeon-native-state/claude/home' : '/tmp/aeon-baseline-home';
  const args = ['--print', delegation ? '--safe-mode' : '--bare', '--setting-sources', '', '--settings', '{}', ...(recovery ? [recovery.mode === 'start' ? '--session-id' : '--resume', recovery.sessionId] : ['--no-session-persistence']),
    '--disable-slash-commands', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--tools', real ? start.claudeOptions!.tools : 'Bash', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose',
    '--model', start.model, '--effort', start.effort];
  const environment: Record<string, string> = { PATH: '/runtime:/usr/bin:/bin', LANG: 'C.UTF-8', HOME: home,
    CLAUDE_CONFIG_DIR: `${home}/claude`, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    ANTHROPIC_API_KEY: 'no-provider-authority', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
  if (real) {
    const roles = { haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL', opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL', subagent: 'CLAUDE_CODE_SUBAGENT_MODEL' };
    for (const [role, model] of Object.entries(start.claudeOptions!.modelRoles ?? {})) {
      if (!(role in roles) || model !== start.model) throw new Error('Multiple/unknown native model roles require separate qualification');
      environment[roles[role as keyof typeof roles]] = model;
    }
  } else Object.assign(environment, { CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: '1', MAX_THINKING_TOKENS: '0',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: start.model, ANTHROPIC_DEFAULT_SONNET_MODEL: start.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: start.model, CLAUDE_CODE_SUBAGENT_MODEL: start.model });
  return { args, environment };
}
