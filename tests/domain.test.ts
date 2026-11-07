import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { listCanon, readCanonDoc, saveCanonDoc } from '../src/domain/canon.js'
import {
  createChapter,
  readChapter,
  renameChapterTitle,
  reorderChapters,
  saveChapter,
} from '../src/domain/chapter.js'
import { NodeFileSystem } from '../src/domain/node-fs.js'
import { openProject } from '../src/domain/project.js'
import type { ProjectStore } from '../src/domain/project-store.js'
import { listTrash, moveChapterToTrash, restoreTrash } from '../src/domain/trash.js'

const fixturesRoot = path.resolve(process.cwd(), 'tests', 'fixtures')
const demoSource = path.join(fixturesRoot, 'demo_novel')
const project2Source = path.join(fixturesRoot, 'timeline-project')
const fileSystem = new NodeFileSystem()

let tempRoot = ''
let demo = ''
let project2 = ''
let demoStore: ProjectStore
let project2Store: ProjectStore

async function copyProject(source: string, name: string): Promise<string> {
  const target = path.join(tempRoot, name)
  await fs.cp(source, target, { recursive: true })
  return target
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deepsonder-plugin-test-'))
  demo = await copyProject(demoSource, 'demo_novel')
  project2 = await copyProject(project2Source, 'timeline-project')
  demoStore = (await openProject(fileSystem, demo)).store
  project2Store = (await openProject(fileSystem, project2)).store
})

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true })
})

describe('project and canon', () => {
  it('opens a real project and lists chapters, canon and trash', async () => {
    const { summary } = await openProject(fileSystem, demo)

    expect(summary.name).toBe('示例小说：青云之上')
    expect(summary.chapters.map((chapter) => chapter.id)).toContain('chapter_02')
    expect(summary.canon.some((entry) => entry.kind === 'character')).toBe(true)
    expect(summary.canon.some((entry) => entry.kind === 'world')).toBe(true)
    expect(summary.canon.some((entry) => entry.kind === 'power')).toBe(true)
    expect(summary.trash.some((entry) => entry.trashId === '20260917T110547_chapter_01_84fca649')).toBe(true)
  })

  it('rejects a directory without project.json', async () => {
    await expect(openProject(fileSystem, path.join(tempRoot, 'missing'))).rejects.toThrow(
      /项目目录不存在/,
    )
  })

  it('rejects path traversal outside the project', async () => {
    await expect(readCanonDoc(demoStore, '../project.json')).rejects.toThrow(/canon/)
    await expect(readChapter(demoStore, '../project')).rejects.toThrow(/章节标识无效/)
  })

  it('round-trips markdown canon without changing bytes', async () => {
    const relativePath = 'canon/characters/林夜.md'
    const doc = await readCanonDoc(demoStore, relativePath)
    await saveCanonDoc(demoStore, relativePath, doc.raw, doc.version)
    const after = await readCanonDoc(demoStore, relativePath)
    expect(after.raw).toBe(doc.raw)
    expect(after.sha256).toBe(doc.sha256)
  })

  it('round-trips timeline JSON and keeps unknown fields', async () => {
    const relativePath = 'canon/timeline_events.json'
    const doc = await readCanonDoc(project2Store, relativePath)
    const parsed = JSON.parse(doc.raw) as Record<string, unknown>
    parsed.__unknown = { kept: true, count: 2 }
    const raw = `${JSON.stringify(parsed, null, 2)}\n`

    await saveCanonDoc(project2Store, relativePath, raw, doc.version)
    const after = await readCanonDoc(project2Store, relativePath)
    const reparsed = JSON.parse(after.raw) as Record<string, unknown>

    expect(reparsed.__unknown).toEqual({ kept: true, count: 2 })
    expect(reparsed.events).toEqual(parsed.events)
  })

  it('lists timeline and story plan entries when present', async () => {
    const entries = await listCanon(project2Store)
    expect(entries.some((entry) => entry.path === 'canon/timeline_events.json')).toBe(true)
    expect(entries.some((entry) => entry.path === 'outline/story_plan.json')).toBe(true)
  })
})

