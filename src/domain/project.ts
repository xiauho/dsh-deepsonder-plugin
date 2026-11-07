import path from 'node:path'

import { listCanon, type CanonEntry } from './canon.js'
import { listChapters, type ChapterSummary } from './chapter.js'
import { DomainError } from './errors.js'
import { pathExists, readJson, resolveInside } from './paths.js'
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

export async function openProject(rootInput: string): Promise<ProjectSummary> {
  const rawRoot = String(rootInput ?? '').trim()
  if (!rawRoot) {
    throw new DomainError('invalid_root', '请填写项目目录。')
  }
  const root = path.resolve(rawRoot)
  const metaPath = resolveInside(root, 'project.json')
  if (!(await pathExists(metaPath))) {
    throw new DomainError(
      'not_project',
      '该目录不是 DeepSonder 项目：缺少 project.json。',
      404,
    )
  }

  let meta: ProjectMeta
  try {
    meta = await readJson<ProjectMeta>(metaPath)
  } catch {
    throw new DomainError('invalid_project', 'project.json 无法解析。')
  }
  const name = typeof meta.name === 'string' ? meta.name.trim() : ''
  if (!name) {
    throw new DomainError('invalid_project', 'project.json 缺少项目名称。')
  }

  const [chapters, canon, trash] = await Promise.all([
    listChapters(root),
    listCanon(root),
    listTrash(root),
  ])

  return {
    root,
    name,
    author: typeof meta.author === 'string' ? meta.author : '',
    chapters,
    canon,
    trash,
  }
}
