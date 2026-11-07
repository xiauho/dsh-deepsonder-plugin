# DeepSonder DSH Plugin 项目交接文档

## 1. 文档信息

| 项目 | 内容 |
| --- | --- |
| 仓库 | `xiauho/dsh-deepsonder-plugin` |
| 本地目录 | `E:\AgentSpace\dsh-deepsonder-plugin` |
| 当前分支 | `phase-1` |
| 阶段 1 提交 | `1bf0416 feat: use DSH fs, add backups, project lock, and chapter CRUD` |
| 交接日期 | 2026-11-07 |
| 目标宿主 | DeepSeek Harness Desktop（DSH Desktop），Web 仅用于开发验证 |

## 2. 项目定位

本项目是 DeepSonder 的 DSH 桌面端插件，目标是在 DSH 内复现四项核心能力：

1. 设定资料管理：世界观、角色、力量体系、时间线、故事规划。
2. 简化写作台：章节树、Markdown 原文编辑、保存、章节增删改排序。
3. 回收站：章节、角色卡、资料文档的列出、移入与恢复。
4. AI 辅助写作：后续阶段通过 DSH tools/agent 提供续写、扩写、润色、一致性检查。

明确边界：

- 不复用 Python/PySide6 运行时，插件为纯 TypeScript。
- 不 fork DSH 的布局或外壳，只使用官方槽位与 `ctx.fs`。
- 项目磁盘格式保持与现有 DeepSonder-PySide6 项目一致，不做迁移。
- AI 结果必须人工确认后才能写回；提案工具不直接落盘。
- 桌面端优先，不为 Web、移动端或远程部署做兼容。

## 3. 当前进度

### 已完成：阶段 0

- DSH Host 插件加载，注册 `/deepsonder/health`。
- Client 半激活：`main` 全局面板、`sidebar.panellist` 侧栏入口。
- 工作台：项目目录输入、章节/资料/回收站三个标签、章节 Markdown 编辑。
- 真实项目副本验证：打开项目、读取章节、保存未修改章节、保存修改段落、回收站恢复。
- 关键结论：本地目录以 Junction 安装不会被 DSH Client roster 收录，必须使用 tarball。

### 已完成：阶段 1

- 文件系统改为 DSH `ctx.fs`，通过 `inject: ['webServer', 'fs']` 获取。
- `ProjectStore` 统一路径约束、原子写、版本守卫与自动备份。
- `ProjectLock` 写入 `.novalist/plugin.lock`，支持强制打开与卸载释放。
- 章节新建、标题重命名、上移/下移排序、删除到回收站。
- 排序时同步 `memory/chapter_summaries.json` 与 `canon/timeline_events.json` 的章节引用。
- Host 路由与 Client 工作台交互更新。
- 18 项领域测试、构建、客户端冒烟测试通过。

### 未完成：阶段 2 与阶段 3

- 阶段 2：DSH tools、AI 提案、右栏审阅、过期校验、明确采用。
- 阶段 3：桌面端 E2E、性能、DSH 版本矩阵、打包与签名。

## 4. 仓库结构

```text
src/
  index.ts                    Host 半入口，注入 webServer + fs
  domain/
    fs-port.ts                文件系统契约（对齐 DSH ctx.fs）
    node-fs.ts                测试用 Node 文件系统实现
    project-store.ts          路径约束、原子写、自动备份、版本守卫
    project-lock.ts           项目锁
    project.ts                项目打开/刷新与摘要
    chapter.ts                章节解析、读写、新建、改名、排序
    canon.ts                  设定资料读写
    trash.ts                  回收站列出、移入、恢复
    errors.ts                 DomainError
    paths.ts                  sha256
  host/
    project-manager.ts        当前打开项目、锁、刷新
    routes.ts                 /deepsonder/* 同源 JSON API
  client/
    index.ts                  工作台主面板、CodeMirror 6、侧栏图标
scripts/
  build-client.mjs            Client lazy-CJS 打包
  smoke-client.mjs            客户端工厂冒烟测试
tests/
  domain.test.ts              领域层测试
  fixtures/                   自包含测试项目
cordis.patch.yml              Host 插件 bundle 行
package.json                  DSH bundle/client 清单
README.md                     使用与安装说明
HANDOVER.md                   本文档
```

