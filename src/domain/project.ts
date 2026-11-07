import { listCanon, type CanonEntry } from './canon.js'
import { listChapters, type ChapterSummary } from './chapter.js'
import { DomainError } from './errors.js'
import type { FileSystemPort } from './fs-port.js'
import { ProjectStore } from './project-store.js'
import { listTrash, type TrashEntry } from './trash.js'

export interface ProjectMeta {
  id?: string
  name?: string
  author?: string
  created_at?: string
  updated_at?: string
}

export interface ProjectSummary {
  root: string
  name: string
  author: string
  chapters: ChapterSummary[]
  canon: CanonEntry[]
  trash: TrashEntry[]
}

export interface OpenedProject {
  store: ProjectStore
  summary: ProjectSummary
}

async function readMeta(store: ProjectStore): Promise<ProjectMeta> {
  if (!(await store.exists('project.json'))) {
    throw new DomainError(
      'not_project',
      '该目录不是 DeepSonder 项目：缺少 project.json。',
      404,
    )
  }
  const current = await store.readText('project.json')
  let meta: ProjectMeta
  try {
    meta = JSON.parse(current.raw) as ProjectMeta
  } catch {
    throw new DomainError('invalid_project', 'project.json 无法解析。')
  }
  const name = typeof meta.name === 'string' ? meta.name.trim() : ''
  if (!name) {
    throw new DomainError('invalid_project', 'project.json 缺少项目名称。')
  }
  return meta
}

export async function openProject(
  fs: FileSystemPort,
  rootInput: string,
): Promise<OpenedProject> {
  const rawRoot = String(rootInput ?? '').trim()
  if (!rawRoot) {
    throw new DomainError('invalid_root', '请填写项目目录。')
  }
  const store = await ProjectStore.open(fs, rawRoot)
  const meta = await readMeta(store)
  const [chapters, canon, trash] = await Promise.all([
    listChapters(store),
    listCanon(store),
    listTrash(store),
  ])

  return {
    store,
    summary: {
      root: store.root.displayPath,
      name: (meta.name ?? '').trim(),
      author: typeof meta.author === 'string' ? meta.author : '',
      chapters,
      canon,
      trash,
    },
  }
}

export async function refreshProject(store: ProjectStore): Promise<ProjectSummary> {
  const meta = await readMeta(store)
  const [chapters, canon, trash] = await Promise.all([
    listChapters(store),
    listCanon(store),
    listTrash(store),
  ])
  return {
    root: store.root.displayPath,
    name: (meta.name ?? '').trim(),
    author: typeof meta.author === 'string' ? meta.author : '',
    chapters,
    canon,
    trash,
  }
}
