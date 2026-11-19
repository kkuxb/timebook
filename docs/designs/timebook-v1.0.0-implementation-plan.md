# 时间簿（Timebook）v1.0.0 实施计划

- **日期 / 版本**：2026-11-19 / `v1.0.0`
- **依据设计**：[v1.0.0 完整版设计方案](timebook-v1.0.0-design.md)（已于 2026-11-19 经用户确认冻结，确认条目 `C-01`～`C-07` 见 [讨论纪要](../requirements/timebook-讨论纪要.md)）
- **本轮授权说明**：前序规划会话已完成需求澄清、设计冻结与本计划自查；下一会话在 `H:/个人项目/timebook` 工作区由 `PM` 直接派单给 `Swarm`（`dev` + `qa`）启动实施。
- **既有成果与边界**：仓库已有 `prototype/*.dc.html`（4 份只读交互原型）、`docs/开发方案.md`、`docs/设计规范.md`、`docs/screenshots/*.png`。`dev` 不得修改 `prototype/` 原件，不得触碰其他项目目录，不得调用 `Notion` 写接口。

---

## 一、文件职责、共用接口合同与依赖顺序

### 1.1 目标仓库目录与文件映射

```text
timebook/
├─ package.json                         # Workspace 根配置与统一脚本 (build, dev, test, release)
├─ pnpm-workspace.yaml                  # 声明 packages/*, tools/*, apps/*
├─ tsconfig.base.json                   # 严格 TypeScript 基类配置
├─ .env.example                         # 环境变量模板 (PORT, DATA_DIR, TIMEBOOK_PASSWORD, TIMEBOOK_SECRET, COOKIE_SECURE)
├─ Dockerfile                           # 多阶段构建 (Node 20 Alpine/Slim，编译 better-sqlite3 并产出单容器镜像)
├─ docker-compose.yml                   # 适配绿联 UGOS Pro (/volume1/docker/timebook/data:/data)
├─ scripts/
│  └─ release_app.py                    # 源码安全扫描与独立发布包构建器 (产出兼容 unpack_verify.py 的 ZIP)
├─ packages/
│  └─ core/                             # @timebook/core：常量、类型、Zod 协议、日期/切分/空档/统计/待办纯函数与单测
│     ├─ package.json
│     ├─ src/
│     │  ├─ palette.ts                  # 8 套模块预设四档色、未分类灰、混白算法
│     │  ├─ types.ts                    # 实体类型、同步与 Mutation Zod Schema
│     │  ├─ time.ts                     # Asia/Shanghai 自然日/周(周一起)/月/年转换与跨零点切分
│     │  ├─ gaps.ts                     # 20 分钟空档合并检测纯函数
│     │  ├─ stats.ts                    # 四周期×双维度汇总、去重专注次数、趋势桶、今日实时概览
│     │  ├─ todos.ts                    # 重复待办命中判定、今日/全部未完成过滤、倒计时文案、已投入时长
│     │  └─ index.ts
│     └─ test/                          # Vitest 单元测试集
├─ tools/
│  └─ notion-import/                    # @timebook/notion-import：CSV 解析、真实 Notion 三表映射、预览对账与单测
│     ├─ package.json
│     ├─ src/
│     │  ├─ csv.ts                      # 支持 BOM、引号内逗号与换行的无依赖 CSV 解析/生成器
│     │  ├─ parser.ts                   # 时间标签(自关联)、专注记录(日历标题优先)、待办(无标签列兼容)解析与问题项分流
│     │  └─ index.ts
│     └─ test/
├─ apps/
│  ├─ api/                              # @timebook/api：Hono + Drizzle + better-sqlite3 服务端
│  │  ├─ package.json
│  │  ├─ src/
│  │  │  ├─ db/schema.ts                # Drizzle SQLite 表定义
│  │  │  ├─ db/client.ts                # 连接初始化、WAL 模式、自动建表/迁移、空库默认四模块种子
│  │  │  ├─ auth.ts                     # 口令校验、HMAC 签名 Cookie (180天, Secure=auto)、IP 登录限流
│  │  │  ├─ sync.ts                     # 单调递增时钟游标、幂等 mutations 事务、删标签级联迁移/保待办逻辑
│  │  │  ├─ import-export.ts            # Notion 批次导入与整批撤销、JSON/CSV 全量导出、30天回收站查询与恢复
│  │  │  ├─ backup.ts                   # 每日 03:00 SQLite 在线备份(留30份) + 每周 JSON 导出调度器
│  │  │  ├─ app.ts                      # Hono 路由组装与静态资源托管 (服务 apps/web/dist)
│  │  │  └─ server.ts                   # Node HTTP 启动入口
│  │  └─ test/                          # API 集成测试 (Vitest)
│  └─ web/                              # @timebook/web：React 18 + Vite + Zustand + Dexie + PWA
│     ├─ package.json
│     ├─ vite.config.ts                 # Vite + vite-plugin-pwa + 开发代理配置
│     ├─ index.html
│     └─ src/
│        ├─ styles/tokens.css           # 严格对应 docs/设计规范.md 的全部颜色、圆角、阴影、动效变量
│        ├─ db/dexie.ts                 # IndexedDB 本机副本表与 pending_mutations 队列
│        ├─ store/useAppStore.ts        # 乐观更新、队列发送与指数退避重试、30s 心跳与聚焦同步、时钟偏差校正
│        ├─ components/                 # 顶栏/底栏导航、四态同步胶囊与详情气泡、开始专注选标弹窗、补录/编辑记录弹窗、设置抽屉
│        └─ pages/                      # LoginPage, TodayPage, CalendarPage, StatsPage, TagsPage
└─ docs/
   └─ 绿联NAS部署指南.md                 # 面向非技术用户的绿联 Docker 项目部署与 Tailscale HTTPS 配置步骤
```

