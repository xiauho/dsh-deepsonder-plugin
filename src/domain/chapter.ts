import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import path from 'node:path'

import { DomainError } from './errors.js'
import { pathExists, readText, resolveInside, sha256, toPosix, writeTextAtomic } from './paths.js'

export const CHAPTERS_DIR = 'outline/chapters'

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
}

export interface ChapterDoc extends ChapterSummary {
  raw: string
  sha256: string
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

function assertChapterId(id: string): string {
  const value = String(id ?? '').trim()
  if (!value || value === '.' || value === '..' || /[\\/]/.test(value) || value.includes('\0')) {
    throw new DomainError('invalid_chapter_id', '章节标识无效。')
  }
  return value
}

function chapterOrder(id: string): number {
  const digits = id.match(/(\d+)/)
  if (!digits?.[1]) return Number.MAX_SAFE_INTEGER
  return Number.parseInt(digits[1], 10)
}

function chapterTitle(raw: string, fallback: string): string {
  return TITLE_HEADING.exec(raw)?.[1]?.trim() || fallback
}

export async function listChapters(root: string): Promise<ChapterSummary[]> {
  const directory = resolveInside(root, CHAPTERS_DIR)
  let entries: Dirent[]
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const chapters: ChapterSummary[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
    const id = entry.name.slice(0, -3)
    const fullPath = path.join(directory, entry.name)
    let raw = ''
    try {
      raw = await readText(fullPath)
    } catch {
      continue
    }
    chapters.push({
      id,
      title: chapterTitle(raw, id),
      path: toPosix(path.relative(path.resolve(root), fullPath)),
      order: chapterOrder(id),
    })
  }

  return chapters.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}

export async function readChapter(root: string, id: string): Promise<ChapterDoc> {
  const chapterId = assertChapterId(id)
  const relativePath = `${CHAPTERS_DIR}/${chapterId}.md`
  const fullPath = resolveInside(root, relativePath)
  if (!(await pathExists(fullPath))) {
    throw new DomainError('chapter_not_found', `找不到章节：${chapterId}`, 404)
  }
  const raw = await readText(fullPath)
  return {
    id: chapterId,
    title: chapterTitle(raw, chapterId),
    path: relativePath,
    order: chapterOrder(chapterId),
    raw,
    sha256: sha256(raw),
    sections: parseChapterSections(raw),
  }
}

export async function saveChapter(
  root: string,
  id: string,
  raw: string,
  expectedSha?: string,
): Promise<{ sha256: string }> {
  const chapterId = assertChapterId(id)
  const fullPath = resolveInside(root, `${CHAPTERS_DIR}/${chapterId}.md`)
  if (!(await pathExists(fullPath))) {
    throw new DomainError('chapter_not_found', `找不到章节：${chapterId}`, 404)
  }
  const current = await readText(fullPath)
  if (expectedSha && sha256(current) !== expectedSha) {
    throw new DomainError('conflict', '章节已被其他程序修改，请重新载入后再保存。', 409)
  }
  await writeTextAtomic(fullPath, raw)
  return { sha256: sha256(raw) }
}
