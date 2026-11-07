import { randomUUID } from 'node:crypto'

import { DomainError } from './errors.js'
import { ProjectStore } from './project-store.js'

const LOCK_PATH = '.novalist/plugin.lock'

interface LockPayload {
  token: string
  pid: number
  plugin: string
  startedAt: string
}

interface ExistingLock {
  raw: string
  version: string
  payload: LockPayload | null
}

export class ProjectLock {
  private readonly token = randomUUID()
  private version: string | undefined

  constructor(private readonly store: ProjectStore) {}

  async acquire(force = false): Promise<void> {
    const existing = await this.readExisting()
    if (existing && !force) {
      const owner = existing.payload
        ? `pid ${existing.payload.pid}，开始于 ${existing.payload.startedAt}`
        : '无法识别的锁文件'
      throw new DomainError(
        'project_locked',
        `项目已被另一个会话打开（${owner}）。关闭该会话后重试，或使用强制打开。`,
        409,
      )
    }

    const payload: LockPayload = {
      token: this.token,
      pid: process.pid,
      plugin: 'dsh-deepsonder-plugin',
      startedAt: new Date().toISOString(),
    }
    const content = `${JSON.stringify(payload, null, 2)}\n`

    try {
      if (existing) {
        const result = await this.store.writeText(LOCK_PATH, content, existing.version, {
          backup: false,
        })
        this.version = result.version
      } else {
        const result = await this.store.createText(LOCK_PATH, content)
        this.version = result.version
      }
    } catch (error) {
      if (error instanceof DomainError && error.code === 'already_exists') {
        const raced = await this.readExisting()
        const owner = raced?.payload ? `pid ${raced.payload.pid}` : '另一个会话'
        throw new DomainError('project_locked', `项目已被${owner}打开。`, 409)
      }
      throw error
    }
  }

  async touch(): Promise<void> {
    const existing = await this.readExisting()
    if (!existing?.payload || existing.payload.token !== this.token) return
    const next: LockPayload = {
      ...existing.payload,
      startedAt: new Date().toISOString(),
    }
    try {
      const result = await this.store.writeText(
        LOCK_PATH,
        `${JSON.stringify(next, null, 2)}\n`,
        existing.version,
        { backup: false },
      )
      this.version = result.version
    } catch {
      // 锁被其他会话接管时不再强行续租。
    }
  }

  async release(): Promise<void> {
    const existing = await this.readExisting()
    if (!existing?.payload || existing.payload.token !== this.token) return
    try {
      await this.store.deleteFile(LOCK_PATH, existing.version)
    } catch {
      // 锁已删除或被接管时无需报错。
    } finally {
      this.version = undefined
    }
  }

  private async readExisting(): Promise<ExistingLock | null> {
    try {
      const current = await this.store.readText(LOCK_PATH)
      let payload: LockPayload | null = null
      try {
        const parsed = JSON.parse(current.raw) as Partial<LockPayload>
        if (
          typeof parsed.token === 'string' &&
          typeof parsed.pid === 'number' &&
          typeof parsed.startedAt === 'string'
        ) {
          payload = {
            token: parsed.token,
            pid: parsed.pid,
            plugin: typeof parsed.plugin === 'string' ? parsed.plugin : 'unknown',
            startedAt: parsed.startedAt,
          }
        }
      } catch {
        payload = null
      }
      return { raw: current.raw, version: current.version, payload }
    } catch (error) {
      if (error instanceof DomainError && error.status === 404) return null
      throw error
    }
  }
}
