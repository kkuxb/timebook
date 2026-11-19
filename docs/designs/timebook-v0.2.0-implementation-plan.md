# 时间簿（Timebook）v0.2.0 实施计划

- **日期 / 版本**：2026-11-19 / `v0.2.0`
- **依据设计**：[v0.2.0 迭代设计方案](timebook-v0.2.0-design.md)（已于 2026-11-19 经用户确认冻结，确认条目 `C-13`～`C-17` 见 [讨论纪要第 4 节](../requirements/timebook-讨论纪要.md)）
- **本轮授权终点**：已获授权在本会话直接启动 `Swarm`（`dev` + `qa`）完成实施、打包与独立盲测，直至 `qa` 评审通过后交由 `PM` 与用户验收。
- **既有基线与边界**：基于已正式收口基线 `v0.1.0`（提交 `8b9c3a2`）。严禁修改 `prototype/` 原件，严禁破坏一期/二期既有核心功能（统计、日历、待办、`NAS` 同步、桌面四部件、旧 `Service Worker` 自愈机制），严禁触碰用户真实本机时间簿数据目录或外部 `Notion` 工作区。

---

## 一、文件职责、共用接口合同与依赖顺序

### 1.1 新增、修改与移除文件映射

```text
timebook/
├─ package.json                                    # [修改] 版本号升至 0.2.0
├─ pnpm-workspace.yaml                             # [修改] 移除已下线的 "tools/*" 工作区声明
├─ Dockerfile                                      # [修改] 移除 tools/notion-import 相关 COPY 步骤
├─ vitest.config.ts                                # [修改] 移除 @timebook/notion-import 别名与 tools/* 测试匹配
├─ tools/notion-import/                            # [删除] 按 C-13 整体下线移除（csv.ts / index.ts / parser.ts / test / package.json / tsconfig.json）
├─ packages/
│  └─ core/
│     ├─ src/
│     │  ├─ csv.ts                                 # [新增] 迁入轻量标准 CSV 生成纯函数 toCsv（供全量 CSV 导出复用）
│     │  ├─ history.ts                             # [新增] 历史模块时间范围计算、一二级标签/未分类筛选与多词搜索纯函数
│     │  ├─ time.ts                                # [修改] 新增今日页自适应起点时间横条纯函数 resolveTodayTimelineAxis
│     │  └─ index.ts                               # [修改] 统一导出 csv.ts、history.ts 及 resolveTodayTimelineAxis
│     └─ test/
│        ├─ core.test.ts                           # [修改] 补充 resolveTodayTimelineAxis 与 toCsv 确定性单元测试
│        └─ history.test.ts                        # [新增] 历史时间预设/自定义区间/跨零点交集/一二级标签/搜索与 3700+ 条基准单测
├─ apps/
│  ├─ api/
│  │  ├─ package.json                              # [修改] 移除 @timebook/notion-import 依赖，版本号对齐 0.2.0
│  │  ├─ src/
│  │  │  ├─ app.ts                                 # [修改] 移除 /api/import/notion、/api/import/batches、DELETE /api/import/:batchId 路由
│  │  │  └─ import-export.ts                       # [修改] 改为从 @timebook/core 引用 toCsv；移除 Notion 批次导入/撤销函数，简化 listTrashItems；导出版本号升为 0.2.0
│  │  └─ test/
│  │     └─ api.test.ts                            # [修改] 将原 Notion 导入测试替换为“/api/import/notion 已下线返回 404 + 存量 source='import' 记录零损同步/导出/回收站回归测试”
│  ├─ web/
│  │  ├─ package.json                              # [修改] 移除 @timebook/notion-import 依赖，版本号对齐 0.2.0
│  │  ├─ vite.config.ts                            # [修改] 移除 @timebook/notion-import 路径别名
│  │  └─ src/
│  │     ├─ lib/
│  │     │  └─ desktopBridge.ts                    # [修改] broadcastState 支持携带轻量 runningSessions 快照与 clockOffsetMs 实现跨窗零 IO 秒推
│  │     ├─ store/
│  │     │  └─ useAppStore.ts                      # [修改] NavTab 增加 'history'；乐观更新后第一时间直推跨窗 runningSessions（不等落盘）；新增 batchUpdateSessions / batchDeleteSessions 单事务批处理动作
│  │     ├─ components/
│  │     │  ├─ AppShell.tsx                        # [修改] 网页顶栏与手机底栏升级为五栏「今日 · 日历 · 历史 · 统计 · 标签」
│  │     │  ├─ DesktopTitlebar.tsx                 # [修改] 桌面定制顶栏升级为五栏导航
│  │     │  └─ SettingsDrawer.tsx                  # [修改] 彻底移除「从 Notion 导入历史数据」区块与依赖，保留桌面设置、备份导出与回收站
│  │     ├─ pages/
│  │     │  ├─ TodayPage.tsx                       # [修改] 接入 resolveTodayTimelineAxis 实现默认 8-24 点及 6-24 / 0-24 点自适应时间横条与早间扩展底纹
│  │     │  ├─ HistoryPage.tsx                     # [新增] 历史模块完整页面（实时汇总、8 档时间筛选、一二级标签筛选、搜索、倒序分页、行内直改标签/标题/起止时间、新增/删除、多选与跨页全选批量栏）
│  │     │  └─ WidgetPage.tsx                      # [修改] 接收进行中状态变化时立即同步 setNowTick(nowMs())，读数定时器优化为 250ms 消除首秒 00:00:00 滞后
│  │     └─ App.tsx                                # [修改] 挂载 activeTab === 'history' 渲染 <HistoryPage />，订阅跨窗快速状态直推
│  └─ desktop/
│     ├─ package.json                              # [修改] 版本号对齐 0.2.0
│     └─ src-tauri/
│        ├─ Cargo.toml                             # [修改] version = "0.2.0"
│        ├─ tauri.conf.json                        # [修改] version = "0.2.0"
│        └─ src/
│           ├─ lib.rs                              # [修改] 修复 desktop_save_snapshot 无条件重写备份问题（仅当 last_local_backup_date != Some(&today) 时写每日备份）；补充对应 Rust 单测
│           └─ tray.rs                             # [修改] 托盘点击「一键开始最近常用事项」时若 widget 应可见则同步立即唤醒显示小窗
├─ README.md                                       # [修改] 同步 v0.2.0 五栏导航与历史模块特性、移除 Notion 导入说明
└─ docs/
   ├─ Windows桌面版使用说明.md                      # [修改] 同步 v0.2.0 覆盖安装说明、历史模块与新特性，移除 Notion 导入段落
   └─ 绿联NAS部署指南.md                            # [修改] 移除第三步中的 Notion CSV 导入引导，更新为日常使用与备份验证指引
```

