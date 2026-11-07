# dsh-deepsonder-plugin

DeepSonder 的 DeepSeek Harness（DSH）桌面端插件，阶段 0 实现。

## 阶段 0 范围

- 打开现有 DeepSonder 项目（读取 `project.json`，不迁移格式）。
- 章节写作台：章节树、Markdown 原文编辑、保存与外部修改检测。
- 设定资料：世界观、角色、力量体系、时间线、故事规划的读取与保存。
- 回收站：章节、角色卡、资料文档的列出与恢复。
- 工作台以 DSH `main` 全局面板承载，侧栏入口通过 `sidebar.panellist` 注册。

阶段 0 不包含 AI 工具、完整记忆系统、旧项目导入导出、永久删除和力量体系注册表同步。

## 结构

```text
src/domain/    项目、章节、资料、回收站、路径与原子写入
src/host/      DSH webServer 路由（同源 JSON API）
src/client/    工作台主面板、CodeMirror 6 编辑器、侧栏图标
src/index.ts   Host 半：注册路由
scripts/       客户端打包与冒烟测试
tests/         领域层测试（真实项目副本）
```

Host 半运行在 DSH Node 进程；Client 半运行在 DSH Desktop/Web 的渲染层。两者通过同源 `/deepsonder/*` 路由通信。

## 构建与测试

```powershell
npm install
npm run build
npm test
npm run smoke:client
```

`npm run verify` 依次执行构建、领域测试和客户端工厂冒烟测试。

## 安装到 DSH profile

**本地目录安装（Junction）不会被 DSH 的 Client roster 收录，必须使用打包后的 tarball。**

```powershell
npm run build
npm pack

# profile 需要包含 web-app，例如 web 或 desktop 模板
dsh plugin --profile <profile> add <绝对路径>\dsh-deepsonder-plugin-<version>.tgz
dsh --profile <profile> --dump-config
```

启动后：

- 侧栏出现 `DeepSonder` 入口。
- 点击后进入工作台，填写项目目录并点击“打开项目”。

## 阶段 0 验证结果

已通过：

- `npm run typecheck`、13 项领域测试、客户端工厂冒烟测试。
- DSH Host 插件加载，`/deepsonder/health` 返回 `ok`。
- 通过真实 HTTP 路由完成：打开项目、读取章节、保存未修改章节（哈希不变）、保存修改段落、列出回收站、恢复章节及其摘要。
- Client 半在 DSH Web 中激活，侧栏入口可见，工作台显示“项目目录”输入框和“章节/资料/回收站”标签。

尚未通过浏览器端到端验证：

- 在 DSH 工作台内完成“输入路径 → 打开项目 → 编辑保存”的 UI 闭环。测试环境中的 DSH 预览版说明／登录引导遮罩会拦截点击，且当前环境没有可用的 DSH Desktop 会话。
- Host API 已用真实项目副本逐项验证，因此该缺口属于宿主引导层而非插件数据链路。

## 已知限制

- 阶段 0 只支持已有章节的编辑，不支持新建或重排章节。
- 回收站只实现恢复；永久删除、批量清空、力量体系注册表同步未实现。
- 资料编辑使用纯文本区，尚未复用 CodeMirror。
- Host 路由仅依赖本机回环地址与 DSH 进程权限，尚未接入 DSH 的审批/沙箱策略；后续阶段应迁移到 `ctx.fs` 与宿主服务。
- 项目目录路径由用户填写；阶段 1 接入桌面原生目录选择器。

## 下一步（阶段 1）

- 把项目/章节/资料/回收站服务迁到 `ctx.fs`，补齐外部修改、备份和并发锁。
- 接入原生目录选择器与最近项目。
- 补齐新建/重排章节、永久删除、批量清空。
- 按阶段 2 方案注册 DSH tools，并把 AI 结果审阅放到右栏标签页。