## 5. 架构与数据流

```text
DSH Desktop (Electron)
  ├─ Host 半（Node / Cordis）
  │   ├─ ProjectManager
  │   ├─ ProjectStore → ctx.fs（沙箱/权限感知）
  │   ├─ ProjectLock
  │   └─ /deepsonder/* HTTP 路由
  └─ Client 半（浏览器渲染层）
      ├─ main 全局面板：工作台
      ├─ sidebar.panellist：DeepSonder 入口
      └─ CodeMirror 6：章节 Markdown
```

通信方式：Client 使用同源 `fetch('/deepsonder/...')` 调用 Host 路由；Host 返回 JSON。当前不依赖 DSH RPC，便于阶段 2 再迁移到 tools/service。

Client 打包要求：

- 浏览器半必须是 `window.__ModuleLoader__.load({ id, factory })` 形式。
- 工厂必须返回插件对象 `{ inject, apply }`，不能返回需要宿主再次调用的函数。
- `react` 由宿主提供，构建时标记 external。
- 构建产物 `lib/client.js` 不提交，`npm pack` 时通过 `prepack` 生成。

## 6. 项目数据格式

插件直接读写现有 DeepSonder 项目，不迁移格式。

| 文件/目录 | 用途 |
| --- | --- |
| `project.json` | 项目 ID、名称、作者、时间 |
| `outline/chapters/chapter_NN.md` | 章节正文；`# 标题`、`## 大纲`、`## 剧情简写`、`## 正文` |
| `canon/characters/*.md` | 角色卡 |
| `canon/world/*.md` | 世界观 |
| `canon/power/*.md` | 力量体系 |
| `canon/timeline.md` | 时间线笔记 |
| `canon/timeline_events.json` | 结构化时间线事件 |
| `outline/story_plan.json` | 故事规划 |
| `memory/chapter_summaries.json` | 章节摘要映射 |
| `memory/accepted_chapter_memory.json` | 已采用的章节记忆 |
| `memory/story_state.json` | 故事状态 |
| `.novalist/trash/<trash_id>/` | 章节回收站条目 |
| `.novalist/trash/characters/<trash_id>/` | 角色卡回收站条目 |
| `.novalist/trash/canon/<trash_id>/` | 资料回收站条目 |
| `.novalist/backups/auto-*` | 插件自动备份，最多 50 份 |
| `.novalist/plugin.lock` | 插件项目锁 |

回收站 manifest 兼容三种形式：

- 章节：`trash_id`、`chapter_id`、`title`、`original_path`、`deleted_at`、`has_summary`
- 角色：`trash_id`、`character_id`、`title`、`original_path`、`deleted_at`
- 资料：`schema_version`、`trash_id`、`kind`、`entry_id`、`title`、`original_path`、`deleted_at`、`metadata`

## 7. Host API

所有路由注册在 DSH 同源 Web 服务器下，方法不匹配返回 405，错误统一返回 `{ error, code }`。

| 方法 | 路径 | 请求 | 说明 |
| --- | --- | --- | --- |
| GET | `/deepsonder/health` | - | 健康检查 |
| POST | `/deepsonder/project/open` | `{ root, force? }` | 打开项目并获取锁 |
| POST | `/deepsonder/project/close` | - | 释放锁并关闭项目 |
| GET | `/deepsonder/project/summary` | `?root=` | 刷新项目摘要 |
| GET | `/deepsonder/chapter` | `?root=&id=` | 读取章节 |
| POST | `/deepsonder/chapter/save` | `{ root, id, raw, expectedVersion }` | 保存章节 |
| POST | `/deepsonder/chapter/create` | `{ root, title, id? }` | 新建章节 |
| POST | `/deepsonder/chapter/rename` | `{ root, id, title, expectedVersion? }` | 修改章节标题 |
| POST | `/deepsonder/chapter/reorder` | `{ root, orderedIds }` | 重排章节 |
| POST | `/deepsonder/chapter/delete` | `{ root, id }` | 移入回收站 |
| GET | `/deepsonder/canon` | `?root=` | 列出设定资料 |
| GET | `/deepsonder/canon/doc` | `?root=&path=` | 读取资料 |
| POST | `/deepsonder/canon/save` | `{ root, path, raw, expectedVersion }` | 保存资料 |
| GET | `/deepsonder/trash` | `?root=` | 列出回收站 |
| POST | `/deepsonder/trash/restore` | `{ root, trashId }` | 恢复回收站条目 |

