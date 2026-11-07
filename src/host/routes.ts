import type { IncomingMessage, ServerResponse } from 'node:http'

import { readCanonDoc, listCanon, saveCanonDoc } from '../domain/canon.js'
import { readChapter, saveChapter } from '../domain/chapter.js'
import { DomainError } from '../domain/errors.js'
import { openProject } from '../domain/project.js'
import { listTrash, restoreTrash } from '../domain/trash.js'

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
        const message = error instanceof Error ? error.message : String(error)
        sendJson(res, 500, { error: message, code: 'internal_error' })
      })
    },
  }
}

export function registerRoutes(webServer: WebServer): () => void {
  const disposers: Array<() => void> = []

  disposers.push(
    webServer.register(
      exact('/deepsonder/health', 'GET', async (_req, res) => {
        sendJson(res, 200, {
          ok: true,
          plugin: 'deepsonder',
          stage: 'phase-0',
          time: new Date().toISOString(),
        })
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/project/open', 'POST', async (req, res) => {
        const body = await readBody(req)
        const summary = await openProject(bodyString(body, 'root'))
        sendJson(res, 200, summary)
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/project/summary', 'GET', async (_req, res, url) => {
        const summary = await openProject(queryParam(url, 'root'))
        sendJson(res, 200, summary)
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/chapter', 'GET', async (_req, res, url) => {
        const chapter = await readChapter(queryParam(url, 'root'), queryParam(url, 'id'))
        sendJson(res, 200, chapter)
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/chapter/save', 'POST', async (req, res) => {
        const body = await readBody(req)
        const result = await saveChapter(
          bodyString(body, 'root'),
          bodyString(body, 'id'),
          bodyString(body, 'raw'),
          bodyString(body, 'expectedSha') || undefined,
        )
        sendJson(res, 200, result)
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/canon', 'GET', async (_req, res, url) => {
        const root = queryParam(url, 'root')
        if (!root) throw new DomainError('invalid_root', '请填写项目目录。')
        sendJson(res, 200, { entries: await listCanon(root) })
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/canon/doc', 'GET', async (_req, res, url) => {
        const doc = await readCanonDoc(queryParam(url, 'root'), queryParam(url, 'path'))
        sendJson(res, 200, doc)
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/canon/save', 'POST', async (req, res) => {
        const body = await readBody(req)
        const result = await saveCanonDoc(
          bodyString(body, 'root'),
          bodyString(body, 'path'),
          bodyString(body, 'raw'),
          bodyString(body, 'expectedSha') || undefined,
        )
        sendJson(res, 200, result)
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/trash', 'GET', async (_req, res, url) => {
        const root = queryParam(url, 'root')
        if (!root) throw new DomainError('invalid_root', '请填写项目目录。')
        sendJson(res, 200, { entries: await listTrash(root) })
      }),
    ),
  )

  disposers.push(
    webServer.register(
      exact('/deepsonder/trash/restore', 'POST', async (req, res) => {
        const body = await readBody(req)
        const result = await restoreTrash(bodyString(body, 'root'), bodyString(body, 'trashId'))
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
