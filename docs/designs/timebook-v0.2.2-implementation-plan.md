# 时间簿（Timebook）v0.2.2 实施计划

- **日期 / 版本**：2026-11-22 / `v0.2.2`
- **依据设计**：[v0.2.2 增量设计方案](timebook-v0.2.2-design.md)（已于 2026-11-22 经用户确认冻结，确认条目 `C-22`～`C-25` 见 [讨论纪要第 6 节](../requirements/timebook-讨论纪要.md#6-v022-专注发起体验与停用稳定性迭代讨论与确认记录)）
- **交互原型参考**：当前会话已确认的交互原型（`timebook-v0.2.2-prototype.html`）及 [设计规范](../设计规范.md)
- **本轮授权终点**：已获授权启动 `Swarm` 团队（`dev` + `qa`）完成实施、全仓自测、构建独立发布包与桌面安装包，并交由 `qa` 执行独立盲测直至可收口或上报。
- **既有基线与红线**：基于已正式收口基线 `v0.2.1`（提交 `4f8b6ae`）。严禁修改 `prototype/` 原件，严禁触碰用户本机真实 `%APPDATA%` 桌面数据目录、真实家庭 `NAS` 或外部 `Notion` 工作区；平常实施与返修轮次不执行 `git commit`。

---

## 一、文件职责、共用接口合同与依赖顺序

### 1.1 修改与新增文件映射

```text
timebook/
├─ package.json                                    # [修改] 版本号升至 0.2.2
├─ packages/
│  └─ core/
│     ├─ package.json                              # [修改] 版本号升至 0.2.2
│     ├─ src/
│     │  └─ syncCheck.ts (或 merge.ts 扩展)        # [新增/修改] 可提取纯函数：检测服务端返回的标签是否支持 disabled_at（detectLegacyTagDisableDrop），便于无浏览器确定性单测
│     └─ test/
│        └─ core.test.ts                           # [修改] 补充旧服务端缺失 disabled_at 与停用被忽略检测纯函数单测
├─ apps/
│  ├─ api/
│  │  ├─ package.json                              # [修改] 版本号升至 0.2.2
│  │  ├─ src/
│  │  │  ├─ app.ts                                 # [修改] /api/health 与 /api/status 返回 version: '0.2.2' 与 capabilities: ['tag_disabled_at']
│  │  │  └─ import-export.ts                       # [修改] exportDatabaseJson 版本号更新为 '0.2.2'
│  │  └─ test/
│  │     └─ api.test.ts                            # [修改] 验证 /api/health 与 /api/status 能力标识、连续停用/启用后多次增量同步不反弹
│  ├─ web/
│  │  ├─ package.json                              # [修改] 版本号升至 0.2.2
│  │  └─ src/
│  │     ├─ components/
│  │     │  ├─ ModuleTagGroups.tsx                 # [新增] 共享组件：按一级模块分组展示启用中二级标签（支持普通与紧凑态、选中高亮、再点取消）
│  │     │  ├─ StartFocusModal.tsx                 # [新增] 今日页「开始专注」弹窗（内容输入框 + ModuleTagGroups + 回车/开始提交 + 取消零记录）
│  │     │  ├─ TagPickerModal.tsx                  # [核对/复用] 保留用于进行中计时卡右上角「换标签/选标签」，内部可复用 ModuleTagGroups
│  │     │  └─ SettingsDrawer.tsx                  # [修改] 单机 JSON 导出版本号更新为 '0.2.2'
│  │     ├─ pages/
│  │     │  ├─ TodayPage.tsx                       # [修改] 点「开始专注」打开 StartFocusModal，不再预先创建计时；仅在确认提交时 startTimer
│  │     │  └─ LauncherPage.tsx                    # [修改] 升级灵动胶囊「新建专注」快捷选框：上方未完成待办小标签直开（全部/仅今日切换）+ 下方内容输入与 ModuleTagGroups 一级分类排布；开窗刷新数据
│  │     └─ store/
│  │        └─ useAppStore.ts                      # [修改] 停用时间戳 Math.trunc 取整；pullSyncDelta 并发队列防护与旧服务端静默丢弃检测提示；理顺 enqueueMutation 落盘与广播顺序
│  └─ desktop/
│     ├─ package.json                              # [修改] 版本号升至 0.2.2
│     └─ src-tauri/
│        ├─ Cargo.toml                             # [修改] version = "0.2.2"
│        └─ tauri.conf.json                        # [修改] version = "0.2.2"；launcher 窗口默认尺寸改为 width: 540, height: 520
```

---

### 1.2 跨组件共用接口合同（唯一权威定义）

1. **共享组件 `ModuleTagGroups`（`apps/web/src/components/ModuleTagGroups.tsx`）**：
   ```ts
   interface ModuleTagGroupsProps {
     lookup: TagLookup;
     selectedTagId: string | null;
     onSelect: (tagId: string | null) => void;
     compact?: boolean;
     maxHeight?: number | string;
     testIdPrefix?: string;
   }
   ```
   - 仅遍历 `lookup.activeModules` 与 `lookup.enabledTags`（严格隐藏已停用标签）；某模块下没有启用标签时不渲染空分组；
   - 点击标签时：若 `selectedTagId === t.id` 则回调 `onSelect(null)`（支持再点取消），否则回调 `onSelect(t.id)`；
   - 视觉遵循设计规范：`compact` 态按钮高 `32px`、`borderRadius: 10`，标准态高 `38px`、`borderRadius: 12`；选中态 `boxShadow: 'inset 0 0 0 2px #111827'`，未选中态 `boxShadow: \`inset 0 0 0 1px ${pal.line}\``，带所属模块色点与名称。

2. **今日页发起专注弹窗 `StartFocusModal`（`apps/web/src/components/StartFocusModal.tsx`）**：
   ```ts
   interface StartFocusModalProps {
     open: boolean;
     onConfirm: (opts: { tagId: string | null; title: string | null }) => Promise<void> | void;
     onCancel: () => void;
   }
   ```
   - 内部维护 `title` 与 `selectedTagId` 与 `submitting` 提交锁；每次打开重置为空；
   - `Enter`（非 `isComposing`、非 `keyCode === 229` 且焦点不在取消/关闭/清除标签按钮）与点击「开始」统一触发表单提交；
   - 点击遮罩、右上角 `✕`、底部「取消」或按 `Esc` 直接触发 `onCancel`，绝不调 `startTimer`。

3. **灵动胶囊快捷选框 `LauncherPage`（`apps/web/src/pages/LauncherPage.tsx`）**：
   - 顶部「未完成待办」区域：
     - 维护 `todoScope: 'all' | 'today'`（默认 `'all'`）；
     - 「全部」直接调用 `getAllPendingTodos(todos, todoChecks, sessions, todayStr, nowMs()).filter((i) => !i.done)`；
     - 「仅今日」直接调用 `getTodayTodos(todos, todoChecks, sessions, todayStr, nowMs()).items.filter((i) => !i.done)`；
     - 点击某条待办小标签直接执行 `startTimer({ tagId: td.tag_id, title: td.title, todoId: td.id })` 后立即隐藏窗口。
   - 下方「自定义专注」区域：
     - 标题输入框 + `ModuleTagGroups`（`compact` 模式）；
     - 表单提交或按 `Enter`（防 IME 误触）调用 `startTimer({ tagId: selectedTagId, title: title.trim() || null })` 后立即隐藏窗口；
   - `onLauncherOpened` 与窗口 `focus` 事件触发 `syncFromBridgeUpdate()`，确保待办与标签实时同步。

4. **服务端版本能力与客户端停用保护合同（`apps/api/src/app.ts`、`packages/core`、`apps/web/src/store/useAppStore.ts`）**：
   - `GET /api/health` 与 `GET /api/status` 响应新增 `version: '0.2.2'`、`capabilities: ['tag_disabled_at']`；
   - 在 `@timebook/core` 中新增并导出纯函数：
     ```ts
     export function detectLegacyTagDisableIgnored(
       rawRemoteTag: Record<string, unknown> | null | undefined,
       expectedDisabled: boolean,
     ): boolean
     ```
     - 若 `!rawRemoteTag` 返回 `false`；
     - 若服务端返回对象根本缺少 `'disabled_at'` 键（`!Object.prototype.hasOwnProperty.call(rawRemoteTag, 'disabled_at')`），返回 `true`；
     - 若期望停用（`expectedDisabled === true`）但服务端返回的 `rawRemoteTag.disabled_at` 不是数字（即仍为 `null` 或 `undefined`），返回 `true`；
     - 其余情况返回 `false`。
   - `useAppStore.ts` 中：
     - `setTagDisabled` 构造 `disabled_at: disabled ? Math.trunc(get().nowMs()) : null`；
     - 对 `tag.upsert`（携带显式停用/启用动作）完成远端推送与 `pullSyncDelta` 后，从服务端原始响应 `data.tags` 中找到同 ID 原始记录并用 `detectLegacyTagDisableIgnored` 核对；若返回 `true`，立即设置 `errorBanner`：
       `「停用标签未在家庭 NAS 服务端生效：当前连接的 NAS 容器镜像版本过旧，请先将 NAS 端的 Timebook 镜像更新到最新版（v0.2.2+）」`；
     - 同时在 `pullSyncDelta` 写回前校验 `localDb.pendingMutations.count()`，当本地存在待提交队列时，避免过期 `GET /api/sync` 响应覆盖本地尚未冲刷的实体。

---

## 二、分步实施任务与验证要求（依赖顺序：`T1 → T2 → T3 → T4 → T5`）

### 任务 T1：`@timebook/core` 停用服务端兼容性校验纯函数与测试
- **对应设计**：2.3（`C-24`）。
- **文件与动作**：
  1. 在 `packages/core/src/merge.ts`（或独立小模块并在 `packages/core/src/index.ts` 导出）实现 `detectLegacyTagDisableIgnored(rawRemoteTag, expectedDisabled)`；
  2. 在 `packages/core/test/core.test.ts` 补充单元测试：覆盖「远端标签缺失 `disabled_at` 键（旧服务端）」「期望停用但远端返回 `disabled_at: null`（静默忽略）」「正常新版停用返回数字时间戳」「正常启用返回 `disabled_at: null`」四类边界。
- **验证**：`corepack pnpm --filter @timebook/core test` 100% 通过。

### 任务 T2：`@timebook/api` 能力声明与同步一致性测试强化
- **对应设计**：2.3（`C-24`）。
- **前置**：T1 完成。
- **文件与动作**：
  1. 修改 `apps/api/src/app.ts`：`/api/health` 与 `/api/status` 返回体补充 `version: '0.2.2'` 与 `capabilities: ['tag_disabled_at']`；
  2. 修改 `apps/api/src/import-export.ts`：`exportDatabaseJson` 中 `version` 升级为 `'0.2.2'`；
  3. 修改 `apps/api/test/api.test.ts`：
     - 校验 `/api/health` 与 `/api/status` 返回 `version === '0.2.2'` 及 `capabilities` 包含 `'tag_disabled_at'`；
     - 校验连续多次调用 `tag.upsert` 停用标签并反复执行增量 `GET /api/sync?since=...` 拉取，返回标签始终保留 `disabled_at` 不丢失；更新导出版本断言为 `'0.2.2'`。
- **验证**：`corepack pnpm --filter @timebook/api test` 100% 通过。

### 任务 T3：`@timebook/web` 同步状态层修复与共享组件抽离
- **对应设计**：2.1、2.2、2.3（`C-22`、`C-23`、`C-24`）。
- **前置**：T1 完成。
- **文件与动作**：
  1. 修改 `apps/web/src/store/useAppStore.ts`：
     - `setTagDisabled` 中使用 `Math.trunc(get().nowMs())`；
     - 在 `pullSyncDelta` 返回原始 `data.tags`（或透传校验回调）并与 `pendingMutations` 联合校验，防止后台并发 `pullSyncDelta` 覆盖尚未提交的本地修改；
     - 当 `enqueueMutation` 执行 `tag.upsert` 并在连服务端模式完成同步拉取后，用 `detectLegacyTagDisableIgnored` 核验服务端返回值，一旦命中旧服务端忽略或字段缺失，立刻 `set({ errorBanner: ... })` 给出中文升级提示；
     - 理顺 `enqueueMutation`：先 `await Promise.all([...dbTasks, ...])` 确保本地库写入完成，再进行磁盘快照保存与跨窗广播（仅 `session.upsert` / `session.cancel_running` 保留 `emitFastRunningBroadcast` 零延迟起跳）；
     - 若需补齐 store 级单测，确保有针对停用状态与并发同步的测试覆盖。
  2. 新增 `apps/web/src/components/ModuleTagGroups.tsx`：实现与设计规范及用户确认原型一致的一级模块分类标签选择组件（标准态 + `compact` 态，支持选中与再点取消，严格仅列 `lookup.enabledTags`）。
  3. 核对并按需复用 `ModuleTagGroups` 于 `TagPickerModal.tsx`（保持进行中计时卡「换标签 / 选标签」点选即换行为不变）。
  4. 修改 `apps/web/src/components/SettingsDrawer.tsx`：单机 JSON 导出 `version` 升级为 `'0.2.2'`。

### 任务 T4：「今日」页与「灵动胶囊」快捷选框界面实施
- **对应设计**：2.1（`C-22`）、2.2（`C-23`）。
- **前置**：T3 完成。
- **文件与动作**：
  1. 新增 `apps/web/src/components/StartFocusModal.tsx`：实现「开始专注」表单弹窗（自动聚焦内容输入框 + `ModuleTagGroups` + 回车/「开始」才提交 + 「取消」/遮罩/`Esc` 零记录退出 + IME 组合态防误触）。
  2. 修改 `apps/web/src/pages/TodayPage.tsx`：
     - 新增 `startModalOpen: boolean` 状态；
     - 点击「开始专注」按钮改为 `setStartModalOpen(true)`（不再提前调用 `startTimer`）；
     - 挂载 `<StartFocusModal>`，仅在 `onConfirm` 时调用 `await startTimer({ tagId, title })`；
     - 保留进行中计时卡右上角「换标签 / 选标签」继续使用 `TagPickerModal`。
  3. 修改 `apps/web/src/pages/LauncherPage.tsx`：
     - 上方新增未完成待办简约小标签区：调用 `getAllPendingTodos` / `getTodayTodos` 过滤未完成项，提供「全部 / 今日」切换（默认全部），渲染单行胶囊小标签（模块色点 + 单行截断标题 + 悬停全文 `title` + 播放图标），点击直接 `startTimer({ tagId, title, todoId })` 并 `hideLauncher`；
     - 下方改造为内容输入框 + `ModuleTagGroups`（`compact` 模式，与主界面一致的一级模块分类）+ 「清空标签」/「取消」/「开始」按钮；
     - 完善键盘交互（`Enter` 提交防 IME 误触，待办小标签按钮单独响应点击/回车不串扰下方表单，全局 `Esc` 取消关闭）；
     - `onLauncherOpened`（以及窗口 `focus` 时）触发 `syncFromBridgeUpdate()` 刷新最新待办与标签，并重置草稿与焦点。
  4. 修改 `apps/desktop/src-tauri/tauri.conf.json`：将 `launcher` 窗口默认尺寸改为 `width: 540, height: 520`。

### 任务 T5：版本号 `0.2.2` 对齐、全仓自测、打包与移交 `QA`
- **对应设计**：3、4。
- **前置**：T1–T4 全部完成。
- **文件与动作**：
  1. 将 `package.json`、`packages/core/package.json`、`apps/api/package.json`、`apps/web/package.json`、`apps/desktop/package.json`、`apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/tauri.conf.json` 的 `version` 统一升级为 `0.2.2`。
  2. 执行全仓验证（全部须 100% 通过）：
     - `corepack pnpm typecheck`
     - `corepack pnpm test`
     - `corepack pnpm build`
     - `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
     - `corepack pnpm desktop:build`（真实编译出 `0.2.2` 桌面执行文件与 NSIS 安装包）
  3. 在隔离环境下做基础冒烟核验（含网页端与桌面产物基本连通性）后，构建交付包：
     - 运行 `python scripts/release_app.py build --output workspace-data/outputs/timebook/v0.2.2-R1/timebook.zip`
     - 将真实编译产出的 `apps/desktop/src-tauri/target/release/timebook-desktop.exe` 与 `apps/desktop/src-tauri/target/release/bundle/nsis/*-setup.exe` 复制留档到 `workspace-data/outputs/timebook/v0.2.2-R1/installers/`
     - 在 Swarm 共享面板发送 `@qa [review_requested]` 移交评审（附完整交接字段：`package_path`、版本号、变更摘要、自测结果与安装包路径）。

---

## 三、开发防坑必查清单

1. **中文输入法选词回车误触陷阱**：`StartFocusModal` 与 `LauncherPage` 均监听键盘 `Enter` 提交，必须严格判断 `!e.isComposing && e.keyCode !== 229`，否则中文拼音输入按空格/回车上屏词组时会意外提前开始专注。
2. **取消不留空记录陷阱**：今日页点「开始专注」打开弹窗时严禁预先创建 `session`；唯有在用户明确触发「开始」（点击按钮或有效回车）时才调用 `startTimer`。
3. **待办小标签点击与回车串扰陷阱**：在 `LauncherPage` 顶部用 `<button type="button">` 渲染待办小标签（切勿用 `type="submit"`），且全局 `keydown` 处理 `Enter` 时若焦点落在待办小标签按钮上，应放行按钮自身语义而不是误触下方空内容表单提交。
4. **旧服务端判断误伤正常启用标签陷阱**：新服务端重新启用标签时，`rawRemoteTag` 具有 `'disabled_at'` 键且值为 `null`，`detectLegacyTagDisableIgnored(rawRemoteTag, false)` 必须返回 `false`；仅当缺少 `'disabled_at'` 键，或 `expectedDisabled === true` 且服务端返回值非数字时才报警。
5. **停用标签过滤遗漏陷阱**：`ModuleTagGroups` 与 `LauncherPage` 必须只消费 `lookup.enabledTags`；如果某待办关联的标签已被停用，其小标签仍应通过 `getTagStyle(td.tag_id, lookup)`（基于 `allTags`）正常展示原标签颜色而不报错，而下方标签选择器只列启用中标签。

---

## 四、PM 五项自查记录

1. **需求覆盖**：用户提出的三点迭代（今日页先填内容选标签再按回车/点开始、灵动胶囊待办简约小标签一键直开 + 一级模块分类填内容选标签、修复标签页停用闪现复原 Bug）及原型确认细节（`C-22`～`C-25`）100% 映射至 T1–T5。
2. **接口一致性**：抽离共享 `ModuleTagGroups` 确保主界面与灵动胶囊时间标签排布逻辑严格一致；`detectLegacyTagDisableIgnored` 与 `/api/health`、`/api/status`、`useAppStore.ts` 对齐。
3. **可执行性**：所有受影响文件路径、窗口尺寸、`data-testid` 规范及依赖顺序列明，开发直接按步落地。
4. **顺序与权限**：`T1(核心纯函数) → T2(服务端能力与集成测) → T3(同步修复与共享组件) → T4(今日页与胶囊界面) → T5(版本对齐与打包自测)` 依赖清晰；全部动作严守工作区及隔离环境红线。
5. **范围与复杂度**：聚焦 3 项小迭代，不扩展未确认能力（如模块停用或改计时卡片换标签逻辑），增量清晰可控。
