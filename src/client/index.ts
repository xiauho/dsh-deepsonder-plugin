import type { CSSProperties } from 'react'

import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

type RequireFn = (id: string) => any

interface ChapterSummary {
  id: string
  title: string
  path: string
  order: number
}

interface ChapterDoc extends ChapterSummary {
  raw: string
  sha256: string
  sections: {
    title: string
    outline: string
    plot: string
    prose: string
  }
}

interface CanonEntry {
  id: string
  kind: 'character' | 'world' | 'power' | 'timeline' | 'plan' | 'doc'
  title: string
  path: string
  format: 'markdown' | 'json'
}

interface CanonDoc extends CanonEntry {
  raw: string
  sha256: string
}

interface TrashEntry {
  trashId: string
  kind: 'chapter' | 'character' | 'canon'
  title: string
  originalPath: string
  deletedAt: string
  hasSummary: boolean
}

interface ProjectSummary {
  root: string
  name: string
  author: string
  chapters: ChapterSummary[]
  canon: CanonEntry[]
  trash: TrashEntry[]
}

const KIND_LABELS: Record<string, string> = {
  character: '角色',
  world: '世界观',
  power: '力量体系',
  timeline: '时间线',
  plan: '故事规划',
  doc: '资料',
  chapter: '章节',
  canon: '资料',
}

const STYLES: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    boxSizing: 'border-box',
    gap: '10px',
    padding: '12px',
    color: 'var(--dsw-alias-label-primary, #c9d1d9)',
    fontFamily: 'var(--dsw-font-family-sans, system-ui, sans-serif)',
    background: 'transparent',
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px',
  },
  input: {
    flex: '1 1 320px',
    minWidth: '220px',
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid var(--dsw-alias-border-l1, #30363d)',
    background: 'var(--dsw-alias-bg-layer-1, #0d1117)',
    color: 'inherit',
    fontSize: '13px',
  },
  button: {
    padding: '5px 10px',
    borderRadius: '6px',
    border: '1px solid var(--dsw-alias-border-l1, #30363d)',
    background: 'var(--dsw-alias-bg-layer-1, #0d1117)',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '13px',
  },
  primary: {
    padding: '5px 10px',
    borderRadius: '6px',
    border: '1px solid var(--dsw-alias-button-primary-fill, #2f81f7)',
    background: 'var(--dsw-alias-button-primary-fill, #2f81f7)',
    color: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
    cursor: 'pointer',
    fontSize: '13px',
  },
  body: {
    display: 'flex',
    flex: '1 1 auto',
    minHeight: 0,
    gap: '10px',
  },
  side: {
    width: '260px',
    flex: 'none',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    paddingRight: '10px',
    borderRight: '1px solid var(--dsw-alias-border-l1, #30363d)',
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    marginBottom: '8px',
  },
  tab: {
    flex: 1,
    padding: '4px 6px',
    borderRadius: '6px',
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary, #8b949e)',
    cursor: 'pointer',
    fontSize: '12px',
  },
  tabActive: {
    flex: 1,
    padding: '4px 6px',
    borderRadius: '6px',
    border: '1px solid var(--dsw-alias-border-l1, #30363d)',
    background: 'var(--dsw-alias-bg-layer-1, #0d1117)',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '12px',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    minHeight: 0,
    gap: '2px',
    overflow: 'auto',
  },
  item: {
    textAlign: 'left',
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid transparent',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '13px',
  },
  itemActive: {
    textAlign: 'left',
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid var(--dsw-alias-border-l1, #30363d)',
    background: 'var(--dsw-alias-bg-layer-1, #0d1117)',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '13px',
  },
  meta: {
    fontSize: '11px',
    lineHeight: '1.5',
    color: 'var(--dsw-alias-label-secondary, #8b949e)',
    overflowWrap: 'anywhere',
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    minWidth: 0,
    minHeight: 0,
    gap: '8px',
  },
  editor: {
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'hidden',
    border: '1px solid var(--dsw-alias-border-l1, #30363d)',
    borderRadius: '8px',
  },
  textarea: {
    flex: '1 1 auto',
    minHeight: 0,
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px',
    borderRadius: '8px',
    border: '1px solid var(--dsw-alias-border-l1, #30363d)',
    background: 'var(--dsw-alias-bg-layer-1, #0d1117)',
    color: 'inherit',
    fontSize: '13px',
    lineHeight: '1.6',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    resize: 'none',
  },
  hint: {
    fontSize: '12px',
    lineHeight: '1.6',
    color: 'var(--dsw-alias-label-secondary, #8b949e)',
  },
  error: {
    fontSize: '12px',
    color: 'var(--dsw-alias-state-error-primary, #f85149)',
  },
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const text = await response.text()
  let payload: any = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  if (!response.ok) {
    throw new Error(payload?.error ?? `请求失败（${response.status}）`)
  }
  return payload as T
}

function editorTheme() {
  return EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
      color: 'var(--dsw-alias-label-primary, #c9d1d9)',
      fontSize: '14px',
    },
    '.cm-content': {
      padding: '12px 0',
      fontFamily: 'ui-serif, "Songti SC", "SimSun", serif',
      caretColor: 'var(--dsw-alias-label-primary, #c9d1d9)',
    },
    '.cm-line': { padding: '0 12px' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'var(--dsw-alias-label-secondary, #8b949e)',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.08))',
    },
    '.cm-scroller': { overflow: 'auto' },
  })
}

