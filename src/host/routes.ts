import type { IncomingMessage, ServerResponse } from 'node:http'

import { listCanon, readCanonDoc, saveCanonDoc } from '../domain/canon.js'
import {
  createChapter,
  readChapter,
  renameChapterTitle,
  reorderChapters,
  saveChapter,
} from '../domain/chapter.js'
import { DomainError } from '../domain/errors.js'
import { FsPortError } from '../domain/fs-port.js'
import { listTrash, moveChapterToTrash, restoreTrash } from '../domain/trash.js'
import { ProjectManager } from './project-manager.js'

interface RouteSpec {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void
}

interface WebServer {
  register: (spec: RouteSpec) => () => void
}

const MAX_BODY_BYTES = 32 * 1024 * 1024

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const buffer = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buffer.length,
    'cache-control': 'no-store',
  })
  res.end(buffer)
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) {
      throw new DomainError('body_too_large', '请求内容超过安全上限。', 413)
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new DomainError('invalid_body', '请求体必须是 JSON 对象。')
  }
}

function queryParam(url: URL, name: string): string {
  return url.searchParams.get(name) ?? ''
}

function bodyString(body: Record<string, unknown>, name: string): string {
  const value = body[name]
  return typeof value === 'string' ? value : ''
}

function bodyBoolean(body: Record<string, unknown>, name: string): boolean {
  return body[name] === true
}

function bodyStringArray(body: Record<string, unknown>, name: string): string[] {
  const value = body[name]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>

function exact(path: string, method: string, handler: Handler): RouteSpec {
  return {
    kind: 'exact',
    path,
    handler: (req, res) => {
      const url = new URL(req.url ?? path, 'http://127.0.0.1')
      if ((req.method ?? 'GET').toUpperCase() !== method) {
        sendJson(res, 405, { error: `只支持 ${method}。`, code: 'method_not_allowed' })
        return
      }
      void handler(req, res, url).catch((error: unknown) => {
        if (error instanceof DomainError) {
          sendJson(res, error.status, { error: error.message, code: error.code })
          return
        }
        if (error instanceof FsPortError) {
          if (error.code === 'FS_SANDBOX_DENIED') {
            sendJson(res, 403, {
              error:
                '项目目录不在当前 DSH 工作区的可写范围内。请把项目添加为 DSH 工作区，或在 DSH 中允许完整文件访问。',
              code: error.code,
            })
            return
          }
          if (error.code === 'FS_NOT_FOUND') {
            sendJson(res, 404, { error: error.message, code: error.code })
            return
          }
          if (error.code === 'FS_STALE_VERSION' || error.code === 'FS_NOT_OBSERVED') {
            sendJson(res, 409, { error: error.message, code: error.code })
            return
          }
          sendJson(res, 500, { error: error.message, code: error.code })
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        sendJson(res, 500, { error: message, code: 'internal_error' })
      })
    },
  }
}

export function registerRoutes(webServer: WebServer, manager: ProjectManager): () => void {
  const disposers: Array<() => void> = []

  disposers.push(
    webServer.register(
      exact('/deepsonder/health', 'GET', async (_req, res) => {
        sendJson(res, 200, {
          ok: true,
          plugin: 'deepsonder',
          stage: 'phase-1',
          time: new Date().toISOString(),
        })
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/project/open', 'POST', async (req, res) => {
        const body = await readBody(req)
        const summary = await manager.open(
          bodyString(body, 'root'),
          bodyBoolean(body, 'force'),
        )
        sendJson(res, 200, summary)
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/project/close', 'POST', async (_req, res) => {
        await manager.close()
        sendJson(res, 200, { ok: true })
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/project/summary', 'GET', async (_req, res, url) => {
        manager.require(queryParam(url, 'root'))
        sendJson(res, 200, await manager.refresh())
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/chapter', 'GET', async (_req, res, url) => {
        const { store } = manager.require(queryParam(url, 'root'))
        sendJson(res, 200, await readChapter(store, queryParam(url, 'id')))
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/chapter/save', 'POST', async (req, res) => {
        const body = await readBody(req)
        const { store } = manager.require(bodyString(body, 'root'))
        await manager.touch()
        const result = await saveChapter(
          store,
          bodyString(body, 'id'),
          bodyString(body, 'raw'),
          bodyString(body, 'expectedVersion') || undefined,
        )
        sendJson(res, 200, result)
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/chapter/create', 'POST', async (req, res) => {
        const body = await readBody(req)
        const { store } = manager.require(bodyString(body, 'root'))
        await manager.touch()
        const chapter = await createChapter(
          store,
          bodyString(body, 'title'),
          bodyString(body, 'id') || undefined,
        )
        sendJson(res, 200, chapter)
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/chapter/rename', 'POST', async (req, res) => {
        const body = await readBody(req)
        const { store } = manager.require(bodyString(body, 'root'))
        await manager.touch()
        const chapter = await renameChapterTitle(
          store,
          bodyString(body, 'id'),
          bodyString(body, 'title'),
          bodyString(body, 'expectedVersion') || undefined,
        )
        sendJson(res, 200, chapter)
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/chapter/reorder', 'POST', async (req, res) => {
        const body = await readBody(req)
        const { store } = manager.require(bodyString(body, 'root'))
        await manager.touch()
        const chapters = await reorderChapters(store, bodyStringArray(body, 'orderedIds'))
        sendJson(res, 200, { chapters })
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/chapter/delete', 'POST', async (req, res) => {
        const body = await readBody(req)
        const { store } = manager.require(bodyString(body, 'root'))
        await manager.touch()
        const entry = await moveChapterToTrash(store, bodyString(body, 'id'))
        sendJson(res, 200, entry)
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/canon', 'GET', async (_req, res, url) => {
        const { store } = manager.require(queryParam(url, 'root'))
        sendJson(res, 200, { entries: await listCanon(store) })
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/canon/doc', 'GET', async (_req, res, url) => {
        const { store } = manager.require(queryParam(url, 'root'))
        sendJson(res, 200, await readCanonDoc(store, queryParam(url, 'path')))
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/canon/save', 'POST', async (req, res) => {
        const body = await readBody(req)
        const { store } = manager.require(bodyString(body, 'root'))
        await manager.touch()
        const result = await saveCanonDoc(
          store,
          bodyString(body, 'path'),
          bodyString(body, 'raw'),
          bodyString(body, 'expectedVersion') || undefined,
        )
        sendJson(res, 200, result)
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/trash', 'GET', async (_req, res, url) => {
        const { store } = manager.require(queryParam(url, 'root'))
        sendJson(res, 200, { entries: await listTrash(store) })
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/trash/restore', 'POST', async (req, res) => {
        const body = await readBody(req)
        const { store } = manager.require(bodyString(body, 'root'))
        await manager.touch()
        const result = await restoreTrash(store, bodyString(body, 'trashId'))
        sendJson(res, 200, result)
      }),
    ),
  )

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // 单个路由清理失败不应阻止其余路由卸载。
      }
    }
  }
}
