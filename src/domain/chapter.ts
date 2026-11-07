import { randomUUID } from 'node:crypto'

import { DomainError } from './errors.js'
import { sha256 } from './paths.js'
import { ProjectStore } from './project-store.js'

export const CHAPTERS_DIR = 'outline/chapters'
export const ACCEPTED_MEMORY_PATH = 'memory/accepted_chapter_memory.json'
export const CHAPTER_SUMMARIES_PATH = 'memory/chapter_summaries.json'
export const TIMELINE_EVENTS_PATH = 'canon/timeline_events.json'
export const STORY_STATE_PATH = 'memory/story_state.json'

export interface ChapterSections {
  title: string
  outline: string
  plot: string
  prose: string
}

export interface ChapterSummary {
  id: string
  title: string
  path: string
  order: number
  version?: string
}

export interface ChapterDoc extends ChapterSummary {
  raw: string
  sha256: string
  version: string
  sections: ChapterSections
}

const SECTION_HEADING = /^##\s+(大纲|剧情简写|正文)\s*$/gm
const TITLE_HEADING = /^#\s+(.+?)\s*$/m

export function parseChapterSections(raw: string): ChapterSections {
  const matches = [...raw.matchAll(SECTION_HEADING)]
  const sections: ChapterSections = {
    title: TITLE_HEADING.exec(raw)?.[1]?.trim() ?? '',
    outline: '',
    plot: '',
    prose: '',
  }

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    if (!match) continue
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? raw.length
    const content = raw.slice(start, end).trim()
    if (match[1] === '大纲') sections.outline = content
    if (match[1] === '剧情简写') sections.plot = content
    if (match[1] === '正文') sections.prose = content
  }

  return sections
}

export function parseChapterTitle(raw: string): string {
  return TITLE_HEADING.exec(raw)?.[1]?.trim() ?? ''
}

export function chapterNumberFromId(id: string): number | null {
  const match = /^chapter[_-]?(\d+)$/i.exec(String(id ?? '').trim())
  if (!match?.[1]) return null
  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) ? value : null
}

export function chapterOrder(id: string): number {
  return chapterNumberFromId(id) ?? Number.MAX_SAFE_INTEGER
}

export function sanitizeChapterId(value: string): string {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
  return cleaned || 'chapter'
}

export function defaultChapterMarkdown(title: string): string {
  return (
    `# ${title}\n\n## 大纲\n- 本章目标：\n- 核心冲突：\n- 章节钩子：\n\n` +
    '## 剧情简写\n\n\n## 正文\n\n'
  )
}

function chapterPath(id: string): string {
  return `${CHAPTERS_DIR}/${id}.md`
}

function assertChapterId(id: string): string {
  const value = String(id ?? '').trim()
  if (!value || value === '.' || value === '..' || /[\\/]/.test(value) || value.includes('\0')) {
    throw new DomainError('invalid_chapter_id', '章节标识无效。')
  }
  return value
}

export async function listChapters(store: ProjectStore): Promise<ChapterSummary[]> {
  const entries = await store.listDir(CHAPTERS_DIR)
  const chapters: ChapterSummary[] = []

  for (const entry of entries) {
    if (entry.type !== 'file' || !entry.name.toLowerCase().endsWith('.md')) continue
    if (entry.name.startsWith('.')) continue
    const id = entry.name.slice(0, -3)
    try {
      const current = await store.readText(entry.relativePath)
      chapters.push({
        id,
        title: parseChapterTitle(current.raw) || id,
        path: entry.relativePath,
        order: chapterOrder(id),
        version: current.version,
      })
    } catch {
      // 读不到的章节不进入列表，避免 UI 打开空文件。
    }
  }

  return chapters.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}

export async function readChapter(store: ProjectStore, id: string): Promise<ChapterDoc> {
  const chapterId = assertChapterId(id)
  const relativePath = chapterPath(chapterId)
  const current = await store.readText(relativePath)
  return {
    id: chapterId,
    title: parseChapterTitle(current.raw) || chapterId,
    path: relativePath,
    order: chapterOrder(chapterId),
    version: current.version,
    raw: current.raw,
    sha256: await hashText(current.raw),
    sections: parseChapterSections(current.raw),
  }
}