function buildEditorState(doc: string, onChange: (value: string) => void): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      EditorView.lineWrapping,
      editorTheme(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString())
      }),
    ],
  })
}

export default function createPlugin(requireFn: RequireFn) {
  const React: typeof import('react') = requireFn('react')
  const h: any = React.createElement

  function PanelIcon(props: { size?: number; active?: boolean }) {
    const size = props.size ?? 18
    return h(
      'div',
      {
        title: 'DeepSonder',
        style: {
          width: `${size}px`,
          height: `${size}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '4px',
          fontSize: `${Math.max(9, Math.round(size * 0.45))}px`,
          fontWeight: 700,
          lineHeight: 1,
          border: `1px solid ${
            props.active
              ? 'var(--dsw-alias-button-primary-fill, #2f81f7)'
              : 'var(--dsw-alias-border-l1, #30363d)'
          }`,
          color: props.active
            ? 'var(--dsw-alias-button-primary-fill, #2f81f7)'
            : 'inherit',
        },
      },
      'DS',
    )
  }

  function Workbench() {
    const [root, setRoot] = React.useState<string>(() => {
      try {
        return window.localStorage.getItem('deepsonder.root') ?? ''
      } catch {
        return ''
      }
    })
    const [summary, setSummary] = React.useState<ProjectSummary | null>(null)
    const [tab, setTab] = React.useState<'chapters' | 'canon' | 'trash'>('chapters')
    const [chapterId, setChapterId] = React.useState('')
    const [chapter, setChapter] = React.useState<ChapterDoc | null>(null)
    const [editorKey, setEditorKey] = React.useState(0)
    const [canonPath, setCanonPath] = React.useState('')
    const [canonDoc, setCanonDoc] = React.useState<CanonDoc | null>(null)
    const [canonDraft, setCanonDraft] = React.useState('')
    const [trash, setTrash] = React.useState<TrashEntry[]>([])
    const [status, setStatus] = React.useState('填写项目目录后打开项目')
    const [isError, setIsError] = React.useState(false)
    const [dirty, setDirty] = React.useState(false)
    const [busy, setBusy] = React.useState(false)

    const editorHost = React.useRef<HTMLDivElement | null>(null)
    const editorView = React.useRef<EditorView | null>(null)
    const chapterText = React.useRef('')
    const chapterSha = React.useRef('')

    const activeRoot = summary?.root ?? root

    function report(message: string, error = false) {
      setStatus(message)
      setIsError(error)
    }

    async function refreshProject(projectRoot = activeRoot): Promise<ProjectSummary> {
      const data = await api<ProjectSummary>(
        `/deepsonder/project/summary?root=${encodeURIComponent(projectRoot)}`,
      )
      setSummary(data)
      setTrash(data.trash)
      return data
    }

    async function loadChapter(id: string, projectRoot = activeRoot) {
      const doc = await api<ChapterDoc>(
        `/deepsonder/chapter?root=${encodeURIComponent(projectRoot)}&id=${encodeURIComponent(id)}`,
      )
      chapterText.current = doc.raw
      chapterSha.current = doc.sha256
      setChapter(doc)
      setChapterId(id)
      setEditorKey((value) => value + 1)
      setTab('chapters')
      setDirty(false)
      report(`已载入：${doc.title}`)
    }

    async function openProject() {
      const input = root.trim()
      if (!input) {
        report('请填写项目目录。', true)
        return
      }
      setBusy(true)
      report('正在打开项目…')
      try {
        const data = await api<ProjectSummary>('/deepsonder/project/open', {
          method: 'POST',
          body: JSON.stringify({ root: input }),
        })
        setSummary(data)
        setTrash(data.trash)
        setCanonDoc(null)
        setCanonPath('')
        setCanonDraft('')
        try {
          window.localStorage.setItem('deepsonder.root', data.root)
        } catch {
          // 隐私模式下 localStorage 可能不可用，不影响本次打开。
        }
        if (data.chapters.length > 0) {
          const first = data.chapters[0]
          if (first) await loadChapter(first.id, data.root)
        } else {
          setChapter(null)
          report(`已打开：${data.name}（暂无章节）`)
        }
        report(`已打开：${data.name}`)
      } catch (error) {
        report(errorMessage(error), true)
      } finally {
        setBusy(false)
      }
    }

    async function saveChapter() {
      if (!chapter) return
      setBusy(true)
      try {
        const result = await api<{ sha256: string }>('/deepsonder/chapter/save', {
          method: 'POST',
          body: JSON.stringify({
            root: activeRoot,
            id: chapter.id,
            raw: chapterText.current,
            expectedSha: chapterSha.current,
          }),
        })
        chapterSha.current = result.sha256
        setDirty(false)
        report(`已保存：${chapter.title}`)
        void refreshProject().catch(() => undefined)
      } catch (error) {
        report(errorMessage(error), true)
      } finally {
        setBusy(false)
      }
    }

    async function loadCanon(entry: CanonEntry) {
      setBusy(true)
      try {
        const doc = await api<CanonDoc>(
          `/deepsonder/canon/doc?root=${encodeURIComponent(activeRoot)}&path=${encodeURIComponent(entry.path)}`,
        )
        setCanonDoc(doc)
        setCanonPath(entry.path)
        setCanonDraft(doc.raw)
        setTab('canon')
        report(`已载入资料：${doc.title}`)
      } catch (error) {
        report(errorMessage(error), true)
      } finally {
        setBusy(false)
      }
    }

    async function saveCanon() {
      if (!canonDoc) return
      setBusy(true)
      try {
        const result = await api<{ sha256: string }>('/deepsonder/canon/save', {
          method: 'POST',
          body: JSON.stringify({
            root: activeRoot,
            path: canonDoc.path,
            raw: canonDraft,
            expectedSha: canonDoc.sha256,
          }),
        })
        setCanonDoc({ ...canonDoc, raw: canonDraft, sha256: result.sha256 })
        report(`已保存资料：${canonDoc.title}`)
        void refreshProject().catch(() => undefined)
      } catch (error) {
        report(errorMessage(error), true)
      } finally {
        setBusy(false)
      }
    }

    async function refreshTrash() {
      if (!activeRoot) return
      try {
        const data = await api<{ entries: TrashEntry[] }>(
          `/deepsonder/trash?root=${encodeURIComponent(activeRoot)}`,
        )
        setTrash(data.entries)
      } catch (error) {
        report(errorMessage(error), true)
      }
    }

    async function restoreEntry(entry: TrashEntry) {
      if (!window.confirm(`恢复「${entry.title}」？`)) return
      setBusy(true)
      try {
        const result = await api<{ restoredPath: string }>('/deepsonder/trash/restore', {
          method: 'POST',
          body: JSON.stringify({ root: activeRoot, trashId: entry.trashId }),
        })
        report(`已恢复：${result.restoredPath}`)
        const data = await refreshProject()
        setTrash(data.trash)
      } catch (error) {
        report(errorMessage(error), true)
      } finally {
        setBusy(false)
      }
    }

    function selectTab(next: 'chapters' | 'canon' | 'trash') {
      setTab(next)
      if (next === 'trash') void refreshTrash()
    }

    React.useEffect(() => {
      const host = editorHost.current
      if (!host || !chapter || tab !== 'chapters') return
      const view = new EditorView({
        state: buildEditorState(chapter.raw, (value) => {
          chapterText.current = value
          setDirty(true)
        }),
        parent: host,
      })
      editorView.current = view
      chapterText.current = chapter.raw
      chapterSha.current = chapter.sha256
      return () => {
        view.destroy()
        if (editorView.current === view) editorView.current = null
      }
    }, [chapter?.id, editorKey, tab])

    const projectName = summary?.name ?? '未打开项目'
    const chapters = summary?.chapters ?? []
    const canonEntries = summary?.canon ?? []

    return h(
      'div',
      {
        style: STYLES.root,
        'data-dsh-plugin': 'deepsonder',
        'data-dsh-surface': 'main-panel',
      },
      h(
        'div',
        { style: STYLES.bar },
        h('span', { style: STYLES.meta }, '项目目录'),
        h('input', {
          style: STYLES.input,
          value: root,
          placeholder: '例如 D:\\\\Novels\\\\我的小说',
          onChange: (event: any) => setRoot(event.target.value),
          onKeyDown: (event: any) => {
            if (event.key === 'Enter') void openProject()
          },
          spellCheck: false,
        }),
        h(
          'button',
          { style: STYLES.primary, onClick: () => void openProject(), disabled: busy },
          '打开项目',
        ),
        h('span', { style: STYLES.meta }, projectName),
        h('div', { style: { flex: '1 1 auto' } }),
        h(
          'button',
          {
            style: STYLES.button,
            onClick: () => void saveChapter(),
            disabled: busy || !dirty || !chapter,
          },
          dirty ? '保存章节 *' : '保存章节',
        ),
        h('span', { style: isError ? STYLES.error : STYLES.hint }, status),
      ),
      h(
        'div',
        { style: STYLES.body },
        h(
          'div',
          { style: STYLES.side },
          h(
            'div',
            { style: STYLES.tabs },
            ...(
              [
                ['chapters', '章节'],
                ['canon', '资料'],
                ['trash', '回收站'],
              ] as const
            ).map(([key, label]) =>
              h(
                'button',
                {
                  key,
                  style: tab === key ? STYLES.tabActive : STYLES.tab,
                  onClick: () => selectTab(key),
                  disabled: !summary,
                },
                label,
              ),
            ),
          ),
          tab === 'chapters'
            ? h(
                'div',
                { style: STYLES.list },
                chapters.length === 0
                  ? h('div', { style: STYLES.hint }, summary ? '该项目暂无章节。' : '先打开一个项目。')
                  : chapters.map((item) =>
                      h(
                        'button',
                        {
                          key: item.id,
                          style: chapterId === item.id ? STYLES.itemActive : STYLES.item,
                          onClick: () => void loadChapter(item.id),
                        },
                        h('div', null, item.title),
                        h('div', { style: STYLES.meta }, item.id),
                      ),
                    ),
              )
            : null,
          tab === 'canon'
            ? h(
                'div',
                { style: STYLES.list },
                canonEntries.length === 0
                  ? h('div', { style: STYLES.hint }, '该项目暂无设定资料。')
                  : canonEntries.map((entry) =>
                      h(
                        'button',
                        {
                          key: entry.path,
                          style: canonPath === entry.path ? STYLES.itemActive : STYLES.item,
                          onClick: () => void loadCanon(entry),
                        },
                        h('div', null, entry.title),
                        h(
                          'div',
                          { style: STYLES.meta },
                          `${KIND_LABELS[entry.kind] ?? entry.kind} · ${entry.format}`,
                        ),
                      ),
                    ),
              )
            : null,
          tab === 'trash'
            ? h(
                'div',
                { style: STYLES.list },
                trash.length === 0
                  ? h('div', { style: STYLES.hint }, '回收站为空。')
                  : trash.map((entry) =>
                      h(
                        'div',
                        {
                          key: entry.trashId,
                          style: { ...STYLES.item, cursor: 'default' },
                        },
                        h('div', null, entry.title),
                        h(
                          'div',
                          { style: STYLES.meta },
                          `${KIND_LABELS[entry.kind] ?? entry.kind} · ${entry.deletedAt}`,
                        ),
                        h('div', { style: STYLES.meta }, entry.originalPath),
                        h(
                          'button',
                          {
                            style: { ...STYLES.button, marginTop: '4px' },
                            onClick: () => void restoreEntry(entry),
                            disabled: busy,
                          },
                          '恢复',
                        ),
                      ),
                    ),
              )
            : null,
        ),
        h(
          'div',
          { style: STYLES.main },
          tab === 'chapters'
            ? chapter
              ? h(
                  'div',
                  { style: STYLES.main },
                  h(
                    'div',
                    { style: STYLES.bar },
                    h('strong', null, chapter.title),
                    h('span', { style: STYLES.meta }, chapter.path),
                    h('div', { style: { flex: '1 1 auto' } }),
                    h('span', { style: STYLES.meta }, dirty ? '未保存' : '已保存'),
                  ),
                  h('div', { ref: editorHost, style: STYLES.editor }),
                )
              : h('div', { style: STYLES.hint }, '从左侧选择章节开始写作。')
            : tab === 'canon'
              ? canonDoc
                ? h(
                    'div',
                    { style: STYLES.main },
                    h(
                      'div',
                      { style: STYLES.bar },
                      h('strong', null, canonDoc.title),
                      h('span', { style: STYLES.meta }, canonDoc.path),
                      h('div', { style: { flex: '1 1 auto' } }),
                      h(
                        'button',
                        {
                          style: STYLES.button,
                          onClick: () => void saveCanon(),
                          disabled: busy,
                        },
                        '保存资料',
                      ),
                    ),
                    h('textarea', {
                      style: STYLES.textarea,
                      value: canonDraft,
                      onChange: (event: any) => setCanonDraft(event.target.value),
                      spellCheck: false,
                    }),
                    h(
                      'span',
                      { style: STYLES.hint },
                      canonDoc.format === 'json'
                        ? 'JSON 资料：保存前会校验语法，未知字段会保留。'
                        : 'Markdown 资料：按原文保存，不做格式归一化。',
                    ),
                  )
                : h('div', { style: STYLES.hint }, '从左侧选择一条设定资料。')
              : h(
                  'div',
                  { style: STYLES.main },
                  h('h3', { style: { margin: 0 } }, '回收站'),
                  h(
                    'p',
                    { style: STYLES.hint },
                    '左侧列出章节、角色卡和资料文档。恢复前会检查原路径是否已被占用；成功后条目会从回收站移除。',
                  ),
                  h(
                    'p',
                    { style: STYLES.hint },
                    '阶段 0 仅实现恢复。永久删除、批量清空与力量体系注册表同步会在后续阶段补齐。',
                  ),
                ),
        ),
      ),
    )
  }

  return {
    inject: ['slots'],
    apply(ctx: any) {
      try {
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'deepsonder' }, Workbench),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'deepsonder',
              order: 45,
              label: () => 'DeepSonder',
            },
            PanelIcon,
          ),
        )
      } catch (error) {
        console.error('[deepsonder] client apply failed', error)
        throw error
      }
    },
  }
}
