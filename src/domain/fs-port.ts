/**
 * Minimal filesystem contract used by the domain layer.
 *
 * The shape mirrors DSH `ctx.fs` closely enough that the host can pass the
 * real service through with a structural cast. Tests use `NodeFileSystem`.
 */

export type FsEntryType = 'file' | 'directory' | 'other'

export interface FsTarget {
  targetKey: string
  displayPath: string
}

export interface FsInfo {
  version: string
  type: FsEntryType
  size?: number
}

export interface FsDirEntry {
  name: string
  type: FsEntryType
  target: FsTarget
  version?: string
  size?: number
}

export type FsWriteIntent =
  | { kind: 'createIfAbsent' }
  | { kind: 'replaceIfVersion'; version: string }

export interface FsWriteOutcome {
  operation: 'create' | 'update'
  version: string
  before: string | null
  after: string
}

export interface FileSystemPort {
  resolve(path: string, opts?: { cwd?: string }): Promise<FsTarget>
  stat(target: FsTarget): Promise<FsInfo | undefined>
  readText(target: FsTarget): Promise<string>
  writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
  ): Promise<FsWriteOutcome>
  deleteFile(target: FsTarget, expected?: { version: string }): Promise<unknown>
  moveFile(
    source: FsTarget,
    destination: FsTarget,
    options?: {
      expectedSource?: { version: string }
      expectedDestination?: FsWriteIntent
    },
  ): Promise<unknown>
  listDir(target: FsTarget): Promise<FsDirEntry[]>
  contains(parent: FsTarget, child: FsTarget): boolean
  processPath(target: FsTarget): string
}

export class FsPortError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'FsPortError'
    this.code = code
  }
}

export function isFsPortError(error: unknown, code?: string): error is FsPortError {
  if (!(error instanceof FsPortError)) return false
  return code === undefined || error.code === code
}
