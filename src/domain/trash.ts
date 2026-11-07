import { randomUUID } from 'node:crypto'

import { DomainError } from './errors.js'
import { ProjectStore } from './project-store.js'
import { readChapter } from './chapter.js'

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
const CHAPTER_SUMMARIES_PATH = 'memory/chapter_summaries.json'

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
  if (!trashId || folder.split('/').at(-1) !== trashId || !originalPath || !deletedAt) {
    return null
  }
  return {
    trashId,
    kind,
    title: stringField(manifest, 'title') || originalPath.split('/').at(-1)?.replace(/\.md$/i, '') || trashId,
    originalPath: normalizeRelative(originalPath),
    deletedAt,
    hasSummary: manifest.has_summary === true,
    folder,
    manifest,
  }
}

async function safeListDir(store: ProjectStore, directory: string) {
  try {
    return await store.listDir(directory)
  } catch {
    return []
  }
}

export async function listTrash(store: ProjectStore): Promise<TrashEntry[]> {
  const entries: TrashEntry[] = []

  for (const rootSpec of TRASH_ROOTS) {
    const children = await safeListDir(store, rootSpec.directory)
    for (const child of children) {
      if (child.type !== 'directory') continue
      if (rootSpec.kind === 'chapter' && RESERVED_TRASH_DIRECTORIES.has(child.name)) continue
      const manifestPath = `${child.relativePath}/manifest.json`
      if (!(await store.exists(manifestPath))) continue
      try {
        const current = await store.readText(manifestPath)
        const manifest = JSON.parse(current.raw) as RawManifest
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) continue
        const entry = readEntry(manifest, child.relativePath, rootSpec.kind)
        if (entry) entries.push(entry)
      } catch {
        // 单个损坏条目不影响其余回收站内容。
      }
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

async function readJsonValueOptional(
  store: ProjectStore,
  relativePath: string,
): Promise<{ value: unknown; version?: string }> {
  if (!(await store.exists(relativePath))) return { value: null }
  const current = await store.readText(relativePath)
  try {
    return { value: JSON.parse(current.raw) as unknown, version: current.version }
  } catch {
    throw new DomainError('invalid_json', `无法解析 JSON 文件：${relativePath}`, 500)
  }
}

async function readJsonOptional(
  store: ProjectStore,
  relativePath: string,
): Promise<{ data: Record<string, unknown>; version?: string }> {
  const current = await readJsonValueOptional(store, relativePath)
  return {
    data:
      current.value && typeof current.value === 'object' && !Array.isArray(current.value)
        ? (current.value as Record<string, unknown>)
        : {},
    version: current.version,
  }
}

async function writeJsonOptional(
  store: ProjectStore,
  relativePath: string,
  data: unknown,
  version?: string,
): Promise<void> {
  const content = `${JSON.stringify(data, null, 2)}\n`
  if (version) {
    await store.writeText(relativePath, content, version, { backup: false })
  } else {
    await store.createText(relativePath, content)
  }
}

async function removeTrashEntryFiles(store: ProjectStore, folder: string): Promise<void> {
  const entries = await safeListDir(store, folder)
  const manifest = entries.find((entry) => entry.name === 'manifest.json')
  if (manifest) {
    try {
      await store.deleteFile(manifest.relativePath)
    } catch {
      // 清单删除失败时保留其余文件，避免出现半删除状态。
      return
    }
  }
  for (const entry of entries) {
    if (entry.type !== 'file' || entry.name === 'manifest.json') continue
    try {
      await store.deleteFile(entry.relativePath)
    } catch {
      // 单个文件删除失败不阻塞其他清理。
    }
  }
}

async function restoreChapter(store: ProjectStore, entry: TrashEntry): Promise<string> {
  const chapterId = assertEntryId(stringField(entry.manifest, 'chapter_id'), '章节标识')
  const relativePath = `outline/chapters/${chapterId}.md`
  if (await store.exists(relativePath)) {
    throw new DomainError('conflict', `章节 ${chapterId} 已存在，无法恢复。`, 409)
  }
  const source = await store.readText(`${entry.folder}/chapter.md`)
  await store.createText(relativePath, source.raw)

  try {
    if (entry.hasSummary && (await store.exists(`${entry.folder}/summary.json`))) {
      const summary = await readJsonValueOptional(store, `${entry.folder}/summary.json`)
      const summaries = await readJsonOptional(store, CHAPTER_SUMMARIES_PATH)
      summaries.data[chapterId] = summary.value
      await writeJsonOptional(store, CHAPTER_SUMMARIES_PATH, summaries.data, summaries.version)
    }
  } catch (error) {
    await store.deleteFile(relativePath).catch(() => undefined)
    throw error
  }

  await removeTrashEntryFiles(store, entry.folder)
  return relativePath
}

async function restoreCharacter(store: ProjectStore, entry: TrashEntry): Promise<string> {
  const characterId = assertEntryId(stringField(entry.manifest, 'character_id'), '角色标识')
  const relativePath = `canon/characters/${characterId}.md`
  if (await store.exists(relativePath)) {
    throw new DomainError('conflict', `角色 ${characterId} 已存在，无法恢复。`, 409)
  }
  const source = await store.readText(`${entry.folder}/character.md`)
  await store.createText(relativePath, source.raw)
  await removeTrashEntryFiles(store, entry.folder)
  return relativePath
}

async function restoreCanon(store: ProjectStore, entry: TrashEntry): Promise<string> {
  const originalPath = normalizeRelative(entry.originalPath)
  if (!originalPath.startsWith('canon/')) {
    throw new DomainError('invalid_trash_entry', '该资料不在 canon 目录内，拒绝恢复。')
  }
  if (await store.exists(originalPath)) {
    throw new DomainError('conflict', `资料文件已存在，无法恢复：${originalPath}`, 409)
  }
  const source = await store.readText(`${entry.folder}/document.md`)
  await store.createText(originalPath, source.raw)
  await removeTrashEntryFiles(store, entry.folder)
  return originalPath
}

export async function restoreTrash(
  store: ProjectStore,
  trashId: string,
): Promise<{ restoredPath: string }> {
  const id = assertTrashId(trashId)
  const entries = await listTrash(store)
  const entry = entries.find((item) => item.trashId === id)
  if (!entry) {
    throw new DomainError('trash_not_found', `找不到回收站条目：${id}`, 404)
  }

  let restoredPath: string
  if (entry.kind === 'chapter') {
    restoredPath = await restoreChapter(store, entry)
  } else if (entry.kind === 'character') {
    restoredPath = await restoreCharacter(store, entry)
  } else {
    restoredPath = await restoreCanon(store, entry)
  }
  return { restoredPath }
}

function trashStamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '')
}