export async function saveChapter(
  store: ProjectStore,
  id: string,
  raw: string,
  expectedVersion?: string,
): Promise<{ sha256: string; version: string }> {
  const chapterId = assertChapterId(id)
  const result = await store.writeText(chapterPath(chapterId), raw, expectedVersion)
  return { sha256: await hashText(raw), version: result.version }
}

export async function nextAvailableChapterId(
  store: ProjectStore,
  preferred?: string,
): Promise<string> {
  const chapters = await listChapters(store)
  const existing = new Set(chapters.map((chapter) => chapter.id.toLowerCase()))
  const numeric = chapters
    .map((chapter) => chapterNumberFromId(chapter.id))
    .filter((value): value is number => value !== null)
  const base = preferred?.trim()
    ? sanitizeChapterId(preferred)
    : `chapter_${String(Math.max(0, ...numeric) + 1).padStart(2, '0')}`

  let candidate = base
  let suffix = 2
  while (existing.has(candidate.toLowerCase())) {
    candidate = `${base}_${suffix}`
    suffix += 1
  }
  return candidate
}

export async function createChapter(
  store: ProjectStore,
  title: string,
  preferredId?: string,
): Promise<ChapterDoc> {
  const cleanTitle = String(title ?? '').trim()
  if (!cleanTitle) {
    throw new DomainError('invalid_title', '章节标题不能为空。')
  }
  const requested = String(preferredId ?? '').trim()
  const id = requested
    ? sanitizeChapterId(requested)
    : await nextAvailableChapterId(store)
  const relativePath = chapterPath(id)
  if (await store.exists(relativePath)) {
    throw new DomainError('already_exists', `章节标识已存在：${id}`, 409)
  }
  await store.createText(relativePath, defaultChapterMarkdown(cleanTitle))
  return readChapter(store, id)
}

function replaceChapterTitle(raw: string, title: string): string {
  if (TITLE_HEADING.test(raw)) {
    return raw.replace(TITLE_HEADING, `# ${title}`)
  }
  return `# ${title}\n\n${raw}`
}

export async function renameChapterTitle(
  store: ProjectStore,
  id: string,
  title: string,
  expectedVersion?: string,
): Promise<ChapterDoc> {
  const cleanTitle = String(title ?? '').trim()
  if (!cleanTitle) {
    throw new DomainError('invalid_title', '章节标题不能为空。')
  }
  const chapterId = assertChapterId(id)
  const current = await store.readText(chapterPath(chapterId))
  const version = expectedVersion ?? current.version
  await store.writeText(
    chapterPath(chapterId),
    replaceChapterTitle(current.raw, cleanTitle),
    version,
  )
  return readChapter(store, chapterId)
}

interface ChapterMove {
  from: string
  to: string
}

function remapChapterId(value: string, mapping: Map<string, string>): string {
  return mapping.get(value) ?? value
}

async function readOptionalJson(store: ProjectStore, relativePath: string): Promise<{
  raw: string
  version: string
  data: unknown
} | null> {
  if (!(await store.exists(relativePath))) return null
  const current = await store.readText(relativePath)
  try {
    return { ...current, data: JSON.parse(current.raw) }
  } catch {
    throw new DomainError('invalid_json', `无法解析派生数据：${relativePath}`, 500)
  }
}

async function ensureReorderSupported(store: ProjectStore): Promise<void> {
  const accepted = await readOptionalJson(store, ACCEPTED_MEMORY_PATH)
  if (!accepted) return
  const chapters = (accepted.data as { chapters?: Record<string, unknown> } | null)?.chapters
  if (chapters && Object.keys(chapters).length > 0) {
    throw new DomainError(
      'reorder_unsupported',
      '项目包含已采用的章节记忆，阶段 1 暂不支持重排；请先迁移或清空该记忆。',
      409,
    )
  }
}

