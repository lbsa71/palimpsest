/** Wire types only. Run workspace-files.mjs as a confined child, never import it. */
export interface WorkspaceFileState { sha256: string; bytes: number; mode: 0o644 | 0o755 }
export interface WorkspaceFile extends WorkspaceFileState { path: string }
export type WorkspaceState = WorkspaceFileState | { directory: true; empty: true } | null;
export interface WorkspaceChange { path: string; before: WorkspaceState; after: WorkspaceState }
export interface WorkspaceLimits {
  maxFiles: number; maxTotalBytes: number; maxFileBytes: number; maxResponseBytes: number; maxResults: number;
}
export interface WorkspaceExpected { sha256: string; mode: 0o644 | 0o755 }
export interface WorkspaceCheckpoint {
  checkpointDigest: string; treeDigest: string; fullTreeDigest: string; files: WorkspaceFile[];
  directories: Array<{ path: string; mode: 0o700 | 0o755 }>; rootMode: 0o700 | 0o755; totalBytes: number;
}
export interface WorkspaceCheckpointPage extends WorkspaceFile {
  checkpointDigest: string; startByte: number; endByte: number; base64: string;
}
export type WorkspaceOperation =
  | { kind: 'manifest' }
  | { kind: 'list'; path?: string; cursor?: string }
  | { kind: 'search'; query: string; cursor?: number }
  | { kind: 'read'; path: string; expectedSha256?: string; startByte?: number; endByte?: number }
  | { kind: 'create'; path: string; content: string; mode: 0o644 | 0o755 }
  | { kind: 'replace'; path: string; content: string; mode: 0o644 | 0o755; expected: WorkspaceExpected }
  | { kind: 'edit'; path: string; oldText: string; newText: string; expected: WorkspaceExpected }
  | { kind: 'delete'; path: string; expected: WorkspaceExpected }
  | { kind: 'move'; path: string; destination: string; expected: WorkspaceExpected }
  | { kind: 'mkdir' | 'rmdir'; path: string }
  | { kind: 'observe' }
  // Trusted orchestration only; never include these in model-facing operations.
  | { kind: 'checkpoint'; expectedTreeDigest: string }
  | { kind: 'checkpoint-read'; checkpointDigest: string; path?: string; startByte?: number; endByte?: number };
export interface WorkspaceRequest { version: 1; operation: WorkspaceOperation; operationId?: string; expectedOperationDigest?: string; expectedRoot?: { device: number; inode: number }; limits: WorkspaceLimits }
export interface WorkspaceMutationResult {
  status: 'completed' | 'not-completed' | 'uncertain' | 'not-staged'; changes: WorkspaceChange[];
}
export type WorkspaceResult = WorkspaceCheckpoint | WorkspaceCheckpointPage | WorkspaceMutationResult | { files: WorkspaceFile[] }
  | { files: WorkspaceFile[]; directories: string[]; truncated: boolean; nextCursor: string | null }
  | { matches: Array<{ path: string; line: number; text: string }>; skippedBinaryFiles: number; truncated: boolean; nextCursor: number | null }
  | WorkspaceFile & { text: string; startByte: number; endByte: number };
export type WorkspaceResponse = { ok: true; result: WorkspaceResult }
  | { ok: false; code: string; conflict?: { path: string; current?: WorkspaceState | { directory: true; empty: false }; matches?: 'none' | 'multiple' } };
