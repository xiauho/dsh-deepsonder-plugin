import { DomainError } from './errors.js'
import { FsPortError, type FileSystemPort, type FsTarget, type FsWriteIntent } from './fs-port.js'

export interface ProjectStat {
  version: string
  type: 'file' | 'directory' | 'other'
  size?: number
}

export interface ProjectDirEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  relativePath: string
  version?: string
  size?: number
}

export interface WriteOptions {
  /** Set false for internal metadata that should not create content backups. */
  backup?: boolean
}

const BACKUP_DIRECTORY = '.novalist/backups'
const MAX_AUTO_BACKUPS = 50

function joinRelative(directory: string, name: string): string {
  return directory ? `${directory.replace(/\/$/, '')}/${name}` : name
}

function backupName(relativePath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safe = relativePath.replace(/[\\/:*?"<>|]/g, '_')
  return `auto-${stamp}-${safe}`
}

function isBackupCandidate(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/')
  return !normalized.startsWith('.novalist/')
}

function isNotObserved(error: unknown): boolean {
  return error instanceof FsPortError && error.code === 'FS_NOT_OBSERVED'
}

export class ProjectStore {
  constructor(
    readonly fs: FileSystemPort,
    readonly root: FsTarget,
  ) {}

  static async open(fs: FileSystemPort, rootPath: string): Promise<ProjectStore> {
    const root = await fs.resolve(rootPath)
    const info = await fs.stat(root)
    if (!info || info.type !== 'directory') {
      throw new DomainError('invalid_root', '项目目录不存在或不是文件夹。', 404)
    }
    return new ProjectStore(fs, root)
  }

  displayPath(relativePath: string): string {
    return joinRelative(this.root.displayPath, relativePath)
  }

  async resolve(relativePath: string): Promise<FsTarget> {
    const target = await this.fs.resolve(relativePath, { cwd: this.root.displayPath })
    if (!this.fs.contains(this.root, target)) {
      throw new DomainError('path_escape', `路径超出项目目录：${relativePath}`)
    }
    return target
  }

  async stat(relativePath: string): Promise<ProjectStat | undefined> {
    return this.fs.stat(await this.resolve(relativePath))
  }

  async exists(relativePath: string): Promise<boolean> {
    return (await this.stat(relativePath)) !== undefined
  }

  async readText(relativePath: string): Promise<{ raw: string; version: string }> {
    const target = await this.resolve(relativePath)
    const info = await this.fs.stat(target)
    if (!info || info.type !== 'file') {
      throw new DomainError('not_found', `文件不存在：${relativePath}`, 404)
    }
    const raw = await this.fs.readText(target)
    return { raw, version: info.version }
  }

  async writeText(
    relativePath: string,
    raw: string,
    expectedVersion?: string,
    options?: WriteOptions,
  ): Promise<{ version: string }> {
    const target = await this.resolve(relativePath)
    if (options?.backup !== false && isBackupCandidate(relativePath)) {
      await this.createBackup(relativePath)
    }
    const expected: FsWriteIntent | undefined = expectedVersion
      ? { kind: 'replaceIfVersion', version: expectedVersion }
      : undefined
    try {
      const outcome = await this.fs.writeText(target, raw, expected)
      void this.pruneBackups()
      return { version: outcome.version }
    } catch (error) {
      if (error instanceof FsPortError && error.code === 'FS_STALE_VERSION') {
        throw new DomainError('conflict', '文件已被其他程序修改，请重新载入后再保存。', 409)
      }
      throw error
    }
  }

  async createText(relativePath: string, raw: string): Promise<{ version: string }> {
    const target = await this.resolve(relativePath)
    try {
      const outcome = await this.fs.writeText(target, raw, { kind: 'createIfAbsent' })
      return { version: outcome.version }
    } catch (error) {
      if (isNotObserved(error)) {
        throw new DomainError('already_exists', `文件已存在：${relativePath}`, 409)
      }
      throw error
    }
  }

  async deleteFile(relativePath: string, expectedVersion?: string): Promise<void> {
    const target = await this.resolve(relativePath)
    try {
      await this.fs.deleteFile(target, expectedVersion ? { version: expectedVersion } : undefined)
    } catch (error) {
      if (error instanceof FsPortError && error.code === 'FS_STALE_VERSION') {
        throw new DomainError('conflict', '文件已被其他程序修改，请重新载入后再删除。', 409)
      }
      throw error
    }
  }

  async moveFile(
    sourceRelativePath: string,
    destinationRelativePath: string,
    options?: {
      expectedSourceVersion?: string
      expectedDestinationVersion?: string
    },
  ): Promise<void> {
    const source = await this.resolve(sourceRelativePath)
    const destination = await this.resolve(destinationRelativePath)
    const expectedDestination: FsWriteIntent | undefined = options?.expectedDestinationVersion
      ? { kind: 'replaceIfVersion', version: options.expectedDestinationVersion }
      : undefined
    try {
      await this.fs.moveFile(source, destination, {
        expectedSource: options?.expectedSourceVersion
          ? { version: options.expectedSourceVersion }
          : undefined,
        expectedDestination,
      })
    } catch (error) {
      if (error instanceof FsPortError && error.code === 'FS_STALE_VERSION') {
        throw new DomainError('conflict', '文件已被其他程序修改，请重新载入后再操作。', 409)
      }
      throw error
    }
  }

  async listDir(relativePath: string): Promise<ProjectDirEntry[]> {
    const target = await this.resolve(relativePath)
    const entries = await this.fs.listDir(target)
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.type,
      relativePath: joinRelative(relativePath, entry.name),
      version: entry.version,
      size: entry.size,
    }))
  }

  private async createBackup(relativePath: string): Promise<void> {
    if (!(await this.exists(relativePath))) return
    try {
      const current = await this.readText(relativePath)
      const target = await this.resolve(`${BACKUP_DIRECTORY}/${backupName(relativePath)}`)
      await this.fs.writeText(target, current.raw)
    } catch {
      // 备份失败不应阻塞主保存；主保存仍有版本守卫。
    }
  }

  private async pruneBackups(): Promise<void> {
    try {
      const entries = await this.listDir(BACKUP_DIRECTORY)
      const backups = entries
        .filter((entry) => entry.type === 'file' && entry.name.startsWith('auto-'))
        .sort((left, right) => right.name.localeCompare(left.name))
      for (const stale of backups.slice(MAX_AUTO_BACKUPS)) {
        await this.fs.deleteFile(await this.resolve(stale.relativePath))
      }
    } catch {
      // 备份目录不存在或清理失败都不影响主流程。
    }
  }
}