---

### 1.2 跨组件共用接口合同（唯一权威定义）

1. **今日页自适应时间横条合同（`@timebook/core`）**：
   ```ts
   export interface TodayTimelineAxis {
     startMin: number;          // 480 (08:00) | 360 (06:00) | 0 (00:00)
     endMin: 1440;              // 固定 24:00
     spanMin: number;           // 1440 - startMin (960 | 1080 | 1440)
     ticks: number[];           // 小时刻度数组：[8,12,16,20,24] | [6,12,18,24] | [0,6,12,18,24]
     hasEarlyExtension: boolean;// startMin < 480 时为 true
     earlyBoundaryMin: 480;     // 08:00 分界分钟数，供渲染 8 点前浅底区分层
   }
   export function resolveTodayTimelineAxis(
     segments: ReadonlyArray<{ startMin: number; endMin: number }>,
   ): TodayTimelineAxis;
   ```
   - 规则：过滤 `endMin > startMin` 的有效当日片段；若为空或最小 `startMin >= 480`，返回 `startMin = 480, ticks = [8, 12, 16, 20, 24]`；若 `360 <= minStartMin < 480`，返回 `startMin = 360, ticks = [6, 12, 18, 24]`；若 `minStartMin < 360`，返回 `startMin = 0, ticks = [0, 6, 12, 18, 24]`。

