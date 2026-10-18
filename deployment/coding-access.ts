/** Physical filesystem capabilities belong only to the coding execution unit. */
export function codingAccess(name: string, mode?: 'inspect' | 'edit'): boolean {
  const action = name.replaceAll('.', '_');
  const filesystem = action.startsWith('workspace_') || action.startsWith('source_') || action === 'command_run';
  if (!filesystem) return true;
  if (mode === 'edit') return true;
  return mode === 'inspect' && ['workspace_read', 'workspace_search', 'workspace_discover', 'workspace_diff'].includes(action);
}