版本守卫：读取结果返回 `version`；保存时原样回传 `expectedVersion`。文件被外部修改时返回 409。

## 8. 关键设计决策

1. **纯 TypeScript**：不保留 Python 运行时，避免双运行时、IPC 版本漂移和打包负担。
2. **使用 `ctx.fs`**：读写遵循 DSH 沙箱与权限策略；Host 不再直接使用 Node `fs`（测试适配器除外）。
3. **官方扩展座位**：`main` 全局面板、`sidebar.panellist`、`ctx.layout`，不修改宿主源码。
4. **格式冻结**：与 PySide6 版共用磁盘格式；任何格式变更必须走显式迁移与往返测试。
5. **版本守卫**：所有内容写操作使用 `expectedVersion`，冲突时要求重新载入。
6. **自动备份**：保存前写入 `.novalist/backups/auto-*`，最多 50 份；备份失败不阻塞主保存。
7. **项目锁**：`.novalist/plugin.lock` 只约束本插件的多个会话；PySide6 不读取该锁，跨程序仍依赖版本哈希。
8. **排序谨慎**：只支持 `chapter_NN` 标准 ID；含已采用章节记忆或自定义 ID 的项目拒绝重排。
9. **AI 不直接写盘**：阶段 2 的提案工具只返回内容，写入必须由 UI 在用户确认后调用 Host。

## 9. 开发与验证

环境要求：

- Node.js `^22.19.0 || >=24.0.0`
- npm
- DSH CLI 与目标 profile（需要包含 web-app，例如 `web` 或 `desktop`）

常用命令：

```powershell
cd E:\AgentSpace\dsh-deepsonder-plugin
npm install
npm run typecheck
npm run verify
```

`npm run verify` 依次执行：

1. `npm run build`：Host `tsc` + Client esbuild 打包到 `lib/client.js`。
2. `npm test`：Vitest 运行领域测试。
3. `npm run smoke:client`：模拟 `window.__ModuleLoader__` 验证 Client 工厂注册。

测试夹具：

- `tests/fixtures/demo_novel`：公开演示项目副本，包含章节、角色、世界观、力量体系、时间线、回收站示例。
- `tests/fixtures/timeline-project`：合成的时间线/故事规划项目。
- 测试会在系统临时目录复制夹具，不修改仓库内文件。

## 10. 安装到 DSH

**不要使用本地目录 Junction 安装**，DSH Client roster 不会收录，表现为 `web boot: 1 entry did not activate`。

```powershell
npm run build
npm pack

dsh plugin --profile <profile> add <绝对路径>\dsh-deepsonder-plugin-<version>.tgz
dsh --profile <profile> --dump-config
```

验证：

1. 启动 profile。
2. 侧栏出现 `DeepSonder` 入口。
3. 点击进入工作台，填写项目目录并点击“打开项目”。

## 11. 已知限制