2. **历史模块筛选、搜索与汇总合同（`@timebook/core`）**：
   ```ts
   export type HistoryTimePreset =
     | 'all'
     | 'today'
     | 'yesterday'
     | 'this_week'
     | 'last_week'
     | 'this_month'
     | 'last_month'
     | 'custom';

   export type HistoryTagFilter =
     | { kind: 'all' }
     | { kind: 'unclassified' }
     | { kind: 'module'; moduleId: string }
     | { kind: 'tag'; tagId: string };

   export interface HistoryFilterInput {
     preset: HistoryTimePreset;
     todayStr: string;          // 北京时间当前自然日 'YYYY-MM-DD'
     customStart?: string;      // 'YYYY-MM-DD'
     customEnd?: string;        // 'YYYY-MM-DD'
     tagFilter: HistoryTagFilter;
     query: string;             // 搜索词（空白忽略，多词按空格切分全部命中）
   }

   export interface HistoryFilterResult {
     items: SessionEntity[];    // 已结束且未软删的完整原始记录，按 start_at DESC, end_at DESC 排序
     totalCount: number;        // 命中总条数
     totalDurationMs: number;   // 命中记录的 (end_at - start_at) 累计总毫秒数
     rangeStartMs: number | null;
     rangeEndMs: number | null;
   }
   ```
   - 时间窗口规则（固定北京时间 `Asia/Shanghai`，自然周从周一起）：
     - `all`：`rangeStartMs = null, rangeEndMs = null`（不限时间）；
     - `today`：`[shanghaiDateStartMs(todayStr), +DAY_MS)`；
     - `yesterday`：`[shanghaiDateStartMs(addDays(todayStr, -1)), +DAY_MS)`；
     - `this_week`：`getPeriodRange('week', todayStr, 0)` 的 `[startMs, endMs)`；
     - `last_week`：`getPeriodRange('week', todayStr, -1)` 的 `[startMs, endMs)`；
     - `this_month`：`getPeriodRange('month', todayStr, 0)` 的 `[startMs, endMs)`；
     - `last_month`：`getPeriodRange('month', todayStr, -1)` 的 `[startMs, endMs)`；
     - `custom`：若 `customStart` 与 `customEnd` 均有效（若 `customEnd < customStart` 自动交换起止），取 `[shanghaiDateStartMs(minDate), shanghaiDateStartMs(maxDate) + DAY_MS)`；仅填 `customStart` 则 `>= startMs`；仅填 `customEnd` 则 `< endMs`；均为空则等同 `all`。
     - 区间命中判据：当存在边界时，要求 `s.end_at! > rangeStartMs`（若有下界）且 `s.start_at < rangeEndMs`（若有上界）。
   - 标签与关键词匹配：
     - `unclassified`：`s.tag_id === null` 或找不到未软删对应标签；
     - `module`：记录关联的活跃标签 `tag.module_id === moduleId`；
     - `tag`：`s.tag_id === tagId`；
     - `query`：按空白切分为小写词组 `tokens`，每条记录拼出可检索文本 `${s.title ?? ''} ${tagName} ${moduleName}`（无有效标签时含 `'未分类'`），所有 `token` 均为其子串即命中。

3. **跨窗口进行中状态直推合同（`desktopBridge.ts` ↔ `useAppStore.ts`）**：
   ```ts
   export interface FastStateBroadcastPayload {
     revision: number;
     sourceWindow: DesktopWindowKind;
     instanceId: string;
     runningSessions?: SessionEntity[];
     clockOffsetMs?: number;
   }
   ```
   - 收到 `state-updated` 时：若载荷带有 `runningSessions`，目标窗口（如 `widget`）**立即同步更新** `sessions` 中的运行态集合（合并保留已有已结束记录并替换全部未结束记录为 `runningSessions`）与 `clockOffsetMs`，使 `WidgetPage` 在同一事件循环微任务内重渲染，随后再异步调用 `syncFromBridgeUpdate()` 对齐完整快照。