export async function moveChapterToTrash(
  store: ProjectStore,
  chapterId: string,
): Promise<TrashEntry> {
  const chapter = await readChapter(store, chapterId)
  const summaries = await readJsonOptional(store, CHAPTER_SUMMARIES_PATH)
  const hadSummary = Object.prototype.hasOwnProperty.call(summaries.data, chapter.id)
  const summaryValue = hadSummary ? summaries.data[chapter.id] : null

  const trashId = `${trashStamp()}_${chapter.id}_${randomUUID().slice(0, 8)}`
  const folder = `.novalist/trash/${trashId}`
  const deletedAt = new Date().toISOString()
  const manifest = {
    trash_id: trashId,
    chapter_id: chapter.id,
    title: chapter.title,
    original_path: chapter.path,
    deleted_at: deletedAt,
    has_summary: hadSummary,
  }

  await store.writeText(`${folder}/chapter.md`, chapter.raw, undefined, { backup: false })
  await store.writeText(
    `${folder}/summary.json`,
    `${JSON.stringify(summaryValue, null, 2)}\n`,
    undefined,
    { backup: false },
  )
  await store.writeText(
    `${folder}/manifest.json`,
    `${JSON.stringify(manifest, null, 2)}\n`,
    undefined,
    { backup: false },
  )

  try {
    if (hadSummary) {
      const next = { ...summaries.data }
      delete next[chapter.id]
      await writeJsonOptional(store, CHAPTER_SUMMARIES_PATH, next, summaries.version)
    }
    await store.deleteFile(chapter.path, chapter.version)
  } catch (error) {
    await store.writeText(chapter.path, chapter.raw, undefined, { backup: false }).catch(() => undefined)
    await writeJsonOptional(store, CHAPTER_SUMMARIES_PATH, summaries.data, summaries.version).catch(
      () => undefined,
    )
    throw error
  }

  return {
    trashId,
    kind: 'chapter',
    title: chapter.title,
    originalPath: chapter.path,
    deletedAt,
    hasSummary: hadSummary,
    folder,
    manifest,
  }
}
