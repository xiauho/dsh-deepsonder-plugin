import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import path from 'node:path'

import { DomainError } from './errors.js'
import { pathExists, readText, resolveInside, sha256, toPosix, writeTextAtomic } from './paths.js'

export type CanonKind = 'character' | 'world' | 'power' | 'timeline' | 'plan' | 'doc'
export type CanonFormat = 'markdown' | 'json'

export interface CanonEntry {
  id: string
  kind: CanonKind
  title: string
  path: string
  format: CanonFormat
}

export interface CanonDoc extends CanonEntry {
  raw: string
  sha256: string
}

const KIND_ORDER: Record<CanonKind, number> = {
  character: 0,
  world: 1,
  power: 2,
  timeline: 3,
  plan: 4,
  doc: 5,
}

const TITLE_HEADING = /^#\s+(.+?)\s*$/m

function classify(relativePath: string): CanonKind {
  const normalized = toPosix(relativePath)
  if (normalized.startsWith('canon/characters/')) return 'character'
  if (normalized.startsWith('canon/world/')) return 'world'
  if (normalized.startsWith('canon/power/')) return 'power'
  if (normalized === 'canon/timeline.md' || normalized === 'canon/timeline_events.json') {
    return 'timeline'
  }
  if (normalized === 'outline/story_plan.json') return 'plan'
  return 'doc'
}

function formatOf(relativePath: string): CanonFormat {
  return relativePath.toLowerCase().endsWith('.json') ? 'json' : 'markdown'
}

function titleFor(relativePath: string, raw?: string): string {
  const normalized = toPosix(relativePath)
  if (normalized === 'canon/timeline_events.json') return '时间线事件'
  if (normalized === 'outline/story_plan.json') return '故事规划'
  if (raw) {
    const heading = TITLE_HEADING.exec(raw)?.[1]?.trim()
    if (heading) return heading
  }
  return path.posix.basename(normalized, path.posix.extname(normalized))
}

function idFor(relativePath: string): string {
  return toPosix(relativePath).replace(/\.(md|json)$/i, '')
}

function isAllowedCanonPath(relativePath: string): boolean {
  const normalized = toPosix(relativePath)
  return normalized.startsWith('canon/') || normalized === 'outline/story_plan.json'
}

function describe(relativePath: string, raw?: string): CanonEntry {
  return {
    id: idFor(relativePath),
    kind: classify(relativePath),
    title: titleFor(relativePath, raw),
    path: toPosix(relativePath),
    format: formatOf(relativePath),
  }
}

async function walk(directory: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

export async function listCanon(root: string): Promise<CanonEntry[]> {
  const entries: CanonEntry[] = []
  const canonDirectory = resolveInside(root, 'canon')
  const files = await walk(canonDirectory)

  for (const fullPath of files) {
    if (!fullPath.toLowerCase().endsWith('.md')) continue
    const relative = toPosix(path.relative(path.resolve(root), fullPath))
    if (relative === 'canon/timeline.md') {
      let raw = ''
      try {
        raw = await readText(fullPath)
      } catch {
        // 读不到的文档不进入列表，避免 UI 打开空文件。
        continue
      }
      entries.push(describe(relative, raw))
      continue
    }
    let raw = ''
    try {
      raw = await readText(fullPath)
    } catch {
      continue
    }
    entries.push(describe(relative, raw))
  }

  const timelineJson = resolveInside(root, 'canon/timeline_events.json')
  if (await pathExists(timelineJson)) {
    entries.push(describe('canon/timeline_events.json'))
  }

  const storyPlan = resolveInside(root, 'outline/story_plan.json')
  if (await pathExists(storyPlan)) {
    entries.push(describe('outline/story_plan.json'))
  }

  return entries.sort((left, right) => {
    const kindDelta = KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    if (kindDelta !== 0) return kindDelta
    return left.title.localeCompare(right.title, 'zh-CN')
  })
}

export async function readCanonDoc(root: string, relativePath: string): Promise<CanonDoc> {
  if (!isAllowedCanonPath(relativePath)) {
    throw new DomainError('invalid_canon_path', '只能读取 canon/ 或故事规划文件。')
  }
  const fullPath = resolveInside(root, relativePath)
  if (!(await pathExists(fullPath))) {
    throw new DomainError('canon_not_found', `找不到资料文件：${relativePath}`, 404)
  }
  const raw = await readText(fullPath)
  return {
    ...describe(relativePath, raw),
    raw,
    sha256: sha256(raw),
  }
}

export async function saveCanonDoc(
  root: string,
  relativePath: string,
  raw: string,
  expectedSha?: string,
): Promise<{ sha256: string }> {
  if (!isAllowedCanonPath(relativePath)) {
    throw new DomainError('invalid_canon_path', '只能保存 canon/ 或故事规划文件。')
  }
  if (formatOf(relativePath) === 'json') {
    try {
      JSON.parse(raw)
    } catch {
      throw new DomainError('invalid_json', 'JSON 内容无法解析，未保存。')
    }
  }
  const fullPath = resolveInside(root, relativePath)
  if (!(await pathExists(fullPath))) {
    throw new DomainError('canon_not_found', `找不到资料文件：${relativePath}`, 404)
  }
  const current = await readText(fullPath)
  if (expectedSha && sha256(current) !== expectedSha) {
    throw new DomainError('conflict', '资料文件已被其他程序修改，请重新载入后再保存。', 409)
  }
  await writeTextAtomic(fullPath, raw)
  return { sha256: sha256(raw) }
}