4. **批量修改与批量删除动作合同（`useAppStore.ts`）**：
   ```ts
   batchUpdateSessions: (
     ids: string[],
     patch: { tag_id?: string | null; title?: string | null },
   ) => Promise<void>;
   batchDeleteSessions: (ids: string[]) => Promise<void>;
   ```
   - 单次生成对应的 `MutationItem[]` 数组，一次性计算内存 `sessions` 新数组并 `set(...)`，一次性 `localDb.sessions.bulkPut(...)`；单机桌面模式下仅触发 **1 次** `persistDesktopDiskAndTray`；连接 `NAS` / 网页模式下一次性 `localDb.pendingMutations.bulkAdd(...)`，并在 `flushPendingQueue` 中按每批最多 `300` 条切分提交 `/api/mutations`，绝不逐条循环发起请求。

---

## 二、分步实施任务与验证要求（依赖顺序：`T1 → T2 → T3 → T4/T5 → T6`）

### 任务 T1：核心纯函数扩展（`csv.ts`、`history.ts`、`resolveTodayTimelineAxis`）与单元测试
- **对应设计**：2.1（历史筛选搜索口径）、2.3（今日自适应时间横条）、2.4（`toCsv` 迁入核心包）。
- **文件与动作**：
  1. 新建 `packages/core/src/csv.ts`，实现标准 RFC 4180 兼容 `toCsv(headers, rows, withBom = false)`（含双引号转义、逗号/换行包裹及可选 `\uFEFF` UTF-8 BOM）。
  2. 在 `packages/core/src/time.ts` 实现 `resolveTodayTimelineAxis`。
  3. 新建 `packages/core/src/history.ts`，实现 `resolveHistoryTimeRange` 与 `filterHistorySessions`。
  4. 在 `packages/core/src/index.ts` 导出上述全部类型与函数。
  5. 在 `packages/core/test/core.test.ts` 与新建 `packages/core/test/history.test.ts` 编写完整单测：覆盖 `8-24` 默认态、`6-24` 早起态、`0-24` 凌晨跨零点态；覆盖今日/昨日/本周/上周/本月/上月/自选日期（含起止反填容错）、跨零点记录边界交集、一级模块/二级事项/未分类筛选、多关键词搜索，以及 **3,750 条记录过滤耗时 `< 50ms`** 性能断言。
- **验证**：运行 `corepack pnpm --filter @timebook/core test` 全部通过。

### 任务 T2：彻底下线 `tools/notion-import` 与后端导入路由，保持存量数据 100% 兼容
- **对应设计**：2.4（`C-13`）。
- **前置**：T1 完成（`@timebook/core` 已导出 `toCsv`）。
- **文件与动作**：
  1. 删除 `tools/notion-import/` 整个目录（若空目录 `tools/` 无其他内容一并移除）。
  2. 更新 `pnpm-workspace.yaml`（去掉 `"tools/*"`）、`Dockerfile`（去掉 `tools/notion-import` 的全部 `COPY` 行）、`vitest.config.ts`（去掉 `@timebook/notion-import` 别名与 `tools/*/test`）、`apps/web/vite.config.ts`（去掉 `@timebook/notion-import` 别名）、`apps/api/package.json` 与 `apps/web/package.json`（移除 `@timebook/notion-import` 依赖）。
  3. 修改 `apps/api/src/import-export.ts`：改为从 `@timebook/core` 导入 `toCsv`；删除 `IMPORT_PAYLOAD_SCHEMA`、`importNotionBatch`、`listImportBatches`、`undoImportBatch`；`listTrashItems` 移除对已撤销导入批次的判断，保持模块/事项/专注记录/待办 30 天软删恢复正常；`exportDatabaseJson` 中 `version` 更新为 `'0.2.0'`。
  4. 修改 `apps/api/src/app.ts`：删除 `POST /import/notion`、`GET /import/batches`、`DELETE /import/:batchId` 路由。
  5. 修改 `apps/api/test/api.test.ts`：验证 `POST /api/import/notion` 与 `GET /api/import/batches` 返回 `404`；新增存量兼容回归断言——向数据库写入 `source = 'import'` 且带 `import_batch = 'legacy-batch-1'` 的历史记录，验证 `/api/sync`、`/api/export?format=json`、`/api/export?format=csv` 及软删除后 `/api/trash` 恢复均 100% 正常无报错。