async function remapReferenceFiles(
  store: ProjectStore,
  mapping: Map<string, string>,
): Promise<void> {
  const summaries = await readOptionalJson(store, CHAPTER_SUMMARIES_PATH)
  if (summaries) {
    const data = summaries.data as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [oldId, summary] of Object.entries(data)) {
      next[remapChapterId(oldId, mapping)] = summary
    }
    await store.writeText(
      CHAPTER_SUMMARIES_PATH,
      `${JSON.stringify(next, null, 2)}\n`,
      summaries.version,
    )
  }

  const timeline = await readOptionalJson(store, TIMELINE_EVENTS_PATH)
  if (timeline) {
    const data = timeline.data as { events?: Array<Record<string, unknown>> }
    if (Array.isArray(data.events)) {
      for (const event of data.events) {
        const ids = event.chapter_ids
        if (Array.isArray(ids)) {
          event.chapter_ids = ids.map((value) => remapChapterId(String(value), mapping))
        }
      }
    }
    await store.writeText(
      TIMELINE_EVENTS_PATH,
      `${JSON.stringify(data, null, 2)}\n`,
      timeline.version,
    )
  }

  const storyState = await readOptionalJson(store, STORY_STATE_PATH)
  if (storyState) {
    const data = storyState.data as { current_chapter?: unknown }
    if (typeof data.current_chapter === 'number') {
      const oldId = [...mapping.keys()].find(
        (id) => chapterNumberFromId(id) === data.current_chapter,
      )
      const newId = oldId ? mapping.get(oldId) : undefined
      const newNumber = newId ? chapterNumberFromId(newId) : null
      if (newNumber !== null) {
        data.current_chapter = newNumber
        await store.writeText(
          STORY_STATE_PATH,
          `${JSON.stringify(data, null, 2)}\n`,
          storyState.version,
        )
      }
    }
  }
}

export async function reorderChapters(
  store: ProjectStore,
  orderedIds: string[],
): Promise<ChapterSummary[]> {
  const chapters = await listChapters(store)
  const currentIds = chapters.map((chapter) => chapter.id)
  const normalized = orderedIds.map((value) => String(value ?? '').trim())

  if (
    normalized.length !== currentIds.length ||
    new Set(normalized).size !== normalized.length ||
    normalized.some((id) => !currentIds.includes(id))
  ) {
    throw new DomainError('invalid_order', '章节排序必须且只能包含当前全部章节。')
  }

  if (chapters.some((chapter) => chapterNumberFromId(chapter.id) === null)) {
    throw new DomainError(
      'reorder_unsupported',
      '项目包含自定义章节标识，阶段 1 暂不支持重排。',
      409,
    )
  }

  await ensureReorderSupported(store)

  const mapping = new Map<string, string>()
  normalized.forEach((oldId, index) => {
    mapping.set(oldId, `chapter_${String(index + 1).padStart(2, '0')}`)
  })

  if ([...mapping].every(([oldId, newId]) => oldId === newId)) {
    return chapters
  }

  const token = randomUUID().slice(0, 8)
  const moves: ChapterMove[] = []
  const originals = new Map<string, string>()

  for (const relativePath of [CHAPTER_SUMMARIES_PATH, TIMELINE_EVENTS_PATH, STORY_STATE_PATH]) {
    const current = await readOptionalJson(store, relativePath)
    if (current) originals.set(relativePath, current.raw)
  }

  try {
    for (const oldId of normalized) {
      const temp = `${CHAPTERS_DIR}/.reorder-${token}-${oldId}.tmp`
      await store.moveFile(chapterPath(oldId), temp)
      moves.push({ from: chapterPath(oldId), to: temp })
    }
    for (const oldId of normalized) {
      const newId = mapping.get(oldId)
      if (!newId) continue
      const temp = `${CHAPTERS_DIR}/.reorder-${token}-${oldId}.tmp`
      await store.moveFile(temp, chapterPath(newId))
      moves.push({ from: temp, to: chapterPath(newId) })
    }

    await remapReferenceFiles(store, mapping)
    return listChapters(store)
  } catch (error) {
    for (const move of [...moves].reverse()) {
      try {
        await store.moveFile(move.to, move.from)
      } catch {
        // 回滚失败时保留已生成的自动备份，交由人工恢复。
      }
    }
    for (const [relativePath, raw] of originals) {
      try {
        await store.writeText(relativePath, raw, undefined, { backup: false })
      } catch {
        // 同上。
      }
    }
    throw error
  }
}

async function hashText(text: string): Promise<string> {
  return sha256(text)
}
