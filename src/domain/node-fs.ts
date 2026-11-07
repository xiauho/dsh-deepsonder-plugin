import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { Dirent, Stats } from 'node:fs'
import path from 'node:path'

import {
  FsPortError,
  type FileSystemPort,
  type FsDirEntry,
  type FsEntryType,
  type FsInfo,
  type FsTarget,
  type FsWriteIntent,
  type FsWriteOutcome,
} from './fs-port.js'

function typeOf(info: Stats): FsEntryType {
  if (info.isFile()) return 'file'
  if (info.isDirectory()) return 'directory'
  return 'other'
}

function versionOf(info: Stats): string {
  return `${info.mtimeMs}:${info.ctimeMs}:${info.size}:${info.ino}`
}

async function readInfo(targetPath: string): Promise<FsInfo | undefined> {
  try {
    const info = await fs.stat(targetPath)
    return { version: versionOf(info), type: typeOf(info), size: info.size }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new FsPortError('FS_IO_ERROR', String((error as Error).message ?? error))
  }
}

function ensureWriteAllowed(
  current: FsInfo | undefined,
  expected: FsWriteIntent | undefined,
  targetPath: string,
): void {
  if (!expected) return
  if (expected.kind === 'createIfAbsent') {
    if (current) {
      throw new FsPortError('FS_NOT_OBSERVED', `目标已存在，拒绝创建：${targetPath}`)
    }
    return
  }
  if (!current) {
    throw new FsPortError('FS_STALE_VERSION', `目标不存在或已被删除：${targetPath}`)
  }
  if (current.version !== expected.version) {
    throw new FsPortError('FS_STALE_VERSION', `目标已被其他程序修改：${targetPath}`)
  }
}

export class NodeFileSystem implements FileSystemPort {
  async resolve(input: string, opts?: { cwd?: string }): Promise<FsTarget> {
    const resolved = path.resolve(opts?.cwd ?? process.cwd(), input)
    return { targetKey: resolved, displayPath: resolved }
  }

  async stat(target: FsTarget): Promise<FsInfo | undefined> {
    return readInfo(target.targetKey)
  }

  async readText(target: FsTarget): Promise<string> {
    try {
      return await fs.readFile(target.targetKey, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FsPortError('FS_NOT_FOUND', `文件不存在：${target.displayPath}`)
      }
      throw new FsPortError('FS_IO_ERROR', String((error as Error).message ?? error))
    }
  }

  async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
  ): Promise<FsWriteOutcome> {
    const current = await readInfo(target.targetKey)
    ensureWriteAllowed(current, expected, target.targetKey)

    let before: string | null = null
    if (current) {
      try {
        before = await fs.readFile(target.targetKey, 'utf8')
      } catch {
        before = null
      }
    }

    const directory = path.dirname(target.targetKey)
    await fs.mkdir(directory, { recursive: true })
    const temp = path.join(directory, `.${path.basename(target.targetKey)}.${randomUUID()}.tmp`)
    try {
      const handle = await fs.open(temp, 'w')
      try {
        await handle.writeFile(content, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.rename(temp, target.targetKey)
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined)
      throw new FsPortError('FS_IO_ERROR', String((error as Error).message ?? error))
    }

    const afterInfo = await fs.stat(target.targetKey)
    return {
      operation: current ? 'update' : 'create',
      version: versionOf(afterInfo),
      before,
      after: content,
    }
  }

  async deleteFile(target: FsTarget, expected?: { version: string }): Promise<unknown> {
    const current = await readInfo(target.targetKey)
    if (!current) {
      throw new FsPortError('FS_STALE_VERSION', `文件不存在：${target.displayPath}`)
    }
    if (expected && current.version !== expected.version) {
      throw new FsPortError('FS_STALE_VERSION', `文件已被其他程序修改：${target.displayPath}`)
    }
    try {
      await fs.unlink(target.targetKey)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FsPortError('FS_STALE_VERSION', `文件不存在：${target.displayPath}`)
      }
      throw new FsPortError('FS_IO_ERROR', String((error as Error).message ?? error))
    }
    return undefined
  }

  async moveFile(
    source: FsTarget,
    destination: FsTarget,
    options?: {
      expectedSource?: { version: string }
      expectedDestination?: FsWriteIntent
    },
  ): Promise<unknown> {
    const sourceInfo = await readInfo(source.targetKey)
    if (!sourceInfo) {
      throw new FsPortError('FS_STALE_VERSION', `源文件不存在：${source.displayPath}`)
    }
    if (options?.expectedSource && sourceInfo.version !== options.expectedSource.version) {
      throw new FsPortError('FS_STALE_VERSION', `源文件已被修改：${source.displayPath}`)
    }
    const destinationInfo = await readInfo(destination.targetKey)
    ensureWriteAllowed(destinationInfo, options?.expectedDestination, destination.targetKey)

    await fs.mkdir(path.dirname(destination.targetKey), { recursive: true })
    try {
      await fs.rename(source.targetKey, destination.targetKey)
    } catch (error) {
      throw new FsPortError('FS_IO_ERROR', String((error as Error).message ?? error))
    }
    return undefined
  }

  async listDir(target: FsTarget): Promise<FsDirEntry[]> {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(target.targetKey, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new FsPortError('FS_IO_ERROR', String((error as Error).message ?? error))
    }

    const result: FsDirEntry[] = []
    for (const entry of entries) {
      const childPath = path.join(target.targetKey, entry.name)
      const info = await readInfo(childPath)
      result.push({
        name: entry.name,
        type: info?.type ?? (entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'),
        target: { targetKey: childPath, displayPath: childPath },
        version: info?.version,
        size: info?.size,
      })
    }
    return result.sort((left, right) => left.name.localeCompare(right.name))
  }

  contains(parent: FsTarget, child: FsTarget): boolean {
    const relative = path.relative(parent.targetKey, child.targetKey)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  processPath(target: FsTarget): string {
    return target.targetKey
  }
}