- **验证**：运行 `corepack pnpm install` 更新锁文件后，`corepack pnpm --filter @timebook/api test` 100% 通过。

### 任务 T3：灵动胶囊零延迟起跳修复、状态层单事务批处理与 `Rust` 备份去重
- **对应设计**：2.1.5（批量同步）、2.2（`C-14` 灵动胶囊延后起跳根治）。
- **文件与动作**：
  1. `apps/desktop/src-tauri/src/lib.rs`：在 `desktop_save_snapshot` 中先检查 `cfg.last_local_backup_date.as_deref() != Some(&today)`，**仅当当天尚未备份时**才调用 `run_local_backup` 并更新配置；补充 `Rust` 单元测试证明同日连续多次调用快照保存不会重复覆盖备份文件（手动调用 `desktop_run_local_backup` 仍可强制刷新）。
  2. `apps/desktop/src-tauri/src/tray.rs`：在点击 `start_tag:<id>` 菜单事件时，若 `DesktopState.config` 中 `widget_visible == true`，同步直接对 `widget` 窗口调用 `let _ = win.show();` 立即唤醒小窗，再向 `main` 发送 `timebook://tray-quick-start`。
  3. `apps/web/src/lib/desktopBridge.ts`：`broadcastState` 扩充参数支持传入 `runningSessions` 与 `clockOffsetMs`，在 `BroadcastChannel` 与 `tauri::emit('timebook://state-updated')` 中一并携带；`onStateUpdated` 回调签名改为 `(fastPayload?: FastStateBroadcastPayload) => void`。
  4. `apps/web/src/store/useAppStore.ts`：
     - 新增辅助方法 `emitFastRunningBroadcast()`：提取当前内存未删除且 `end_at === null` 的 `runningSessions` 立即调用 `void desktopBridge.broadcastState(...)`；
     - 在 `enqueueMutation`、`batchUpdateSessions`、`batchDeleteSessions` 中，一旦 `set({ ...patch })` 完成，**第一行立即调用 `emitFastRunningBroadcast()`**（绝不等待 `dbTasks` 或 `persistDesktopDiskAndTray`）；且若 `wakeWidgetIfRunning` 为真且当前有运行中计时，立即先行触发 `void desktopBridge.setWidgetVisibility(true)`；
     - 新增 `applyFastRunningFromBridge(payload)`：收到跨窗广播时先毫秒级合并 `runningSessions` 到内存状态，再后台执行 `syncFromBridgeUpdate`；
     - 实现 `batchUpdateSessions` 与 `batchDeleteSessions` 单事务批处理（`flushPendingQueue` 中按 `300` 条每批分片提交 `/api/mutations`）。
  5. `apps/web/src/pages/WidgetPage.tsx`：
     - 监听 `runningTimers` 签名变化（如 `runningTimers.map(r => `${r.id}:${r.start_at}`).join('|')`），变化瞬间立即同步调用 `setNowTick(nowMs())`；
     - 将定时刷新间隔从 `1000ms` 改为 `250ms`，确保后台无焦点下秒表跳动零滞后。
- **验证**：`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` 全部通过。

### 任务 T4：「今日」页自适应起点时间横条改造
- **对应设计**：2.3（`C-15`）。
- **前置**：T1 完成。
- **文件与动作**：
  - 修改 `apps/web/src/pages/TodayPage.tsx`：
    - 调用 `const axis = resolveTodayTimelineAxis(daySegments);`；
    - 当 `axis.hasEarlyExtension` 为 `true` 时，在比例条左侧 `[axis.startMin, 480]` 区间渲染一层温和的浅灰斜纹/微深底色（如 `repeating-linear-gradient(135deg, rgba(17,24,39,0.03) 0 4px, transparent 4px 8px)` + 右边框 `1px dashed #D5D9E2`），带 `data-testid="timeline-early-zone"` 便于自动化核验；
    - 空档条（`gaps`）与专注段（`daySegments`）统一按 `((Math.max(axis.startMin, startMin) - axis.startMin) / axis.spanMin) * 100%` 计算 `left` 与 `width`（带 `data-testid="today-timeline-bar"` 与 `data-axis-start={axis.startMin}`）；
    - 底部时间刻度按 `axis.ticks` 动态渲染（日常为 `8 · 12 · 16 · 20 · 24`，早起为 `6 · 12 · 18 · 24`，凌晨为 `0 · 6 · 12 · 18 · 24`）。
