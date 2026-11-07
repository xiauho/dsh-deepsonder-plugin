import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import path from 'node:path'

import { DomainError } from './errors.js'
import {
  pathExists,
  readJson,
  readText,
  resolveInside,
  toPosix,
  writeJsonAtomic,
  writeTextAtomic,
} from './paths.js'

export type TrashKind = 'chapter' | 'character' | 'canon'

interface RawManifest {
  [key: string]: unknown
}

export interface TrashEntry {
  trashId: string
  kind: TrashKind
  title: string
  originalPath: string
  deletedAt: string
  hasSummary: boolean
  folder: string
  manifest: RawManifest
}

interface TrashRoot {
  directory: string
  kind: TrashKind
}

const TRASH_ROOTS: TrashRoot[] = [
  { directory: '.novalist/trash', kind: 'chapter' },
  { directory: '.novalist/trash/characters', kind: 'character' },
  { directory: '.novalist/trash/canon', kind: 'canon' },
]

const RESERVED_TRASH_DIRECTORIES = new Set(['characters', 'canon'])

function stringField(manifest: RawManifest, key: string): string {
  const value = manifest[key]
  return typeof value === 'string' ? value : ''
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/')
}

function readEntry(manifest: RawManifest, folder: string, kind: TrashKind): TrashEntry | null {
  const trashId = stringField(manifest, 'trash_id')
  const originalPath = stringField(manifest, 'original_path')
  const deletedAt = stringField(manifest, 'deleted_at')
  if (!trashId || path.basename(folder) !== trashId || !originalPath || !deletedAt) {
    return null
  }
  return {
    trashId,
    kind,
    title: stringField(manifest, 'title') || path.basename(originalPath).replace(/\.md$/i, ''),
    originalPath: normalizeRelative(originalPath),
    deletedAt,
    hasSummary: manifest.has_summary === true,
    folder,
    manifest,
  }
}

export async function listTrash(root: string): Promise<TrashEntry[]> {
  const entries: TrashEntry[] = []

  for (const rootSpec of TRASH_ROOTS) {
    const directory = resolveInside(root, rootSpec.directory)
    let children: Dirent[]
    try {
      children = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }

    for (const child of children) {
      if (!child.isDirectory()) continue
      if (rootSpec.kind === 'chapter' && RESERVED_TRASH_DIRECTORIES.has(child.name)) continue
      const folder = path.join(directory, child.name)
      const manifestPath = path.join(folder, 'manifest.json')
      if (!(await pathExists(manifestPath))) continue
      let manifest: RawManifest
      try {
        manifest = await readJson<RawManifest>(manifestPath)
      } catch {
        continue
      }
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) continue
      const entry = readEntry(manifest, folder, rootSpec.kind)
      if (entry) entries.push(entry)
    }
  }

  return entries.sort((left, right) => right.deletedAt.localeCompare(left.deletedAt))
}

function assertTrashId(trashId: string): string {
  const value = String(trashId ?? '').trim()
  if (!value || value === '.' || value === '..' || /[\\/]/.test(value) || value.includes('\0')) {
    throw new DomainError('invalid_trash_id', '回收站条目无效。')
  }
  return value
}

function assertEntryId(value: string, label: string): string {
  if (!value || value === '.' || value === '..' || /[\\/]/.test(value) || value.includes('\0')) {
    throw new DomainError('invalid_trash_entry', `${label}无效，无法恢复。`)
  }
  return value
}

async function removeTrashFolder(folder: string): Promise<void> {
  await fs.rm(folder, { recursive: true, force: true })
}

async function restoreChapter(root: string, entry: TrashEntry): Promise<string> {
  const chapterId = assertEntryId(stringField(entry.manifest, 'chapter_id'), '章节标识')
  const relativePath = `outline/chapters/${chapterId}.md`
  const target = resolveInside(root, relativePath)
  if (await pathExists(target)) {
    throw new DomainError('conflict', `章节 ${chapterId} 已存在，无法恢复。`, 409)
  }

  const source = path.join(entry.folder, 'chapter.md')
  if (!(await pathExists(source))) {
    throw new DomainError('trash_corrupt', '回收站中的章节正文缺失。', 500)
  }
  const chapterText = await readText(source)
  await writeTextAtomic(target, chapterText)

  if (entry.hasSummary) {
    const summaryPath = path.join(entry.folder, 'summary.json')
    if (await pathExists(summaryPath)) {
      try {
        const summary = await readJson<unknown>(summaryPath)
        const summariesPath = resolveInside(root, 'memory/chapter_summaries.json')
        let summaries: Record<string, unknown> = {}
        if (await pathExists(summariesPath)) {
          summaries = await readJson<Record<string, unknown>>(summariesPath)
        }
        summaries[chapterId] = summary
        await writeJsonAtomic(summariesPath, summaries)
      } catch (error) {
        await fs.rm(target, { force: true })
        throw error
      }
    }
  }

  await removeTrashFolder(entry.folder)
  return toPosix(relativePath)
}

async function restoreCharacter(root: string, entry: TrashEntry): Promise<string> {
  const characterId = assertEntryId(stringField(entry.manifest, 'character_id'), '角色标识')
  const relativePath = `canon/characters/${characterId}.md`
  const target = resolveInside(root, relativePath)
  if (await pathExists(target)) {
    throw new DomainError('conflict', `角色 ${characterId} 已存在，无法恢复。`, 409)
  }
  const source = path.join(entry.folder, 'character.md')
  if (!(await pathExists(source))) {
    throw new DomainError('trash_corrupt', '回收站中的角色卡缺失。', 500)
  }
  await writeTextAtomic(target, await readText(source))
  await removeTrashFolder(entry.folder)
  return toPosix(relativePath)
}

async function restoreCanon(root: string, entry: TrashEntry): Promise<string> {
  const originalPath = normalizeRelative(entry.originalPath)
  if (!originalPath.startsWith('canon/')) {
    throw new DomainError('invalid_trash_entry', '该资料不在 canon 目录内，拒绝恢复。')
  }
  const target = resolveInside(root, originalPath)
  if (await pathExists(target)) {
    throw new DomainError('conflict', `资料文件已存在，无法恢复：${originalPath}`, 409)
  }
  const source = path.join(entry.folder, 'document.md')
  if (!(await pathExists(source))) {
    throw new DomainError('trash_corrupt', '回收站中的资料文档缺失。', 500)
  }
  await writeTextAtomic(target, await readText(source))
  await removeTrashFolder(entry.folder)
  return originalPath
}

export async function restoreTrash(root: string, trashId: string): Promise<{ restoredPath: string }> {
  const id = assertTrashId(trashId)
  const entries = await listTrash(root)
  const entry = entries.find((item) => item.trashId === id)
  if (!entry) {
    throw new DomainError('trash_not_found', `找不到回收站条目：${id}`, 404)
  }

  let restoredPath: string
  if (entry.kind === 'chapter') {
    restoredPath = await restoreChapter(root, entry)
  } else if (entry.kind === 'character') {
    restoredPath = await restoreCharacter(root, entry)
  } else {
    restoredPath = await restoreCanon(root, entry)
  }
  return { restoredPath }
}