### 1.2 前后端共用数据与接口合同（唯一权威定义）

1. **数据库表结构（`SQLite`，时间戳均为 `UTC` 毫秒整数）**：
   - `modules`: `id TEXT PK (ULID)`, `name TEXT NOT NULL`, `color_key TEXT NOT NULL` (`blue|violet|teal|rose|amber|sky|green|pink`), `sort INTEGER NOT NULL DEFAULT 0`, `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`, `deleted_at INTEGER`
   - `tags`: `id TEXT PK`, `module_id TEXT NOT NULL`, `name TEXT NOT NULL`, `sort INTEGER NOT NULL DEFAULT 0`, `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`, `deleted_at INTEGER`（部分唯一索引：`UNIQUE(module_id, name) WHERE deleted_at IS NULL`）
   - `sessions`: `id TEXT PK`, `tag_id TEXT`（可空=未分类）, `todo_id TEXT`（可空）, `title TEXT`（可空）, `start_at INTEGER NOT NULL`, `end_at INTEGER`（可空=进行中）, `source TEXT NOT NULL`（`timer|manual|import`）, `import_batch TEXT`（可空）, `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`, `deleted_at INTEGER`
   - `todos`: `id TEXT PK`, `title TEXT NOT NULL`, `tag_id TEXT`（可空）, `plan_date TEXT`（`YYYY-MM-DD` 可空）, `due_date TEXT`（`YYYY-MM-DD` 可空）, `recur TEXT`（`JSON` 字符串：`{"freq":"daily"}` | `{"freq":"weekly","days":[1,3,5]}` | `{"freq":"monthly","monthDays":[1,15]}`，为空表示一次性）, `done_at INTEGER`（一次性待办完成时间，可空）, `sort INTEGER NOT NULL DEFAULT 0`, `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`, `deleted_at INTEGER`
   - `todo_checks`: `todo_id TEXT NOT NULL`, `date TEXT NOT NULL`（`YYYY-MM-DD`）, `done_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`, `deleted_at INTEGER`, `PRIMARY KEY (todo_id, date)`
   - `settings`: `key TEXT PK`, `value TEXT NOT NULL`, `updated_at INTEGER NOT NULL`
   - `heartbeat`: `id INTEGER PK CHECK (id = 1)`, `at INTEGER NOT NULL`
   - `applied_mutations`: `mutation_id TEXT PK`, `applied_at INTEGER NOT NULL`（用于 `/api/mutations` 严格幂等去重）

2. **单调游标与同步协议**：
   - 服务端维护进程级单调递增游标函数 `nextCursor()`：`lastCursor = Math.max(Date.now(), lastCursor + 1)`（启动时初始化为数据库全表最大 `updated_at`），保证每一次写入获得的 `updated_at` 严格递增、绝不因同毫秒并发导致增量同步漏数据。
   - `GET /api/sync?since=<number>`：返回 `{ cursor, serverTime, modules, tags, sessions, todos, todoChecks }`（返回所有 `updated_at > since` 的行，包含 `deleted_at != null` 的软删除行；当 `since = 0` 时可排除超过 30 天的已软删行以保持首屏轻快）。
   - `POST /api/mutations`：接收 `{ mutations: MutationItem[] }`，在单个 `SQLite` 事务中依次处理：若 `mutation_id` 已在 `applied_mutations` 中则直接跳过（幂等成功）；支持常规行级操作（`module.upsert`、`tag.upsert`、`session.upsert`、`session.cancel_running`[物理删除未结束计时不进回收站]、`session.delete`[软删除]、`todo.upsert`、`todo.delete`[软删除]、`todo_check.toggle`）以及两个复合级联动作：
     - `tag.delete`: `{ id, mode: 'move' | 'drop', targetTagId?: string }` —— `move` 将未删 `sessions`（含进行中）和 `todos` 的 `tag_id` 改为 `targetTagId` 并软删原事项；`drop` 软删原事项及关联的**已结束** `sessions`，但将关联 `todos` 和**进行中** `sessions` 的 `tag_id` 置为 `null`（转未分类，不删待办与运行中计时）。
     - `module.delete`: `{ id, mode: 'move' | 'drop', targetModuleId?: string }` —— `move` 将该模块下未删事项的 `module_id` 改为 `targetModuleId`（若目标模块已有同名未删事项则合并其 `sessions`/`todos` 到目标同名事项并软删源事项）再软删源模块；`drop` 软删源模块、其下事项及关联已结束 `sessions`，将关联 `todos` 与进行中 `sessions` 的 `tag_id` 置 `null`。
   - 冲突规则：行级比较 `updated_at`，常规 `upsert` 总是写入最新值并赋予新的 `nextCursor()`，响应返回 `{ ok: true, cursor, serverTime }`，客户端随后立即触发一次 `sync(lastCursor)` 拉回权威行状态。