- **验证**：前端类型检查与构建零错误，核验无记录/9 点记录/`06:30` 记录/`01:00` 记录四种状态下的刻度与色块比例。

### 任务 T5：五栏导航、「历史」模块完整页面（`HistoryPage.tsx`）与设置抽屉精简
- **对应设计**：2.1（`C-16`）、2.4（`C-13`）。
- **前置**：T1、T2、T3 完成。
- **文件与动作**：
  1. `AppShell.tsx`、`DesktopTitlebar.tsx`、`useAppStore.ts`、`App.tsx`：主导航升级为五栏 `[{ id: 'today', label: '今日' }, { id: 'calendar', label: '日历' }, { id: 'history', label: '历史' }, { id: 'stats', label: '统计' }, { id: 'tags', label: '标签' }]`；手机底部导航微调内边距与字号保证 375px 窄屏五栏单行工整显示。
  2. `SettingsDrawer.tsx`：彻底删除「从 `Notion` 导入历史数据」区块及 `@timebook/notion-import` 相关全部状态与方法，保持桌面设置、备份与 `JSON`/`CSV` 导出、30 天回收站恢复、网页退出登录干净完整。
  3. 新建 `apps/web/src/pages/HistoryPage.tsx`（严格遵循 `docs/设计规范.md` 圆角、色板、阴影与等宽数字规范）：
     - **页头区**：左侧大标题「历史」+ 实时统计胶囊（`共 X 条 · 合计 Y`，绑定 `data-testid="history-summary"`），右侧 `「+ 新增记录」` 主色按钮（打开 `SessionEditorModal` 新建模式）；
     - **筛选与搜索工具卡**：
       - 第一行：时间预设分段胶囊（`全部时间`、`今日`、`昨日`、`本周`、`上周`、`本月`、`上月`、`自选范围`）；选 `自选范围` 时同行平滑展示开始日期与结束日期输入框；
       - 第二行：一二级标签层级筛选器（下拉或弹出筛选面板，含 `全部标签`、`未分类`、各活跃一级模块「`模块：工作`」及缩进的二级事项「`· 淘教`」）+ 实时关键词搜索框（占位符：`搜索标题、事项或模块…`，含清空按钮）+ 当存在任意非默认筛选时显示「重置筛选」按钮；
     - **列表与行内轻点直改**：
       - 表头栏：全选本页复选框 + 列提示；当筛选总条数 `> visibleItems.length` 且当前已加载项全被勾选时，展示醒目提示条：「已勾选当前展示的 X 条记录 · **全选筛选出的全部 N 条记录**」；
       - 每一行（跨零点记录完整展示为 1 行，跨次日标注 `+1 天`）：
         - **复选框**：支持单点勾选与 `Shift` 连选；
         - **标签胶囊**：点击该胶囊即在当前行弹出轻量标签浮层（含「未分类」与按模块分组的全部事项），点击任一选项立即调用 `updateSession` 保存并收起；
         - **标题内容**：点击文字原地切换为输入框（预填原 `title ?? ''`），按 `Enter` 或失焦立即保存（空字符串存为 `null`），按 `Esc` 取消；
         - **日期与起止时间**：点击日期或时间段原地切换为行内时间编辑组（`date` 输入 + 开始 `time` + 结束 `time` + 跨日提示 + 「保存 / 取消」），校验时长合法（`> 0` 且 `<= 24h`）后调用 `updateSession` 保存；
         - **时长与单行删除**：等宽字体显示该条真实总时长，右侧提供「删除」按钮（软删除）。
       - **分页加载**：默认渲染前 `50` 条，列表底部显示 `已显示 X / 共 N 条` 与「加载更多（每次 +50 条）」按钮。
     - **底部悬浮多选批量操作栏**（`selectedIds.size > 0` 时固定浮现）：
       - 显示 `已选 N 条`、「取消选择」；
       - **「批量改标签」**：展开标签选择浮层，点选后调用 `batchUpdateSessions(ids, { tag_id })`；
       - **「批量改标题」**：展开标题输入浮层，输入新标题点「应用修改」调用 `batchUpdateSessions(ids, { title: trimmed || null })`，并提供快捷按钮「清空独立标题」一键置 `null`；
       - **「批量删除」**：轻量内联确认（避免浏览器原生 `window.confirm` 在无头测试或定制窗口被拦截！）点「确认删除」后调用 `batchDeleteSessions(ids)` 并清空选中集。
