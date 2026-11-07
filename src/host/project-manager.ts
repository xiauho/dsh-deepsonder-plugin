import path from 'node:path'

import { DomainError } from '../domain/errors.js'
import type { FileSystemPort } from '../domain/fs-port.js'
import { ProjectLock } from '../domain/project-lock.js'
import { openProject, refreshProject, type ProjectSummary } from '../domain/project.js'
import type { ProjectStore } from '../domain/project-store.js'

interface ActiveProject {
  store: ProjectStore
  lock: ProjectLock
  summary: ProjectSummary
}

function normalizeRoot(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export class ProjectManager {
  private active: ActiveProject | null = null

  constructor(private readonly fs: FileSystemPort) {}

  async open(rootInput: string, force = false): Promise<ProjectSummary> {
    if (this.active) await this.close()
    const opened = await openProject(this.fs, rootInput)
    const lock = new ProjectLock(opened.store)
    await lock.acquire(force)
    this.active = { ...opened, lock }
    return opened.summary
  }

  async close(): Promise<void> {
    const active = this.active
    this.active = null
    if (active) await active.lock.release()
  }

  require(rootInput?: string): ActiveProject {
    if (!this.active) {
      throw new DomainError('project_not_open', '请先打开项目。', 409)
    }
    if (rootInput && normalizeRoot(rootInput) !== normalizeRoot(this.active.summary.root)) {
      throw new DomainError('project_mismatch', '请求的项目与当前打开的项目不一致。', 409)
    }
    return this.active
  }

  async refresh(): Promise<ProjectSummary> {
    const active = this.require()
    active.summary = await refreshProject(active.store)
    return active.summary
  }

  async touch(): Promise<void> {
    if (this.active) await this.active.lock.touch()
  }
}