3. **其他核心接口**：
   - `POST /api/login`：`{ password }` → 校验环境变量 `TIMEBOOK_PASSWORD`，每 `IP` 每分钟限 5 次失败（超限返回 `429`）；成功种下 `HMAC-SHA256` 签名 `Cookie`（`tb_session`，`Max-Age=15552000`[180天]，`HttpOnly`，`SameSite=Lax`，`COOKIE_SECURE=auto` 时按请求是否 `https` 或 `x-forwarded-proto === 'https'` 决定 `Secure` 标记）。
   - `POST /api/logout`：清除 `Cookie`。
   - `GET /api/health`：免登录；真实执行 `INSERT INTO heartbeat(id, at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET at=excluded.at` 并回读，成功返回 `200 { ok: true, db: true, serverTime }`，数据库异常返回 `503 { ok: false, db: false, error, serverTime }`。
   - `POST /api/import/notion`：接收前端预览确认后的标准化批次载荷 `{ batchName?, modules, tags, sessions, todos }`，生成唯一 `batchId`（ULID）在单事务内幂等合并同名模块/事项并写入 `sessions(source='import', import_batch=batchId)` 与 `todos`，返回 `{ batchId, importedSessions, importedTodos, cursor }`。
   - `GET /api/import/batches` 与 `DELETE /api/import/:batchId`：列出历史导入批次统计；撤销指定批次时物理删除（或软删除）该 `import_batch` 下的全部 `sessions`，返回新 `cursor`。
   - `GET /api/export?format=json|csv`：`json` 导出全库有效与未过期数据快照；`csv` 导出带 UTF-8 BOM 的专注记录可读明细表（开始时间、结束时间、时长分钟、模块、事项、具体内容、来源）。
   - `GET /api/trash` 与 `POST /api/trash/restore`：查询 `deleted_at` 在最近 30 天内的模块、事项、已结束记录与待办；恢复指定项时清空 `deleted_at` 并更新 `updated_at = nextCursor()`（恢复事项时若所属模块也在软删态则自动一并恢复所属模块；恢复记录时若原事项已删则一并恢复原事项及其模块）。

### 1.3 依赖顺序

`T1 工程骨架与工具链` → 并行可推进 `T2 核心算法库` 与 `T3 Notion 导入引擎` → `T4 Hono+SQLite 服务端` → `T5 Web 外壳与 Dexie 同步层` → `T6 今日页与标签页` → `T7 日历页、统计页、设置抽屉与 PWA` → `T8 容器化、部署指南、发布打包与全链路冒烟`。

---

## 二、分步可执行任务

### 任务 T1：初始化 `pnpm` 单仓工程骨架与开发工具链