- **验证**：`corepack pnpm typecheck` 与 `corepack pnpm build` 100% 零报错通过。

### 任务 T6：版本号 `0.2.0` 对齐、文档同步、桌面端真实打包自测与独立发布包构建
- **对应设计**：1、2.4.3、3、4。
- **文件与动作**：
  1. 将根 `package.json`、`apps/api/package.json`、`apps/web/package.json`、`apps/desktop/package.json`、`apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/tauri.conf.json` 版本号统一更新为 `0.2.0`。
  2. 同步更新 `README.md`、`docs/Windows桌面版使用说明.md`、`docs/绿联NAS部署指南.md`、`AGENTS.md`（仅移除已下线的 `tools/notion-import` 描述并补充历史模块说明，不改核心铁律）。
  3. 全仓自测验证：
     - `corepack pnpm test`（全仓 Vitest 单元测试 100% 通过）；
     - `corepack pnpm typecheck` 与 `corepack pnpm build`（核心、后端、前端 PWA 产物构建 100% 通过）；
     - `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`（Rust 原生测试 100% 通过）；
     - `corepack pnpm desktop:build`（真实编译产出 `0.2.0` 版 `timebook-desktop.exe` 与 NSIS `-setup.exe` 安装包，并在带 `TIMEBOOK_DESKTOP_DATA_DIR` 隔离目录 + `--minimized` 或后台 `CDP` 模式下快速冒烟验证五栏导航、历史模块与胶囊同步）。
  4. 构建交付包：
     - 运行 `python scripts/release_app.py build --output workspace-data/outputs/timebook/v0.2.0-R1/timebook.zip`；
     - 将编译产出的 `timebook-desktop.exe` 与 `*-setup.exe` 复制留档至 `workspace-data/outputs/timebook/v0.2.0-R1/installers/`；
     - 在 Swarm 面板发送 `@qa [review_requested]` 完整交接。

---

## 三、计划五项自查记录（PM 已完成）

1. **需求覆盖**：四项用户需求与确认条目 `C-13`～`C-17`（历史模块筛选/搜索/行内直改/批量三操作、灵动胶囊延后起跳三层根治、今日 8–24 点自适应时间横条、彻底下线 `Notion` 导入并保住存量数据）均已精确落实到 T1–T6 及验证命令，无遗漏。
2. **接口一致性**：`@timebook/core` 导出的 `resolveTodayTimelineAxis`、`filterHistorySessions`、`toCsv` 与 `apps/api`、`apps/web` 消费签名完全一致；`desktopBridge` 跨窗直推字段与 `useAppStore`、`WidgetPage` 一致；批量删除采用内联确认按钮，避免原生弹窗阻塞测试。
3. **可执行性**：所有受 `tools/notion-import` 下线影响的配置文件（`pnpm-workspace.yaml`、`Dockerfile`、`vitest.config.ts`、`apps/web/vite.config.ts`）均已通过全仓搜索逐一定位列明，无模糊占位或未知外部探针。
4. **顺序与权限**：严格遵循 `T1(核心纯函数) → T2(清理导入模块) → T3(底层状态与原生修复) → T4/T5(页面改造) → T6(打包自测)` 依赖顺序；全程在项目目录与 `workspace-data/` 隔离目录执行，零外部副作用。
5. **范围与复杂度**：未引入任何新外部重型依赖库或冗余框架，批量修改直接复用既有幂等 `/api/mutations` 通道分片提交，复杂度与目标严格相称。
