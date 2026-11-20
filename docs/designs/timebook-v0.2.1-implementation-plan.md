# 时间簿（Timebook）v0.2.1 实施计划

- **日期 / 版本**：2026-11-20 / `v0.2.1`
- **依据设计**：[v0.2.1 增量设计方案](timebook-v0.2.1-design.md)（已于 2026-11-20 经用户确认冻结，确认条目 `C-18`～`C-21` 见 [讨论纪要第 5 节](../requirements/timebook-讨论纪要.md#5-v021-体验小修迭代讨论与确认记录)）
- **本轮授权终点**：已获授权启动 `Swarm` 团队（`dev` + `qa`）完成实施、全仓自测、构建独立发布包与桌面安装包，并交由 `qa` 执行独立盲测直至可收口或上报。
- **既有基线与红线**：基于已正式收口基线 `v0.2.0`（提交 `1a87cee`）。严禁修改 `prototype/` 原件，严禁触碰用户本机真实 `%APPDATA%` 桌面数据目录或外部 `Notion` 工作区；平常实施与返修轮次不执行 `git commit`。

---

## 一、文件职责、共用接口合同与依赖顺序

### 1.1 修改文件映射

```text
timebook/
├─ package.json                                    # [修改] 版本号升至 0.2.1
├─ packages/
│  └─ core/
│     ├─ src/
│     │  ├─ types.ts                               # [修改] TAG_SCHEMA 与 tag.upsert payload 新增 disabled_at；新增纯函数 isTagDisabled
│     │  ├─ todos.ts                               # [修改] 新增统一排序比较器 compareTodoViewItems 并应用于 getTodayTodos 与 getAllPendingTodos
│     │  ├─ merge.ts                               # [修改] planLocalToRemoteMerge 透传 tag.disabled_at ?? null
│     │  └─ index.ts                               # [核对] 确认 types.ts 与 todos.ts 新增导出自动通过 index.ts 暴露
│     └─ test/
│        ├─ core.test.ts                           # [修改] 补充待办截止日期双视图排序单测与 isTagDisabled 单测
│        └─ merge.test.ts                          # [修改] 补充单机转连合并透传 disabled_at 单测
├─ apps/
│  ├─ api/
│  │  ├─ package.json                              # [修改] 版本号升至 0.2.1
│  │  ├─ src/
│  │  │  ├─ db/
│  │  │  │  ├─ schema.ts                           # [修改] Drizzle tags 表定义增加 disabled_at integer 列
│  │  │  │  └─ client.ts                           # [修改] INIT_SQL tags 增加 disabled_at；启动时检查 PRAGMA table_info(tags) 自动执行 ALTER TABLE 兼容旧库
│  │  │  ├─ sync.ts                                # [修改] tag.upsert SQL 与逻辑支持并兼容 disabled_at（含老版本客户端缺省字段保护）
│  │  │  └─ import-export.ts                       # [修改] exportDatabaseJson 版本号更新为 '0.2.1'（导出完整包含 disabled_at）
│  │  └─ test/
│  │     └─ api.test.ts                            # [修改] 补充旧库无 disabled_at 列自动升级迁移、停用/启用往返同步与导出兼容性集成测试
│  ├─ web/
│  │  ├─ package.json                              # [修改] 版本号升至 0.2.1
│  │  └─ src/
│  │     ├─ styles/
│  │     │  └─ tokens.css                          # [修改] 新增全宽吸顶容器 .tb-header-wrap 与层级规范，微调 .tb-header / .tb-main 上下留白，调整历史行内浮层 z-index
│  │     ├─ db/
│  │     │  └─ dexie.ts                            # [修改] loadLocalSnapshot 读取标签时统一归一化 disabled_at: t.disabled_at ?? null
│  │     ├─ lib/
│  │     │  └─ labels.ts                           # [修改] TagLookup 拆分 allTags / enabledTags / disabledTags / activeTags，tagById 基于 allTags 构建
│  │     ├─ store/
│  │     │  └─ useAppStore.ts                      # [修改] 快照初始化标准化 disabled_at；tag.upsert 透传 disabled_at；新增 setTagDisabled(id, disabled)；托盘 recentTags 过滤停用标签
│  │     ├─ components/
│  │     │  ├─ AppShell.tsx                        # [修改] 网页顶栏外包 .tb-header-wrap 实现全宽半透明吸顶常驻
│  │     │  ├─ DesktopTitlebar.tsx                 # [修改] 桌面定制标题栏增加 position: sticky; top: 0; zIndex: 25
│  │     │  ├─ TagPickerModal.tsx                  # [核对/微调] 确保仅从 lookup.enabledTags 选择
│  │     │  ├─ SessionEditorModal.tsx              # [修改] 选项网格只列 enabledTags；编辑绑定停用标签的旧记录时保留展示当前已选停用标签（带标记）
│  │     │  ├─ TodoEditorModal.tsx                 # [修改] 选项列表只列 enabledTags；编辑绑定停用标签的旧待办时保留展示当前已选停用标签（带标记）
│  │     │  ├─ TagDeleteModal.tsx                  # [修改] 支持删除已停用标签；删除一级模块时 modTagIds 从 lookup.allTags 收集；迁移候选仅列 enabledTags
│  │     │  └─ SettingsDrawer.tsx                  # [修改] 单机 JSON 导出版本号更新为 '0.2.1'
│  │     └─ pages/
│  │        ├─ TagsPage.tsx                        # [修改] 事项行新增「停用」按钮、仅展示启用项并基于启用项重算模块汇总与占比；页头新增「已停用」按钮与弹窗（含一键重新启用及删除）；重名校验提示已停用同名冲突
│  │        ├─ HistoryPage.tsx                     # [修改] TagHierarchyMenu 仅列 enabledTags；顶部筛选下拉保留「已停用事项」分组；修正行内浮层 zIndex: 30
│  │        └─ LauncherPage.tsx                    # [修改] 常用推荐标签仅从 enabledTags 选取，排除已停用标签
│  └─ desktop/
│     ├─ package.json                              # [修改] 版本号升至 0.2.1
│     └─ src-tauri/
│        ├─ Cargo.toml                             # [修改] version = "0.2.1"
│        └─ tauri.conf.json                        # [修改] version = "0.2.1"
```

---

### 1.2 跨组件共用接口合同（唯一权威定义）

1. **标签停用字段与判定函数（`@timebook/core` `types.ts`）**：
   ```ts
   export const TAG_SCHEMA = z.object({
     id: z.string().min(1),
     module_id: z.string().min(1),
     name: z.string().min(1),
     sort: z.number().int(),
     created_at: z.number().int(),
     updated_at: z.number().int(),
     deleted_at: z.number().int().nullable(),
     disabled_at: z.number().int().nullable().optional(),
   });

   export function isTagDisabled(
     tag: Pick<TagEntity, 'disabled_at'> | null | undefined,
   ): boolean {
     return typeof tag?.disabled_at === 'number';
   }
   ```
   - `MUTATION_ITEM_SCHEMA` 中 `'tag.upsert'` 的 `payload` 新增 `disabled_at: z.number().int().nullable().optional()`；
   - **必须使用 `isTagDisabled(tag)`（或 `typeof tag.disabled_at === 'number'`）判断停用状态，严禁直接写 `tag.disabled_at !== null`**（防止未传键的老对象 `undefined !== null` 误判为已停用）。

2. **待办统一排序合同（`@timebook/core` `todos.ts`）**：
   ```ts
   export function compareTodoViewItems(a: TodoViewItem, b: TodoViewItem): number {
     if (a.done !== b.done) return a.done ? 1 : -1;
     const da = a.todo.due_date;
     const db = b.todo.due_date;
     if (da !== db) {
       if (da === null) return 1;
       if (db === null) return -1;
       return da.localeCompare(db);
     }
     if (a.todo.created_at !== b.todo.created_at) {
       return b.todo.created_at - a.todo.created_at;
     }
     return a.todo.id.localeCompare(b.todo.id);
   }
   ```
   - `getTodayTodos` 与 `getAllPendingTodos` 末尾统一使用 `items.sort(compareTodoViewItems)`。

3. **前端标签查找表合同（`apps/web/src/lib/labels.ts`）**：
   ```ts
   export interface TagLookup {
     activeModules: ModuleEntity[];
     allTags: TagEntity[];       // 未删且所属模块未删的全量标签（含已停用）
     enabledTags: TagEntity[];   // allTags 中 !isTagDisabled(t)
     disabledTags: TagEntity[];  // allTags 中 isTagDisabled(t)
     activeTags: TagEntity[];    // 等同 enabledTags（向后兼容现有选择器）
     moduleById: Map<string, ModuleEntity>;
     tagById: Map<string, TagEntity>; // 基于 allTags 构建，确保已停用标签的记录与统计正常显示
   }
   ```

4. **状态层动作合同（`apps/web/src/store/useAppStore.ts`）**：
   ```ts
   setTagDisabled: (id: string, disabled: boolean) => Promise<void>;
   ```
   - 实现要求：在 `get().tags` 查找未删除的目标标签，若不存在则直接返回；构造 `disabled_at: disabled ? get().nowMs() : null`，调用 `await get().upsertTag({ ...tag, disabled_at })` 统一走 `enqueueMutation('tag.upsert')`；
   - `upsertTag` 与 `applyOptimisticMutation` 内的 `'tag.upsert'` 必须完整透传 `disabled_at: p.disabled_at ?? null`。

---

## 二、分步实施任务与验证要求（依赖顺序：`T1 → T2 → T3 → T4 → T5`）

### 任务 T1：`@timebook/core` 模型扩展、待办排序重构与合并透传
- **对应设计**：2.2（`C-19`）、2.3.1（`C-20`）。
- **文件与动作**：
  1. 修改 `packages/core/src/types.ts`：`TAG_SCHEMA` 与 `MUTATION_ITEM_SCHEMA` `'tag.upsert'` 增加 `disabled_at` 可空可选校验；导出 `isTagDisabled`。
  2. 修改 `packages/core/src/todos.ts`：实现并导出 `compareTodoViewItems`；同时替换 `getTodayTodos`（原第 167–171 行）和 `getAllPendingTodos`（原第 204–209 行）的排序回调。
  3. 修改 `packages/core/src/merge.ts`：在 `planLocalToRemoteMerge` 处理 `local.tags` 时，生成 `remappedTag` 与 `tag.upsert` `payload` 时透传 `disabled_at: tag.disabled_at ?? null`。
  4. 在 `packages/core/test/core.test.ts` 与 `packages/core/test/merge.test.ts` 新增单元测试：
     - 验证 `getTodayTodos` 与 `getAllPendingTodos` 在混合「未完成/已完成、过期/今天/未来截止、多条无截止（不同创建时间）、相同截止日（不同创建时间）」场景下排序 100% 精准；
     - 验证 `isTagDisabled` 对 `undefined`、`null`、`number` 的判定；
     - 验证 `planLocalToRemoteMerge` 对已停用标签（`disabled_at !== null`）的透传合并。
- **验证**：`corepack pnpm --filter @timebook/core test` 100% 通过。

### 任务 T2：`@timebook/api` 数据迁移、同步兼容性与测试
- **对应设计**：2.3.1（`C-20`）。
- **前置**：T1 完成。
- **文件与动作**：
  1. 修改 `apps/api/src/db/schema.ts`：`tags` 表增加 `disabled_at: integer('disabled_at')`。
  2. 修改 `apps/api/src/db/client.ts`：`INIT_SQL` 的 `tags` 建表包含 `disabled_at INTEGER`；在 `createDatabase` 中仿照既有 `todos.import_batch` 的迁移模式，查询 `PRAGMA table_info(tags)`，若不包含 `'disabled_at'` 列则执行 `sqlite.exec('ALTER TABLE tags ADD COLUMN disabled_at INTEGER')`。
  3. 修改 `apps/api/src/sync.ts`：
     - `upsertTagStmt` 调整为支持 `disabled_at`：
       - 若 `p.disabled_at === undefined`（老版客户端或未带字段调用），当数据库已存在该 `id` 时保留原行 `disabled_at` 值（或 SQL `CASE WHEN ? THEN ...` / 查询已有值回退），不存在时为 `NULL`；
       - 若显式传 `null` 或整数时间戳，直接更新写入 `disabled_at`。
  4. 修改 `apps/api/src/import-export.ts`：`exportDatabaseJson` 返回体 `version` 升级为 `'0.2.1'`；复核 `listTrashItems` 与 `restoreTrashItem` 确认已停用标签可正常被软删与恢复且原样保留 `disabled_at`。
  5. 修改 `apps/api/test/api.test.ts`：新增集成测试：
     - 先用旧版无 `disabled_at` 列的建表 SQL 在临时目录建库写入标签与记录，再调用 `createDatabase` 打开，验证自动补列且存量标签 `disabled_at === null`；
     - 同步提交 `tag.upsert` 停用（`disabled_at: 1700000100000`）→ `/api/sync` 拉取核验 → 再提交 `tag.upsert` 重新启用（`disabled_at: null`）→ 核验回归启用态；
     - 验证同模块下不允许新建与已停用标签同名的事项（返回 `409`）；
     - 验证停用标签名下的记录在 `/api/export?format=json` 与 `/api/export?format=csv` 中完整保留原标签名。
- **验证**：`corepack pnpm --filter @timebook/api test` 100% 通过。

### 任务 T3：`@timebook/web` 底层状态规范化与顶部导航吸顶改造
- **对应设计**：2.1（`C-18`）、2.3.1、2.3.2。
- **前置**：T1 完成。
- **文件与动作**：
  1. 修改 `apps/web/src/db/dexie.ts`：`loadLocalSnapshot()` 读取 `tags` 时对每条记录统一映射 `{ ...t, disabled_at: t.disabled_at ?? null }`。
  2. 修改 `apps/web/src/lib/labels.ts`：实现拆分后的 `TagLookup`（`allTags`、`enabledTags`、`disabledTags`、`activeTags = enabledTags`、`tagById` 基于 `allTags`）。
  3. 修改 `apps/web/src/store/useAppStore.ts`：
     - 初始化加载桌面本地快照及 `dedupeDuplicateModules` 后同步归一化 `tags` 的 `disabled_at: t.disabled_at ?? null`；
     - `applyOptimisticMutation('tag.upsert')` 与 `upsertTag` 透传 `disabled_at: p.disabled_at ?? null`；
     - 实现并导出 `setTagDisabled(id, disabled)`；
     - 更新 `persistDesktopDiskAndTray` 中提取 `recentTags` 的逻辑，改为在 `lookup.enabledTags`（即 `!isTagDisabled(tag)`）范围内选取最多 5 个常用事项。
  4. 修改 `apps/web/src/styles/tokens.css`、`AppShell.tsx`、`DesktopTitlebar.tsx`：
     - `tokens.css` 新增 `.tb-header-wrap`：
       ```css
       .tb-header-wrap {
         position: sticky;
         top: 0;
         z-index: 25;
         width: 100%;
         background: rgba(246, 247, 250, 0.92);
         backdrop-filter: blur(10px);
         border-bottom: 1px solid rgba(232, 234, 241, 0.88);
       }
       ```
       同步将桌面宽屏 `.tb-header` `padding` 调整为 `14px 40px`，`.tb-main` `padding` 调整为 `20px 40px 64px`；手机端 `@media (max-width: 767px)` 下 `.tb-header` `padding` 调整为 `10px 16px`，`.tb-main` `padding` 调整为 `14px 16px 128px`。
     - `AppShell.tsx`：在 `!isDesktop` 分支中用 `<div className="tb-header-wrap" data-testid="web-header-sticky">` 包裹 `<header className="tb-header">`；
     - `DesktopTitlebar.tsx`：在 `<header className="tb-desktop-titlebar">` 内联样式补充 `position: 'sticky', top: 0, zIndex: 25`。

### 任务 T4：「标签」页停用/启用管理与全站联动改造
- **对应设计**：2.3.3、2.3.4。
- **前置**：T3 完成。
- **文件与动作**：
  1. 修改 `apps/web/src/pages/TagsPage.tsx`：
     - 注入 `setTagDisabled = useAppStore((s) => s.setTagDisabled)`，新增状态 `disabledModalOpen: boolean`；
     - 页头右侧由单按钮改为按钮组：次级按钮「已停用」（`data-testid="open-disabled-tags-btn"`，含已停用数量角标）+ 原「新建模块」按钮；
     - 每个模块卡片仅过滤出 `lookup.enabledTags.filter((t) => t.module_id === mod.id)`（列表、卡片顶部「累计 / 事项 / 记录」三项与各行 `pct` 全部只算启用中事项）；
     - 每个事项行尾新增「停用」按钮（`data-testid="disable-tag-${t.id}"`，使用直观图标如圆圈斜杠/暂停眼，`aria-label="停用事项 ${t.name}"`，`title="停用事项（不影响历史记录与统计）"`，带 `act` 类悬停显示、手机常显），点击直接调用 `void setTagDisabled(t.id, true)`；
     - 新增/编辑事项重名检测（`tagDup`）：同时比对 `lookup.allTags`，拆分是否命中已停用重名（`tagDupDisabled`），文案区分「这个模块里已经有同名的已停用事项，可以直接去「已停用」列表重新启用」与「这个模块里已经有同名事项了」；编辑弹窗提交保存时透传原 `tagModal.disabledAt ?? null`（不误清空字段）；
     - 新增「已停用事项」弹窗（`data-testid="disabled-tags-modal"`）：按 `lookup.activeModules` 分组展示所有 `lookup.disabledTags`（每项显示历史累计时长与次数），提供 **「重新启用」**（`data-testid="enable-tag-${t.id}"`，点击调用 `void setTagDisabled(t.id, false)`）与 **「删除」**（`setDelTarget({ kind: 'tag', id: t.id })`）按钮；注意弹窗层级确保 `z-index: 40`，若从弹窗点删除触发 `TagDeleteModal`（同为 `z-index: 40`，后挂载在 DOM 末尾自然覆盖在前者之上，或打开删除前先关闭/后恢复，推荐保持独立或先设 `delTarget` 后在确认删除时平滑工作）。
  2. 修改 `apps/web/src/components/SessionEditorModal.tsx` 与 `TodoEditorModal.tsx`：
     - 选项区展示 `lookup.enabledTags`；
     - 计算 `selectedTag = tagId ? lookup.tagById.get(tagId) : undefined`；若 `selectedTag && isTagDisabled(selectedTag)`，在选项区上方额外显示一行「当前关联（已停用）」的选中态标签按钮（保留 `tagId` 不丢失，点击「保存」可原样保存原 `tagId`）。
  3. 修改 `apps/web/src/components/TagDeleteModal.tsx`：
     - 删除对象查找 `obj` 改用 `lookup.tagById.get(target.id)`；
     - 删除一级模块时 `modTagIds` 改为从 `lookup.allTags` 收集（覆盖该模块下已停用标签）；
     - 迁移候选 `candidates` 保持只展示 `lookup.enabledTags`（即 `lookup.activeTags`）。
  4. 修改 `apps/web/src/pages/HistoryPage.tsx`：
     - `TagHierarchyMenu` 仅展示 `lookup.enabledTags`（即 `lookup.activeTags`）；
     - 顶部筛选 `<select data-testid="history-tag-filter">` 各模块分组仅列 `lookup.enabledTags`，并在末尾当 `lookup.disabledTags.length > 0` 时追加 `<optgroup label="已停用事项">`，逐条渲染 `<option value={`tag:${t.id}`}>· ${mod.name} · ${t.name}（已停用）</option>`；
     - 行内标签浮层（原 `zIndex: 25`）调升至 `zIndex: 30`，防止紧贴顶栏边缘时与吸顶导航平级冲突。
  5. 修改 `apps/web/src/pages/LauncherPage.tsx`：
     - 常用标签过滤逻辑确保仅选取 `enabledTags`（`!isTagDisabled(tag)`）。
  6. 修改 `apps/web/src/components/SettingsDrawer.tsx`：
     - 单机本地 JSON 导出对象的 `version` 同步更新为 `'0.2.1'`。
  7. 检查确认 `TodayPage.tsx`、`CalendarPage.tsx`、`StatsPage.tsx`、`WidgetPage.tsx`、`TagPickerModal.tsx`、`packages/core/src/stats.ts`、`packages/core/src/history.ts`：核对无多余过滤停用标签的地方，统计/展示/检索继续完整保留已停用标签，而 `TagPickerModal` 自动通过 `activeTags === enabledTags` 隐藏已停用标签。

### 任务 T5：版本号 `0.2.1` 对齐、全仓自测、打包与移交 `QA`
- **对应设计**：3、4。
- **前置**：T1–T4 全部完成。
- **文件与动作**：
  1. 将 `package.json`、`apps/api/package.json`、`apps/web/package.json`、`apps/desktop/package.json`、`apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/tauri.conf.json` 的 `version` 统一升级为 `0.2.1`。
  2. 执行全仓验证（全部须 100% 通过）：
     - `corepack pnpm typecheck`
     - `corepack pnpm test`
     - `corepack pnpm build`
     - `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
     - `corepack pnpm desktop:build`（真实编译出 `0.2.1` 桌面执行文件与 NSIS 安装包）
  3. 确认独立隔离下简单冒烟无报错后，构建交付包：
     - 运行 `python scripts/release_app.py build --output workspace-data/outputs/timebook/v0.2.1-R1/timebook.zip`
     - 将真实编译产出的 `apps/desktop/src-tauri/target/release/timebook-desktop.exe` 与 `apps/desktop/src-tauri/target/release/bundle/nsis/*-setup.exe` 复制留档到 `workspace-data/outputs/timebook/v0.2.1-R1/installers/`
     - 在 Swarm 共享面板发送 `@qa [review_requested]` 移交评审（附完整交接字段）。

---

## 三、开发防坑必查清单

1. **旧数据缺失 `disabled_at` 键的判别陷阱**：旧版 `timebook-local.json` 与老版客户端可能不含 `disabled_at` 字段（值为 `undefined`）。严禁写 `tag.disabled_at !== null` 来判断停用，必须统一使用 `@timebook/core` 导出的 `isTagDisabled(tag)`（`typeof tag?.disabled_at === 'number'`），并在加载快照和 `upsertTag` 时归一化为 `null`。
2. **`tagById` 误过滤导致旧记录变「未分类」陷阱**：`buildTagLookup` 中 `activeTags`（供选择器用）只含启用项，但 **`tagById` 必须包含全部未删的 `allTags`（含已停用）**，否则已停用标签的历史记录会在今日时间线、日历、历史列表和导出中全部退化成「未分类」。
3. **删除模块遗漏已停用子标签陷阱**：在 `TagDeleteModal.tsx` 与服务端/Store `module.delete` 处理中，必须基于 `allTags`（`deleted_at === null`，不按 `disabled_at` 过滤）收集归属标签并执行迁移或级联软删，否则会出现残留孤儿标签；同时删除二级标签时的迁移目标候选列表仅列 `enabledTags`。
4. **吸顶顶栏破坏页面滚动与日历坐标系陷阱**：务必采用视口级 `position: sticky; top: 0; z-index: 25`，切勿在 `AppShell` 中强行设定 `height: 100vh; overflow: auto` 造成嵌套滚动容器，否则会影响桌面拖拽选区与浏览器原生滚动还原；并确认 `z-index` 顺序（顶栏 `25` < 历史行内浮层 `30` <= 手机底栏 `30` < 历史批量栏 `35` < 居中弹窗 `40` < 右侧抽屉 `50`）。

---

## 四、PM 五项自查记录

1. **需求覆盖**：用户确认的 3 项小修及 `C-18`～`C-21` 细则（网页/桌面顶栏吸顶且不增待办入口、待办双视图截止时间统一排序、标签页停用与启用弹窗、占比重算、全站联动与兼容迁移）均逐一拆解到 T1–T5，无任何遗漏。
2. **接口一致性**：`@timebook/core` 的 `isTagDisabled`、`compareTodoViewItems` 与 `apps/api`、`apps/web` 的消费方式一一对齐；复用既有 `tag.upsert` 同步通道，不引入冗余协议。
3. **可执行性**：所有受影响文件路径、字段名、SQL 迁移方式与 `data-testid` 约定全部基于现有真实代码核实，无猜测占位。
4. **顺序与权限**：`T1(核心纯函数) → T2(服务端与老库迁移) → T3(底层状态与吸顶) → T4(标签页与全站联动) → T5(版本打包自测)` 依赖严密；全部工作局限在项目目录与隔离临时环境，绝不碰用户真实数据与 `Notion`。
5. **范围与复杂度**：严守局部小修尺度，仅扩展 1 个可空字段与 1 个统一排序函数，不擅自加开关、不做未确认的顶栏入口或模块停用功能。
