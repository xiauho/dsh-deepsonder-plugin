# dsh-deepsonder-plugin

DeepSonder 的 DeepSeek Harness（DSH）桌面端插件。当前完成阶段 1：文件系统接入、自动备份、项目锁和章节增删改排序。

## 阶段 1 范围

- 通过 DSH `ctx.fs` 读写项目，遵循宿主的沙箱与权限策略。
- 项目打开时写入 `.novalist/plugin.lock`，关闭或卸载时释放；支持“强制打开”接管。
- 保存章节/资料前自动备份到 `.novalist/backups/auto-*`，最多保留 50 份。
- 章节：新建、标题重命名、上移/下移、删除到回收站。
- 设定资料：世界观、角色、力量体系、时间线、故事规划的读取与保存。
- 回收站：章节、角色卡、资料文档的列出与恢复。
- 工作台仍以 DSH `main` 全局面板承载，侧栏入口通过 `sidebar.panellist` 注册。

不在本阶段：AI 工具、完整记忆系统、旧项目导入导出、永久删除、批量清空、原生目录选择器。

## 结构

```text
src/domain/fs-port.ts        文件系统契约（对齐 ctx.fs）
src/domain/node-fs.ts        测试用 Node 文件系统实现
src/domain/project-store.ts  路径约束、原子写、自动备份
src/domain/project-lock.ts   项目锁
src/domain/chapter.ts        章节读写、新建、改名、排序、删除到回收站
src/domain/canon.ts          设定资料读写
src/domain/trash.ts          回收站列出、恢复、移入
src/host/                    DSH webServer 路由与 ProjectManager
src/client/                  工作台主面板、CodeMirror 6、侧栏图标
tests/                       领域层测试与自包含 fixtures
```

Host 半运行在 DSH Node 进程，通过 `ctx.fs` 访问项目；Client 半运行在 DSH 渲染层，通过同源 `/deepsonder/*` 路由通信。

## 构建与测试

```powershell
npm install
npm run verify
```

`npm run verify` 依次执行 Host/Client 构建、18 项领域测试和客户端工厂冒烟测试。

## 安装到 DSH profile

**本地目录安装（Junction）不会被 DSH 的 Client roster 收录，必须使用打包后的 tarball。**

```powershell
npm run build
npm pack

# profile 需要包含 web-app，例如 web 或 desktop 模板
dsh plugin --profile <profile> add <绝对路径>\dsh-deepsonder-plugin-<version>.tgz
dsh --profile <profile> --dump-config
```

启动后侧栏出现 `DeepSonder` 入口，点击进入工作台。

## 阶段 1 验证结果

已通过：

- `npm run verify`：构建、18 项领域测试、客户端冒烟测试。
- 章节新建、重复 ID 拒绝、标题改名、上下移排序、汇总键重映射。
- 章节删除到回收站、摘要移除、恢复章节与摘要、恢复冲突拒绝。
- 设定资料 Markdown 往返、时间线 JSON 往返并保留未知字段。
- 保存冲突检测、路径越界拒绝、自动备份与项目锁逻辑。

尚未在真实 DSH Desktop 中完成 UI 点击闭环，原因与阶段 0 相同：测试环境的登录/预览遮罩会拦截操作。Host 领域逻辑已用真实项目副本验证。

## 已知限制

- **DSH 沙箱**：项目目录必须位于当前 DSH 工作区可写范围内，或使用完整文件访问模式；否则写操作会返回 `FS_SANDBOX_DENIED` 提示。
- **排序范围**：只支持 `chapter_NN` 形式的标准章节 ID；包含已采用章节记忆或自定义 ID 的项目会拒绝重排，避免派生数据错位。
- **回收站目录**：`ctx.fs` 没有删除目录的能力，恢复/清理后会留下空回收站目录；清单删除后不会再出现在列表中。
- **未实现**：永久删除、批量清空、力量体系注册表同步、原生目录选择器、资料编辑器的 CodeMirror 化。
- **锁的边界**：锁只约束本插件的多个会话，PySide6 版不会读取该锁；跨程序写入仍依赖版本哈希检测。

## 下一步（阶段 2）

- 注册 DSH tools：项目概览、读章节、搜索资料、读设定。
- 注册提案工具：续写、扩写、润色、一致性检查，只返回内容不写文件。
- 右栏审阅标签页、差异对比、过期校验与明确采用。