- **DSH 沙箱**：项目目录必须在当前 DSH 工作区可写范围内，或使用完整文件访问模式；否则写操作返回 `FS_SANDBOX_DENIED`。
- **排序限制**：自定义章节 ID 或存在已采用章节记忆时拒绝重排。
- **回收站目录**：`ctx.fs` 没有删除目录能力，恢复/清理后会留下空目录；清单删除后不再出现在列表。
- **未实现**：永久删除、批量清空、力量体系注册表同步、原生目录选择器、资料编辑器 CodeMirror 化。
- **跨程序锁**：PySide6 不读取 `.novalist/plugin.lock`，同时打开同一项目仍可能互相覆盖；必须依赖版本冲突提示。
- **真实桌面 E2E 未闭环**：测试环境的 DSH 登录/预览遮罩会拦截点击；Host 领域逻辑已通过真实项目副本验证。
- **DSH 预览版 API**：上游处于 developer preview，存在破坏性变更风险；适配层集中在 `src/domain/fs-port.ts`、`src/host/routes.ts` 与 `src/client/index.ts`。

## 12. 故障排查

| 现象 | 处理 |
| --- | --- |
| `web boot: 1 entry did not activate` | 确认用 tarball 安装；检查 Client 工厂是否返回 `{ inject, apply }`；查看浏览器 Console 的 `[deepsonder]` 日志 |
| Client 侧栏没有 DeepSonder | 确认 profile 包含 web-app；确认 `dsh.client.inject` 与 `lib/client.js` 存在 |
| `FS_SANDBOX_DENIED` | 把项目目录加入 DSH 工作区，或切换完整文件访问模式 |
| `project_locked` | 关闭另一个 DSH 会话，或在 UI 勾选“强制打开” |
| `reorder_unsupported` | 项目含自定义章节 ID 或已采用章节记忆；先迁移/清空记忆 |
| 保存返回 409 | 文件被外部修改；重新载入章节后再保存 |
| 回收站恢复后仍看到空目录 | 预期行为；清单已删除，列表不会显示 |
| 构建失败 | 确认 Node 版本满足要求；重新执行 `npm install` |

## 13. 后续路线

### 阶段 2：AI 工具

建议工具面：

- `deepsonder_project_summary`
- `deepsonder_list_chapters`
- `deepsonder_read_chapter`
- `deepsonder_search_canon`
- `deepsonder_read_canon`
- `deepsonder_propose_continue`
- `deepsonder_propose_expand`
- `deepsonder_propose_polish`
- `deepsonder_check_consistency`

设计要求：

- 写入工具不暴露给模型；模型只生成提案。
- 提案包含 `baseRevision`、`contextHash`、`kind`、`content`。
- 采用前重新校验正文与资料版本；过期即阻止。
- 审阅界面放在右栏标签页；保留差异对比、拒绝、重新生成。
- 所有模型调用走 DSH agent/session，不使用隐藏的直连模型请求。

### 阶段 3：稳定性与发布

- DSH 版本兼容矩阵与契约测试。
- Windows 桌面端 Playwright E2E。
- 长章节、中文 IME、大项目性能基准。
- 打包、签名、安装与回滚。
- 视需要补充永久删除、批量清空、原生目录选择器与 CodeMirror 资料编辑。

## 14. 交接检查清单

接手后建议按顺序完成：

1. 阅读 `README.md` 与本文档。
2. 在本地执行 `npm install && npm run verify`。
3. 检查 `git log`、`git status`、远端 `phase-1` 分支是否同步。
4. 使用 tarball 安装到一个包含 web-app 的 DSH profile，确认侧栏与工作台可见。
5. 在真实 DSH Desktop（已配置模型/会话）中完成一次“打开项目 → 编辑章节 → 保存 → 恢复回收站”闭环。
6. 在开始阶段 2 前，先确定提案对象、审阅 UI 位置、工具参数与过期策略。
7. 任何项目格式变更必须同时补迁移、往返测试和 PySide6 兼容说明。

## 15. 安全与隐私

- 仓库不包含 API Key、模型凭据或用户项目。
- 测试夹具来自公开演示项目与合成数据。
- 插件只读写用户选择的本地项目；阶段 2 的 AI 上下文只在用户主动执行任务时发送。
- 模型与凭据由 DSH 管理，插件不保存、不转发。
- 不提交 `node_modules`、`dist`、`lib`、`*.tgz` 或用户项目目录。
