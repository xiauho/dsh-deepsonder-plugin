import path from 'node:path'

import { DomainError } from './errors.js'
import { sha256 } from './paths.js'
import { ProjectStore } from './project-store.js'

export type CanonKind = 'character' | 'world' | 'power' | 'timeline' | 'plan' | 'doc'
export type CanonFormat = 'markdown' | 'json'

export interface CanonEntry {
  id: string
  kind: CanonKind
  title: string
  path: string
  format: CanonFormat
  version?: string
}

export interface CanonDoc extends CanonEntry {
  raw: string
  sha256: string
  version: string
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

function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}

function describe(relativePath: string, raw?: string, version?: string): CanonEntry {
  return {
    id: idFor(relativePath),
    kind: classify(relativePath),
    title: titleFor(relativePath, raw),
    path: toPosix(relativePath),
    format: formatOf(relativePath),
    version,
  }
}

async function walk(store: ProjectStore, directory: string): Promise<string[]> {
  const entries = await store.listDir(directory)
  const files: string[] = []
  for (const entry of entries) {
    if (entry.type === 'directory') {
      files.push(...(await walk(store, entry.relativePath)))
    } else if (entry.type === 'file') {
      files.push(entry.relativePath)
    }
  }
  return files
}

export async function listCanon(store: ProjectStore): Promise<CanonEntry[]> {
  const entries: CanonEntry[] = []
  const files = await walk(store, 'canon')

  for (const relativePath of files) {
    if (!relativePath.toLowerCase().endsWith('.md')) continue
    try {
      const current = await store.readText(relativePath)
      entries.push(describe(relativePath, current.raw, current.version))
    } catch {
      // 读不到的文档不进入列表。
    }
  }

  if (await store.exists('canon/timeline_events.json')) {
    entries.push(describe('canon/timeline_events.json'))
  }
  if (await store.exists('outline/story_plan.json')) {
    entries.push(describe('outline/story_plan.json'))
  }

  return entries.sort((left, right) => {
    const kindDelta = KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    if (kindDelta !== 0) return kindDelta
    return left.title.localeCompare(right.title, 'zh-CN')
  })
}

export async function readCanonDoc(store: ProjectStore, relativePath: string): Promise<CanonDoc> {
  if (!isAllowedCanonPath(relativePath)) {
    throw new DomainError('invalid_canon_path', '只能读取 canon/ 或故事规划文件。')
  }
  const current = await store.readText(toPosix(relativePath))
  return {
    ...describe(relativePath, current.raw, current.version),
    raw: current.raw,
    sha256: sha256(current.raw),
    version: current.version,
  }
}

export async function saveCanonDoc(
  store: ProjectStore,
  relativePath: string,
  raw: string,
  expectedVersion?: string,
): Promise<{ sha256: string; version: string }> {
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
  const result = await store.writeText(toPosix(relativePath), raw, expectedVersion)
  return { sha256: sha256(raw), version: result.version }
}