- **对应设计要求**：第 3.1 节仓库结构与类型共享基础。
- **文件与资源**：`package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`vitest.config.ts`、`.env.example` 及四个子包目录 `packages/core`、`tools/notion-import`、`apps/api`、`apps/web`。
- **前置与依赖**：无前置任务。**工具链先行探针**：开发机已装 `Node v24+`，全局可能未装 `pnpm`；先运行 `corepack pnpm -v` 或 `npx pnpm@9 -v` 验证可用命令形式（若 `corepack` 受权限限制，直接使用 `npx -y pnpm@9` 或在项目本地调用，不修改系统级目录）。
- **输入与输出**：产出完整可安装依赖的 `workspace` 工程骨架。
- **实施动作**：
  1. 配置 `pnpm-workspace.yaml` 包含 `packages/*`、`tools/*`、`apps/*`。
  2. 配置 `tsconfig.base.json`（`strict: true`、`target: ES2022`、`moduleResolution: bundler`）。
  3. 编写 `.env.example`（含 `PORT=3210`、`DATA_DIR=./workspace-data/dev-db`、`TIMEBOOK_PASSWORD=change-me-please`、`TIMEBOOK_SECRET=change-me-random-secret`、`COOKIE_SECURE=auto`）。
  4. 安装公共开发依赖（`typescript`、`vitest`、`zod`、`date-fns`、`date-fns-tz`、`ulid` 等）。
- **验证**：执行包安装与空测试套件 `vitest run`，退出码为 `0`。
- **完成与阻塞**：所有子包能相互引用 `@timebook/core` 与 `@timebook/notion-import` 即完成；若包注册表网络抖动，检查本机代理或直连重试，连续失败则上报 `@coordinator [blocked]`。

### 任务 T2：实现 `@timebook/core` 纯函数库并通过全边界单元测试

- **对应设计要求**：第 1 节统计口径底线、第 2.2–2.5 节空档/跨天切分/重复待办/配色规范。
- **文件与资源**：`packages/core/src/{palette.ts,types.ts,time.ts,gaps.ts,stats.ts,todos.ts,index.ts}` 及 `packages/core/test/*.test.ts`。
- **前置与依赖**：依赖 `T1`。
- **输入与输出**：纯内存对象输入，确定性计算结果输出，无任何 `I/O` 副作用。
- **实施动作**：
  1. `palette.ts`：录入 `docs/设计规范.md` 第 3 节的 8 套颜色（`blue/violet/teal/rose/amber/sky/green/pink` 的 `color/tint/ink/line`），未分类色 `#B8BDC9`，以及 `mixWithWhite(hex, ratio)` 函数（支持 `0, 0.22, 0.44, 0.66`）。
  2. `time.ts`：基于 `Asia/Shanghai`（固定 `UTC+8`，无夏令时，可用确定性 `+8h` 偏移算术配合 `date-fns` 保证极致性能与跨端一致）实现自然日 `YYYY-MM-DD` 转换、周一为起点的自然周范围、自然月与自然年范围，以及 `splitSessionByDay(session, effectiveEndAt?)`：将跨北京 `00:00` 的记录切分为多段 `{ sessionId, date, startMin, endMin, durationMs }`。
  3. `gaps.ts`：实现 `computeDayGaps(intervals, minGapMinutes = 20)`：对当天记录区间（看今天时包含进行中计时的 `[start, now]`）按开始时间排序合并重叠段后，仅输出相邻合并段之间间隔 `>= 20 分钟` 的空档列表；首段之前与末段之后绝不输出空档。
  4. `stats.ts`：实现：
     - `computeTodayModuleOverview(sessions, tags, modules, todayStr, nowMs)`：包含今日已结束切分片段 **加上** 进行中计时落在今日的实时时长；
     - `computePeriodStats(sessions, tags, modules, period, anchorDateStr, todayStr, dim)`：**仅过滤 `end_at != null && deleted_at == null` 的已结束记录**；计算总时长、上一周期增减对比、日均（若周期包含 `todayStr`，分母取周期首日至 `todayStr` 的已过天数，最小为 1；历史周期取整周期天数）、最高项、**去重独立 `sessionId` 的专注次数**与单次均值、环形图占比列表、趋势桶（日=24小时桶、周=7天桶、月=当月天数桶、年=12月桶）。
  5. `todos.ts`：实现重复规则 `isTodoScheduledOn(todo, dateStr)`（每天/每周几/每月几号，错过轮次不累积）、今日视图列表拼装（未完成且 `plan_date <= today || !plan_date` 的一次性待办 + 今日命中的重复待办 + 今日刚完成的待办置底）、全部未完成视图拼装、截止日期提示文案（`截止 今天` / `还剩 N 天` / `已过期 N 天`）、待办已投入时长（一次性累加全部关联未删记录含进行中；重复待办只算落在 `todayStr` 的关联未删记录含进行中）。
- **验证**：运行 `vitest run packages/core`，必须包含并全绿通过：跨零点 `23:00–01:30` 在两天/跨周/跨月/跨年的时长与去重次数断言、多条重叠记录累加断言、`19 分钟` 空档忽略与 `20 分钟` 空档命中断言、首条前与末条后无空档断言、统计不含进行中但今日概览含进行中断言、重复待办跨日轮次重置断言。
- **完成与阻塞**：单测 100% 通过且零类型错误。

### 任务 T3：实现 `@timebook/notion-import` 真实 `Notion CSV` 解析与对账引擎

- **对应设计要求**：第 2.6 节真实 `Notion` 三表结构导入映射（`C-04`）。
- **文件与资源**：`tools/notion-import/src/{csv.ts,parser.ts,index.ts}` 及 `tools/notion-import/test/notion-import.test.ts`。
- **前置与依赖**：依赖 `T1`、`T2`。
- **输入与输出**：输入用户上传的 1～N 个文件名与文本内容，输出结构化预览报告 `{ modules, tags, validSessions, validTodos, issues, moduleTotals, dateRange }`。
- **实施动作**：
  1. `csv.ts`：剥离 `UTF-8 BOM`，正确解析双引号包裹的跨行字段与转义引号 `""`；同时提供 `toCsv(headers, rows)` 供导出复用。
  2. 自动按表头识别文件类型：
     - 含 `标签` 与 `一级标签` 列 → `时间标签` 表；
     - 含 `开始`、`结束`（及 `日历标题` 或 `专注时长`）列 → `专注记录` 表；
     - 含 `事项` 与 `执行日期`（或 `截止日期`）列 → `待办` 表。
  3. 标签解析：剥离关联列里的 ` (https://...)` 或 ` (http...)` 链接后缀提取纯名称；`一级标签` 为空建模块（默认四模块固定配色：`工作:blue`、`学习:violet`、`游戏:teal`、`锻炼:rose`），非空挂入对应父模块建事项。
  4. 专注记录解析：跳过 `状态` 为 `已取消` 或 `未开始` 的行；支持 `2026年11月18日 12:05`、`2026/11/18 12:05`、`November 18, 2026 12:05 PM (GMT+8)`、`ISO 8601` 等格式（无时区后缀统一按北京时间 `+08:00` 解析）；标题优先取 `日历标题`（为空回退取 `待办` 去链接文本；若标题等于匹配到的二级事项名则置 `null`）；异常行（缺结束时间、结束 `<=` 开始、时长 `> 24h`、无标签、仅命中一级模块或未知标签）生成带行号与原因的 `ImportIssue`，供前端交互决议（跳过 / 设为未分类 / 指定目标事项 / 补填结束时间）后转入有效记录。
  5. 待办解析：`状态 !== 'Done'` 且标题非空的记录转入待导入待办，缺失 `标签` 列时 `tagName = null`。
- **验证**：运行 `vitest run tools/notion-import`，使用还原真实 `Notion` 结构的测试样例（18 行自关联标签、含 `FDE项目开发`/`影之刃零`/`已取消`/无标签/进行中的记录表、无标签列的待办表）验证解析与汇总数字完全准确。
- **完成与阻塞**：单测全部通过。

### 任务 T4：实现 `@timebook/api` 服务端、数据库迁移、幂等同步、回收站与自动备份

- **对应设计要求**：第 1.2 节接口合同、第 3.1–3.2 节服务端与备份安全要求。
- **文件与资源**：`apps/api/src/**` 及 `apps/api/test/api.test.ts`。
- **前置与依赖**：依赖 `T2`、`T3`。
- **输入与输出**：提供完整 `/api/*` `HTTP` 服务及生产模式静态文件服务。
- **实施动作**：
  1. `db/client.ts`：使用 `better-sqlite3` 打开 `${DATA_DIR}/timebook.sqlite`，启用 `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`；启动时自动执行幂等建表脚本；当 `modules` 表总行数为 `0` 时，自动写入默认四模块（`工作/学习/游戏/锻炼`），方便空库即开即用。
  2. `auth.ts`：常量时间比对 `TIMEBOOK_PASSWORD`；签名 `Cookie` 校验中间件保护除 `/api/login`、`/api/health` 与静态资源外的所有 `/api/*` 路由；实现内存滑动窗口登录限流（同 `IP` 60 秒内最多 5 次失败，超限返回 `429`）；实现 `COOKIE_SECURE=auto|true|false` 逻辑。
  3. `sync.ts`：实现单调游标 `nextCursor()`、`GET /api/sync` 与 `POST /api/mutations`（含 `applied_mutations` 幂等去重，以及 `tag.delete` / `module.delete` 在 `move` 与 `drop` 两种模式下的事务级联规则，确保 `drop` 模式保留 `todos` 与进行中 `sessions` 并将其 `tag_id` 置 `null`）。
  4. `import-export.ts`：实现 `POST /api/import/notion`（同名模块/事项自动合并复用）、`GET /api/import/batches`、`DELETE /api/import/:batchId`（整批清理对应 `import_batch` 记录并写入软删记录以便其他已同步客户端通过 `/api/sync` 感知删除！**关键细节**：整批撤销应将这批 `sessions` 标记 `deleted_at = nextCursor()` 软删除，而非静默物理删除，否则其他已缓存全量数据的浏览器增量拉取时不会删掉本地 `IndexedDB` 里的这批记录！同时在回收站查询中过滤掉已撤销的导入批次以免刷屏回收站）、`GET /api/export?format=json|csv`、`GET /api/trash` 与 `POST /api/trash/restore`。
  5. `backup.ts`：提供 `runDailyBackup()`（使用 `better-sqlite3` 原生在线 `.backup()` API 备份至 `${DATA_DIR}/backups/timebook-YYYY-MM-DD.sqlite`，清理超出最近 30 份的旧日备；每周一额外导出一份 `timebook-weekly-YYYY-MM-DD.json`）及后台定时检查器（每小时检查当天 03:00 后是否已备，保证容器重启也不漏备），并记录最近备份时间供设置页读取。
  6. `app.ts`：配置静态文件中间件托管前端构建目录（支持 `SPA` 路由回退 `index.html`）。
- **验证**：运行 `vitest run apps/api`，测试覆盖：口令错误 5 次后第 6 次返回 `429`、登录成功读写、`health` 真实更新 `heartbeat`、同一 `mutationId` 重复提交两次只产生 1 条记录、删标签 `drop` 模式保留待办且清空标签、导入批次后执行 `DELETE /api/import/:batchId` 增量同步能正确收到软删通知、30 天回收站恢复、在线备份生成有效 `.sqlite` 文件。
- **完成与阻塞**：全部接口集成测试通过。

### 任务 T5：实现 `@timebook/web` 主题系统、`Dexie` 离线同步引擎、登录页与导航骨架

- **对应设计要求**：`docs/设计规范.md` 全量视觉令牌、第 2.1 节四栏导航与断联监控四态。
- **文件与资源**：`apps/web/src/styles/tokens.css`、`apps/web/src/db/dexie.ts`、`apps/web/src/store/useAppStore.ts`、`apps/web/src/pages/LoginPage.tsx`、`apps/web/src/components/{AppShell.tsx,SyncStatusPill.tsx}`。
- **前置与依赖**：依赖 `T4`。
- **实施动作**：
  1. `tokens.css`：将 `docs/设计规范.md` 的主操作黄 `#FFD43B`、墨色 `#111827`、提醒橙、危险红、8 套模块色、中性色、圆角、阴影及 `.card`、`.lift`、`.btn`、`.runseg`、`.gapseg`、`prefers-reduced-motion` 完整写成统一 `CSS` 变量与基础类。
  2. `dexie.ts` & `useAppStore.ts`：本地存储 `modules/tags/sessions/todos/todoChecks` 全表副本、`syncCursor` 与 `pendingMutations` 队列；写操作先乐观修改本地 `Dexie` 与内存状态并入队，异步批量 `POST /api/mutations`；失败进入退避重试（`2s → 5s → 15s → 30s`）；前台每 30 秒及 `visibilitychange/focus` 时请求 `/api/health` 与 `/api/sync`，更新 `clockOffsetMs` 并驱动右上角四态样式（`数据已同步` / `正在保存…` / `连接断开 · N 条待保存` / `数据库异常`）及点击详情气泡（上次保存时刻、待发条数、错误摘要、「立即重试」按钮）。
  3. 实现简约高级的口令登录页（未登录或 `401` 时展示，支持错误提示与限流倒计时提示）及主壳（桌面顶部居中四栏分段导航 + 右上角同步胶囊与设置齿轮按钮；`< 768px` 手机视口自动切换为底部固定四栏导航 + 顶部标题栏右侧同步胶囊与设置齿轮）。
- **验证**：`pnpm --filter @timebook/web build` 类型检查与打包零错误；联调后端验证登录、心跳状态切换及断网暂存计数显示。
- **完成与阻塞**：外壳、登录与本地同步状态机稳定工作。

### 任务 T6：实现今日页（多计时并行、待办完整闭环、空档时间线）与标签页

- **对应设计要求**：第 2.2、2.3、2.5 节及交互原型 `Today.dc.html`、`Tags.dc.html`。
- **文件与资源**：`apps/web/src/pages/{TodayPage.tsx,TagsPage.tsx}` 及相关弹窗组件（`TagPickerModal.tsx`、`SessionEditorModal.tsx`、`TodoEditorModal.tsx`、`TagDeleteModal.tsx`）。
- **前置与依赖**：依赖 `T5`。
- **实施动作**：
  1. **今日页**：
     - 顶部日期（黄底线）+ 各模块今日实时用时卡片 + 「开始专注」大黄按钮（点击立即创建进行中记录并打开 `TagPickerModal`，支持「稍后再选」）。
     - 待办区：完成计数徽标 + **「今日 / 全部未完成」切换器** + 右侧回车秒建今日待办输入框；待办卡片支持勾选完成/取消完成、「开始这件事」（直接创建带 `tag_id`、`todo_id`、`title` 的进行中计时，不弹选标框）、点击卡片主体弹出 `TodoEditorModal`（改标题、选事项标签或未分类、设执行计划日、设截止日、选重复规则[不重复/每天/每周几/每月几号]、左下角删除待办）。
     - 专注区：渲染所有 `end_at == null` 的进行中计时卡（模块浅底色、呼吸圆点、`tabular-nums` 每秒刷新计时器、换标签/选标签、编辑可选标题、结束、取消）；手机端（`< 768px`）常驻底部迷你计时条。
     - 时间线卡：`‹ ›` 切换日期（禁切未来）、`0–24h` 比例色条（含橙色斜纹空档块与流动斜纹进行中块）、记录与 `>= 20 分钟` 空档交错列表；点空档或「补记录」打开 `SessionEditorModal`（包含标签分组选择、可选「具体内容」标题输入、今天/昨天/前天快捷日与日期选择器、开始/结束时间及 `±15 分` 微调、`· 次日` 标记、时长校验、重叠温和提示、未分类保存放行、编辑态左下角「删除这条」）。
  2. **标签页**：
     - 模块卡片网格（累计时长、事项数、记录数统计头，事项占比条与次数，悬停显示修改/删除按钮，手机端常显）；
     - 新建/修改模块弹窗（8 色块选择、重色温和提醒、实时胶囊预览）；新建/修改事项弹窗（同模块重名拦截、跨模块移动影响条数提示）；
     - 删除事项/模块确认弹窗（无数据直接删；有数据提供「迁移到另一事项/模块（推荐）」与「连同记录一起删除（保留待办转未分类）」二选一）。
- **验证**：类型检查通过，对照 `prototype/Today.dc.html` 与 `Tags.dc.html` 逐项走通交互。
- **完成与阻塞**：今日页与标签页全部业务分支可正常读写并同步落库。

### 任务 T7：实现日历页、统计页、设置抽屉（`Notion` 导入 / 导出 / 回收站）与 `PWA`

- **对应设计要求**：第 2.1、2.4、2.6 节及交互原型 `Calendar.dc.html`、`Stats.dc.html`。
- **文件与资源**：`apps/web/src/pages/{CalendarPage.tsx,StatsPage.tsx}`、`apps/web/src/components/SettingsDrawer.tsx`、`apps/web/vite.config.ts` 及 `PWA` 图标资源。
- **前置与依赖**：依赖 `T6`。
- **实施动作**：
  1. **日历页**：仅展示已结束记录（跨零点按日切分展示，点击编辑原完整记录）；桌面端 7 天周视图（`06:00–24:00` 网格，`00:00–06:00` 有记录片段时在对应日列顶栏显示可点击提示条；空白处鼠标拖拽 15 分钟吸附生成橙色虚线预览框，松手打开 `SessionEditorModal`，单击默认 1 小时，未来日期禁拖；重叠记录自动分列并排；今日列绘制当前时刻黑点横线）；手机端（`< 768px`）切换为 3 天 / 单日视图 + 顶部「补记录」按钮。
  2. **统计页**：仅统计已结束记录；顶部 `日 / 周 / 月 / 年` 分段切换与 `‹ ›` 周期翻页（禁翻未来）；四张统计卡（总时长及环比差值、日均及计入天数、花得最多、去重独立记录专注次数及单次均值）；「时间花在哪」支持 `模块 / 具体事项` 切换，手写 `SVG` 环形图 + 占比排行条（同模块事项混白深浅，未分类灰色）；右侧按模块分色堆叠柱状趋势图（日=每小时、周/月=每天、年=每月）。
  3. **设置抽屉（`SettingsDrawer`）**：
     - **`Notion` 历史导入向导**：文件多选上传（前端直接调用 `@timebook/notion-import` 解析）→ 展示预览卡片（识别记录数、日期跨度、各模块累计分钟与小时，方便用户与旧 `Notion`「累计」核对）→ 问题项交互列表（支持一键设为未分类、映射到指定事项或跳过该行）→ 点击「确认导入」调用 `POST /api/import/notion` 并刷新本地库；下方列出历史导入批次及「整批撤销」按钮。
     - **数据导出**：下载全量 `JSON` 与明细 `CSV` 按钮，显示服务端最近自动备份时间。
     - **回收站（30 天内已删除）**：按删除时间倒序列出可恢复项，点击「恢复」调用 `/api/trash/restore` 并即时同步。
     - **退出当前设备**：调用 `/api/logout` 清空会话返回登录页。
  4. **`PWA` 配置**：配置 `vite-plugin-pwa`（生成 `manifest.webmanifest`、时间簿黄底时钟矢量/位图图标、静态资源缓存策略，确保 `/api/*` 请求走 `NetworkOnly` 绝不误缓存接口响应）。
- **验证**：`pnpm build` 成功产出 `apps/web/dist`（含 `manifest.webmanifest` 与 `sw.js`）。
- **完成与阻塞**：四主页面、设置抽屉全部功能与 `PWA` 构建齐全。

### 任务 T8：容器化文件、绿联 `NAS` 部署指南、发布打包脚本与端到端冒烟自测

- **对应设计要求**：第 3.2、5 节容器部署、独立发布包规范与 `dev` 移交前自测要求。
- **文件与资源**：`Dockerfile`、`docker-compose.yml`、`docs/绿联NAS部署指南.md`、`scripts/release_app.py`。
- **前置与依赖**：依赖 `T1`–`T7` 全部完成。
- **实施动作**：
  1. 编写多阶段 `Dockerfile`（构建阶段编译前端与后端 `TypeScript`；运行阶段基于 `node:20-bookworm-slim` 保留 `better-sqlite3` 运行依赖，默认监听 `3210` 端口，挂载 `/data`，配置 `HEALTHCHECK` 调用 `http://127.0.0.1:3210/api/health`）与 `docker-compose.yml`（默认映射 `3210:3210`，卷映射 `/volume1/docker/timebook/data:/data`，环境变量 `TIMEBOOK_PASSWORD`、`TIMEBOOK_SECRET`、`TZ=Asia/Shanghai`、`COOKIE_SECURE=auto`）。
  2. 编写 `docs/绿联NAS部署指南.md`：纯中文大白话图文级步骤（① 在绿联 `UGOS Pro` 打开「文件管理」新建 `/volume1/docker/timebook/data`；② 打开「`Docker` → 项目 → 创建」贴入配置设好口令一键启动；③ 局域网先打开浏览器验证登录与导入 `Notion` 历史数据；④ 附 `Tailscale` 零域名免端口映射开启免费 `HTTPS` 并把手机网页「添加到主屏幕」的傻瓜步骤；**注意：文档内使用 `<NAS局域网IP>` 占位符，严禁写入用户真实内网 IP 或账号名**）。
  3. 编写 `scripts/release_app.py`：扫描全部待发布源码与文档（排除 `.git`、`node_modules`、`dist`、`workspace-data`、`.env*`[保留 `.env.example`]、`*.sqlite*`、`*.log`），执行密钥/机器特定绝对路径静态安全检查，生成顶层目录名为 `timebook/` 的 `ZIP` 包，并在包内写入 `timebook/_release-manifest.json`（`{"schemaVersion": 1, "skill": "timebook", "files": {"相对路径": "sha256", ...}}`），输出到 `workspace-data/outputs/timebook/v1.0.0-R<轮次>/timebook.zip`。
  4. **移交前完整自测**：
     - 运行全套单测与集成测试 `pnpm test`；
     - 运行生产构建 `pnpm build`，用临时目录启动生产服务端，验证登录、创建标签/待办/计时、导入测试 `CSV`、导出与健康检查全部正常；
     - 运行 `python scripts/release_app.py build --output workspace-data/outputs/timebook/v1.0.0-R1/timebook.zip`，并用 `fde-qa/scripts/unpack_verify.py` 在临时空目录试解压验证退出码为 `0`（验证后清理自己的临时试解压目录，保留正式发布包）。
- **验证**：`pnpm test` 全绿、`pnpm build` 成功、`unpack_verify.py` 校验 `timebook.zip` 返回 `"ok": true`。
- **完成与阻塞**：自测通过后按 `fde-dev` 规范在 `Swarm` 面板向 `@qa` 发送 `[review_requested]` 及结构化交接清单。

---

## 三、计划五项自查记录

1. **需求覆盖自查**：已逐项核对 [设计方案](timebook-v1.0.0-design.md) 全部条款（`C-01`～`C-06`），四主页面、待办完整编辑与今日/全部切换、右上角四态同步与设置抽屉、真实 `Notion` 三表映射与整批撤销、跨天切分与只算已结束的统计/日历口径、删标签保待办、30 天回收站、每日备份及绿联部署指南均有对应任务与验证。
2. **接口一致性自查**：数据库列名、`GET /api/sync` 单调游标、`POST /api/mutations` 幂等去重与级联动作、导入批次软删同步机制在 `T2/T3/T4/T5` 之间完全对齐，消除了“整批撤销后其他设备本地缓存不消失”的潜在盲点。
3. **可执行性自查**：针对本机全局未装 `pnpm` 安排了 `T1` 的 `corepack/npx` 明确路径；针对非 `Skill` 全栈应用定制了 `100%` 兼容 `unpack_verify.py` 的 `scripts/release_app.py` 协议，无任何空泛占位。
4. **顺序与权限自查**：任务依赖成有向无环图；严格遵守不碰外部工作区、不写 `Notion`、不将真实内网 `IP`/用户名写入仓库文档的权限边界。
5. **范围与复杂度自查**：未引入任何未经确认的功能（如多用户、图表第三方重库、`Tauri` 桌面壳），保持单容器 `SQLite` 最简架构。**结论：可进入实施。**
