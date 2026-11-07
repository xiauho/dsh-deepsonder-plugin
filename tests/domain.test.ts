import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { listCanon, readCanonDoc, saveCanonDoc } from '../src/domain/canon.js'
import { readChapter, saveChapter } from '../src/domain/chapter.js'
import { openProject } from '../src/domain/project.js'
import { listTrash, restoreTrash } from '../src/domain/trash.js'

const fixturesRoot = path.resolve(process.cwd(), 'tests', 'fixtures')
const demoSource = path.join(fixturesRoot, 'demo_novel')
const project2Source = path.join(fixturesRoot, 'timeline-project')

let tempRoot = ''
let demo = ''
let project2 = ''

async function copyProject(source: string, name: string): Promise<string> {
  const target = path.join(tempRoot, name)
  await fs.cp(source, target, { recursive: true })
  return target
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deepsonder-plugin-test-'))
  demo = await copyProject(demoSource, 'demo_novel')
  project2 = await copyProject(project2Source, 'project-2')
})

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true })
})

describe('project and canon', () => {
  it('opens a real project and lists chapters, canon and trash', async () => {
    const summary = await openProject(demo)

    expect(summary.name).toBe('示例小说：青云之上')
    expect(summary.chapters.map((chapter) => chapter.id)).toContain('chapter_02')
    expect(summary.canon.some((entry) => entry.kind === 'character')).toBe(true)
    expect(summary.canon.some((entry) => entry.kind === 'world')).toBe(true)
    expect(summary.canon.some((entry) => entry.kind === 'power')).toBe(true)
    expect(summary.trash.some((entry) => entry.trashId === '20260917T110547_chapter_01_84fca649')).toBe(true)
  })

  it('rejects a directory without project.json', async () => {
    await expect(openProject(path.join(tempRoot, 'missing'))).rejects.toThrow(/project\.json/)
  })

  it('rejects path traversal outside the project', async () => {
    await expect(readCanonDoc(demo, '../project.json')).rejects.toThrow(/canon/)
    await expect(readChapter(demo, '../project')).rejects.toThrow(/章节标识无效/)
  })

  it('round-trips markdown canon without changing bytes', async () => {
    const relativePath = 'canon/characters/林夜.md'
    const doc = await readCanonDoc(demo, relativePath)
    await saveCanonDoc(demo, relativePath, doc.raw, doc.sha256)
    const after = await readCanonDoc(demo, relativePath)
    expect(after.raw).toBe(doc.raw)
    expect(after.sha256).toBe(doc.sha256)
  })

  it('round-trips timeline JSON and keeps unknown fields', async () => {
    const relativePath = 'canon/timeline_events.json'
    const doc = await readCanonDoc(project2, relativePath)
    const parsed = JSON.parse(doc.raw) as Record<string, unknown>
    parsed.__unknown = { kept: true, count: 2 }
    const raw = `${JSON.stringify(parsed, null, 2)}\n`

    await saveCanonDoc(project2, relativePath, raw, doc.sha256)
    const after = await readCanonDoc(project2, relativePath)
    const reparsed = JSON.parse(after.raw) as Record<string, unknown>

    expect(reparsed.__unknown).toEqual({ kept: true, count: 2 })
    expect(reparsed.events).toEqual(parsed.events)
  })

  it('lists timeline and story plan entries when present', async () => {
    const entries = await listCanon(project2)
    expect(entries.some((entry) => entry.path === 'canon/timeline_events.json')).toBe(true)
    expect(entries.some((entry) => entry.path === 'outline/story_plan.json')).toBe(true)
  })
})

describe('chapter editing', () => {
  it('parses title, outline, plot and prose from the chapter markdown', async () => {
    const chapter = await readChapter(demo, 'chapter_02')

    expect(chapter.sections.title).toBe('第一章 后山惊变')
    expect(chapter.sections.plot).toContain('林夜从后山醒来')
    expect(chapter.sections.prose).toContain('林夜是被冷醒的。')
  })

  it('saves unchanged chapter text byte-for-byte', async () => {
    const chapter = await readChapter(demo, 'chapter_02')
    await saveChapter(demo, 'chapter_02', chapter.raw, chapter.sha256)

    const filePath = path.join(demo, 'outline', 'chapters', 'chapter_02.md')
    const after = await fs.readFile(filePath, 'utf8')
    expect(after).toBe(chapter.raw)
  })

  it('saves an edited paragraph and reports a new hash', async () => {
    const chapter = await readChapter(demo, 'chapter_02')
    const edited = chapter.raw.replace('林夜是被冷醒的。', '林夜是被冻醒的。')
    expect(edited).not.toBe(chapter.raw)

    const result = await saveChapter(demo, 'chapter_02', edited, chapter.sha256)
    const after = await readChapter(demo, 'chapter_02')

    expect(result.sha256).toBe(after.sha256)
    expect(after.raw).toBe(edited)
    expect(after.sections.prose).toContain('林夜是被冻醒的。')
  })

  it('refuses to overwrite an externally modified chapter', async () => {
    const chapter = await readChapter(demo, 'chapter_02')
    await saveChapter(demo, 'chapter_02', `${chapter.raw}\n`, chapter.sha256)

    await expect(
      saveChapter(demo, 'chapter_02', chapter.raw, chapter.sha256),
    ).rejects.toThrow(/已被其他程序修改/)
  })
})

describe('recycle bin', () => {
  it('lists chapter, character and canon trash entries', async () => {
    const entries = await listTrash(demo)
    const chapterEntry = entries.find((entry) => entry.trashId === '20260917T110547_chapter_01_84fca649')

    expect(chapterEntry?.kind).toBe('chapter')
    expect(chapterEntry?.hasSummary).toBe(true)
    expect(entries.every((entry) => entry.originalPath.length > 0)).toBe(true)
  })

  it('restores a chapter and its summary', async () => {
    const entries = await listTrash(demo)
    const entry = entries.find((item) => item.trashId === '20260917T110547_chapter_01_84fca649')
    expect(entry).toBeTruthy()
    if (!entry) return

    const result = await restoreTrash(demo, entry.trashId)
    expect(result.restoredPath).toBe('outline/chapters/chapter_01.md')

    const restored = await readChapter(demo, 'chapter_01')
    expect(restored.title.length).toBeGreaterThan(0)

    const summaries = JSON.parse(
      await fs.readFile(path.join(demo, 'memory', 'chapter_summaries.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(summaries.chapter_01).toBeTruthy()

    const trashAfter = await listTrash(demo)
    expect(trashAfter.some((item) => item.trashId === entry.trashId)).toBe(false)
  })

  it('refuses to restore when the target already exists', async () => {
    const chapterPath = path.join(demo, 'outline', 'chapters', 'chapter_01.md')
    await fs.writeFile(chapterPath, '# 已存在\n', 'utf8')

    await expect(restoreTrash(demo, '20260917T110547_chapter_01_84fca649')).rejects.toThrow(
      /已存在/,
    )
  })
})