describe('chapter editing', () => {
  it('parses title, outline, plot and prose from the chapter markdown', async () => {
    const chapter = await readChapter(demoStore, 'chapter_02')

    expect(chapter.sections.title).toBe('第一章 后山惊变')
    expect(chapter.sections.plot).toContain('林夜从后山醒来')
    expect(chapter.sections.prose).toContain('林夜是被冷醒的。')
  })

  it('saves unchanged chapter text byte-for-byte', async () => {
    const chapter = await readChapter(demoStore, 'chapter_02')
    await saveChapter(demoStore, 'chapter_02', chapter.raw, chapter.version)

    const filePath = path.join(demo, 'outline', 'chapters', 'chapter_02.md')
    const after = await fs.readFile(filePath, 'utf8')
    expect(after).toBe(chapter.raw)
  })

  it('saves an edited paragraph and reports a new hash', async () => {
    const chapter = await readChapter(demoStore, 'chapter_02')
    const edited = chapter.raw.replace('林夜是被冷醒的。', '林夜是被冻醒的。')
    expect(edited).not.toBe(chapter.raw)

    const result = await saveChapter(demoStore, 'chapter_02', edited, chapter.version)
    const after = await readChapter(demoStore, 'chapter_02')

    expect(result.sha256).toBe(after.sha256)
    expect(after.raw).toBe(edited)
    expect(after.sections.prose).toContain('林夜是被冻醒的。')
  })

  it('refuses to overwrite an externally modified chapter', async () => {
    const chapter = await readChapter(demoStore, 'chapter_02')
    await saveChapter(demoStore, 'chapter_02', `${chapter.raw}\n`, chapter.version)

    await expect(
      saveChapter(demoStore, 'chapter_02', chapter.raw, chapter.version),
    ).rejects.toThrow(/已被其他程序修改/)
  })

  it('creates a chapter with the next available canonical id', async () => {
    const created = await createChapter(demoStore, '第二章 新章')
    expect(created.id).toBe('chapter_03')
    expect(created.sections.title).toBe('第二章 新章')
    expect(created.raw).toContain('## 大纲')
    expect(created.raw).toContain('## 正文')
  })

  it('rejects a duplicate explicit chapter id', async () => {
    await expect(createChapter(demoStore, '重复章节', 'chapter_02')).rejects.toThrow(/已存在/)
  })

  it('renames the chapter title without changing the body', async () => {
    const chapter = await readChapter(demoStore, 'chapter_02')
    const renamed = await renameChapterTitle(
      demoStore,
      'chapter_02',
      '第一章 新标题',
      chapter.version,
    )

    expect(renamed.sections.title).toBe('第一章 新标题')
    expect(renamed.sections.prose).toBe(chapter.sections.prose)
    expect(renamed.sections.plot).toBe(chapter.sections.plot)
  })

  it('reorders canonical chapters and remaps summaries', async () => {
    const created = await createChapter(demoStore, '第二章 新章')
    expect(created.id).toBe('chapter_03')

    const reordered = await reorderChapters(demoStore, ['chapter_02', 'chapter_03'])
    expect(reordered.map((chapter) => chapter.id)).toEqual(['chapter_01', 'chapter_02'])
    expect(reordered[0]?.title).toBe('第一章 后山惊变')
    expect(reordered[1]?.title).toBe('第二章 新章')

    const summaries = JSON.parse(
      await fs.readFile(path.join(demo, 'memory', 'chapter_summaries.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(summaries.chapter_01).toBeTruthy()
    expect(summaries.chapter_02).toBeUndefined()
  })
})

describe('recycle bin', () => {
  it('lists chapter, character and canon trash entries', async () => {
    const entries = await listTrash(demoStore)
    const chapterEntry = entries.find((entry) => entry.trashId === '20260917T110547_chapter_01_84fca649')

    expect(chapterEntry?.kind).toBe('chapter')
    expect(chapterEntry?.hasSummary).toBe(true)
    expect(entries.every((entry) => entry.originalPath.length > 0)).toBe(true)
  })

  it('moves a chapter to trash and removes its summary', async () => {
    const entry = await moveChapterToTrash(demoStore, 'chapter_02')
    expect(entry.kind).toBe('chapter')
    expect(entry.hasSummary).toBe(true)

    expect(await demoStore.exists('outline/chapters/chapter_02.md')).toBe(false)
    const summaries = JSON.parse(
      await fs.readFile(path.join(demo, 'memory', 'chapter_summaries.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(summaries.chapter_02).toBeUndefined()

    const trash = await listTrash(demoStore)
    expect(trash.some((item) => item.trashId === entry.trashId)).toBe(true)
  })

  it('restores a chapter and its summary', async () => {
    const entries = await listTrash(demoStore)
    const entry = entries.find((item) => item.trashId === '20260917T110547_chapter_01_84fca649')
    expect(entry).toBeTruthy()
    if (!entry) return

    const result = await restoreTrash(demoStore, entry.trashId)
    expect(result.restoredPath).toBe('outline/chapters/chapter_01.md')

    const restored = await readChapter(demoStore, 'chapter_01')
    expect(restored.title.length).toBeGreaterThan(0)

    const summaries = JSON.parse(
      await fs.readFile(path.join(demo, 'memory', 'chapter_summaries.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(summaries.chapter_01).toBeTruthy()

    const trashAfter = await listTrash(demoStore)
    expect(trashAfter.some((item) => item.trashId === entry.trashId)).toBe(false)
  })

  it('refuses to restore when the target already exists', async () => {
    const chapterPath = path.join(demo, 'outline', 'chapters', 'chapter_01.md')
    await fs.writeFile(chapterPath, '# 已存在\n', 'utf8')

    await expect(restoreTrash(demoStore, '20260917T110547_chapter_01_84fca649')).rejects.toThrow(
      /已存在/,
    )
  })
})
