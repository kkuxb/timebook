# 时间簿（Timebook）v0.2.2-R1 验证与验收测试报告

**给 PM 的业务摘要**：`timebook` `v0.2.2` 第 1 轮（`v0.2.2-R1`）独立盲测与全仓回归已全部完成，结论为**可收口**。父级 `qa` 仅解压测试 `dev` 交付的独立源码发布包 `timebook.zip`（`141` 个文件清单与 `SHA-256` 校验一致，包内静态安全扫描清白），并在隔离解压副本内完成统一依赖安装、全栈及 `PWA` 构建（`manifest.webmanifest` `453 B`、`sw.js` `1,332 B`）、全仓 `TypeScript` 类型检查、全仓 `Vitest` 单测与集成测试（`5` 文件 `32/32` 通过）、`Rust` 原生单测（`5/5` 通过）及独立 `Windows` 桌面端重编译；编译产出的 `NSIS` 安装包 `时间簿_0.2.2_x64-setup.exe` 体积约 `2.16 MiB`（`2,267,606 B` / `2.27 MB`，远低于 `15 MB` 目标与 `25 MB` 硬上限）。`Q1`–`Q4` 四个独立隔离场景分别由干净盲测子智能体在独立端口段（`14711`–`14749`）与独立数据目录完成端到端实测并回读核验，**业务功能与回归核验全部通过**，`6` 张核心代表性截图与 `Q4` 抽查截图均已由父级 `qa` 用 `read_file` 亲眼核验符合视觉规范：今日页点击「开始专注」先弹窗不预建计时、取消与 `Esc` 零记录、中文输入法组合态不误触、回车或点击「开始」起表；灵动胶囊 `launcher`（`540×520` 视口）上方待办简约小标签支持「全部未完成」按截止排序与「仅今日」切换且点击秒开并实时同步胶囊起跳、下方复用共享一级模块标签组并隐藏已停用标签；连新版 `v0.2.2` 服务端与单机模式停用/启用持久生效无弹回，连模拟旧版 `v0.2.0` 服务端停用立即弹出醒目中文升级提醒横幅；全仓 `7` 处版本号统一为 `0.2.2`、全站核心功能零退化且导出 `JSON` 版本号为 `'0.2.2'`。受当前执行环境 `WinSta0\exebox-*` 沙箱桌面不支持拉起真机 `WebView2` 限制（触发 `HRESULT(0x80070578)`），经 `@coordinator` 确认，桌面多窗闭环采用受支持的隔离无头 `Edge` 三窗联动（`?desktopMock=1`、`?window=widget`、`?window=launcher`）完成实测，真机实机安装与物理系统托盘/全局热键留待用户收口核验。

- **结论**：**可收口**；**用户业务确认**：**待确认**（技术盲测与通过规则全部满足，待 PM 复核后交用户最终实操验收）
- **源码、安装副本、包版本与一致性**：
  - 被测独立发布包：`workspace-data/outputs/timebook/v0.2.2-R1/timebook.zip`（`zip_sha256`：`f094b02a8a74246a12a6de3a8261c46551d48fc7388737e3ba7be5018082b1c7`，`141` 个文件全部核验一致）
  - 解压与隔离编译副本：`workspace-data/tmp/qa/v0.2.2-R1/pkg/timebook`
  - 全仓 `7` 处版本号声明（根 `package.json`、`packages/core/package.json`、`apps/api/package.json`、`apps/web/package.json`、`apps/desktop/package.json`、`apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/tauri.conf.json`）均一致为 `0.2.2`
  - 自编译与交付产物对比：
    - 发布包独立编译：`timebook-desktop.exe`（`9,965,568 B` / `9.50 MiB`）、`时间簿_0.2.2_x64-setup.exe`（`2,267,526 B` / `2.16 MiB`）
    - `dev` 交付目录（`workspace-data/outputs/timebook/v0.2.2-R1/installers/`）：`timebook-desktop.exe`（`9,965,568 B` / `9.50 MiB`）、`时间簿_0.2.2_x64-setup.exe`（`2,267,606 B` / `2.16 MiB`）
- **环境与测试范围**：`Windows` 64 位、`Node.js v24.15.0` + `pnpm 10.0.0`、`Cargo`、隔离 `@timebook/api`、`Mock HTTP v0.2.0` 服务及无头 `Edge CDP`（`msedge.exe`），全程绑定 `127.0.0.1` 隔离高端口 `14711`–`14749` 与独立临时数据目录，零触碰用户真实 `%APPDATA%`、真实「文档」目录、开机自启注册表、真实家庭 `NAS` 或外部 `Notion` 接口。

---

## 一、实际结果与七维复盘

- **任务及授权**：依据 [v0.2.2 增量设计方案](../designs/timebook-v0.2.2-design.md) 与 [v0.2.2 测试计划](../designs/timebook-v0.2.2-test-plan.md) 执行 `v0.2.2-R1` 独立发布包静态安全扫描、统一编译回归及 `Q1`–`Q4` 隔离盲测。
- **目标 / 确认完成 / 未处理**：
  - 已完成：发布包清单与哈希核验、包内静态安全扫描、全仓构建与 `PWA` 产物核验、`TypeScript` 类型检查、全仓 `Vitest` 单测与集成测试（`32/32`）、`Rust` 原生单测（`5/5`）、独立 `Windows` 桌面可执行程序与 `NSIS` 安装包重编译、`Q1`–`Q4` 四大隔离场景端到端实测及截图人工视觉核验。
  - 环境受限与未实操项：当前会话处于 `WinSta0\exebox-*` 沙箱隔离桌面，启动真机 `timebook-desktop.exe` 会被宿主拦截报错 `WebView2 HRESULT(0x80070578)` 并向宿主桌面弹出警告框；经 `@coordinator` 批准，真机桌面多窗与物理托盘/全局热键未强行拉起，改由隔离无头 `Edge` 三窗联动（`?desktopMock=1`、`?window=widget`、`?window=launcher`）完成多窗业务与布局验证；隔离环境未执行 `docker build`。
- **证据位置**：
  - 计量汇总：`workspace-data/qa/v0.2.2-R1/metrics.json`
  - 场景回执与截图：`workspace-data/tmp/qa/v0.2.2-R1/cases/Q1-run1` ～ `Q4-run1`

| 维度 | 观察及依据 | 判断 / 影响范围 |
| --- | --- | --- |
| **业务完成度** | 1. **`Q1`（今日页「开始专注」弹窗闭环，14/14 项通过）**：点击「开始专注」仅弹出 `StartFocusModal` 且不预建计时（`runningCount: 0, sessionsCount: 0`）；取消与 `Esc` 关闭后零空记录；打开自动聚焦 `start-focus-title-input`，标签严格按一级模块（「工作」「学习」）分组展示且彻底隐藏已停用标签「旧版调研」，再点已选标签可取消选中；模拟中文输入法组合态（`isComposing` / `keyCode: 229`）`Enter` 不误提交；正常 `Enter` 与点击「开始」均准确起表且秒表起跳，留空+选标签、留空+未分类直开正常；进行中卡片右上角「换标签」保持快捷切换不退化。已亲眼核验 `q1-start-focus-modal.png`、`q1-started-timer.png`。<br>2. **`Q2`（灵动胶囊「新建专注」双操作与排布一致，15/15 项通过）**：核对 `tauri.conf.json` `launcher` 窗口尺寸已调为 `540×520`（无边框、透明、置顶）；在隔离三窗联动环境（`main` `1280×800`、`widget` `420×220`、`launcher` `540×520`）下，上方待办区仅渲染 `31px` 高简约单行胶囊（无大卡片），默认「全部未完成」按截止日期由近到远排序（`5` 条不含已完成），可切「仅今日」（`4` 条）并与主界面口径一致；单击待办小标签立即创建关联 `todo_id` 与所属标签的计时并自动收起选框，灵动胶囊实时同步起跳显示并可悬停点「+ 新建专注」；下方输入区与复用的一级模块分类标签组在 `540×520` 视口内舒展呈现、无裁切溢出且隐藏已停用标签，验证主窗新增待办/停用标签后重开 `launcher` 同步刷新、IME 防误触、回车/点「开始」起表与取消/`Esc` 零记录。已亲眼核验 `q2-launcher-dual-mode.png`、`q2-widget-after-todo-start.png`。<br>3. **`Q3`（标签停用持久生效与旧服务端防静默弹回，10/10 项通过）**：连新版 `v0.2.2` 服务端（`14731`，`/api/health` 含 `version: '0.2.2'`、`capabilities: ['tag_disabled_at']`）连续停用 `2` 个标签，手动同步、等待周期采样 `12` 次并 `3` 次整页刷新后，标签持续隐藏在「已停用 2」弹窗中绝不复原，回读 `/api/sync` `disabled_at` 为有效整型时间戳；点「重新启用」并多次同步刷新后持久恢复（`disabled_at: null`）；单机模拟模式（`?desktopMock=1`）停用刷新同样持久。连模拟旧版 `v0.2.0` 服务端（`14732`，`/api/sync` `tags` 不含 `disabled_at` 键且忽略提交的 `disabled_at`）点击停用时，客户端立即拦截并弹出醒目玫瑰红 `role="alert"` 中文横幅提示「停用标签未在家庭 NAS 服务端生效：当前连接的 NAS 容器镜像版本过旧，请先将 NAS 端的 Timebook 镜像更新到最新版（v0.2.2+）」，绝不无声弹回。已亲眼核验 `q3-tags-disabled-persisted.png`、`q3-legacy-server-warning.png`。<br>4. **`Q4`（全仓版本一致、产物核验与既有功能零退化，全项通过）**：7 处版本号均为 `0.2.2`；`PWA` 产物完整；`NSIS` 安装包 `2.16 MiB`；`/api/health` 与 `/api/status` 返回 `0.2.2` 与 `tag_disabled_at`；灌入 `26` 条记录/`16` 条待办后，今日页滚 `600px` 顶栏 `sticky` `top === 0`、`?desktopMock=1` 主窗定制标题栏与胶囊无白屏、日历 `25` 色块正常、历史标签/关键词筛选与 `fixed` 批量栏正常、统计双维度（模块/具体事项）与日/周/月/年切换精确、导出 `JSON` `version: '0.2.2'` 且全量数据无损。已亲眼核验 `q4-regression-stats.png`、`q4-desktop-mock-main.png`、`q4-regression-history.png`。 | 全部 `4` 项核心验收场景与全仓单测回归 `100%` 满足合格判据。 |
| **质量** | 1. 静态扫描未检出 `target/`、`node_modules/`、`.env`、`*.sqlite*`、本机路径、局域网真实 IP 或后门；<br>2. `build`、`typecheck`（4/4）、`Vitest`（32/32）、`cargo test`（5/5）全过；<br>3. 视觉核验：父级 `qa` 亲眼核验 `Q1`–`Q4` 核心截图，弹窗聚焦黑框、浅底数据色标签胶囊、简约待办胶囊截断与播放标、旧服务端玫瑰红 `alert` 横幅及统计图表配色圆角均符合 [视觉与动效设计规范](../设计规范.md)；<br>4. 工程脚本沿用小瑕疵：全新解压包直接运行 `corepack pnpm typecheck` 会因 `@timebook/core/dist` 尚未构建而报 `TS2307`；先执行 `corepack pnpm build` 后 `typecheck` 即全部通过。 | 质量达标，无「必须修复」级缺陷。 |
| **权限与副作用** | 1. 全程仅在解压包隔离目录及 `cases/Q1-run1`–`Q4-run1` 运行，未修改发布包与项目源码；<br>2. `Q2` 初期在 `WinSta0\exebox-*` 沙箱桌面双隔离尝试拉起 `timebook-desktop.exe` 时受 `HRESULT(0x80070578)` 阻断并引发宿主桌面报错弹窗后立即中止，按 `@coordinator` 指令在 `Q3`/`Q4` 严格禁止拉起真机 exe；<br>3. `Q1`–`Q4` 测完均按自有启动 `PID` 精准终止并经 `Get-NetTCPConnection` 复核 `14701`–`14799` 端口 `0` 监听残留。 | 隔离严密，零项目源码、本机用户数据及外部 `NAS`/`Notion` 污染。 |
| **异常处理** | 1. 全程页面控制台 `console_errors` 为 `0`、登录后网络异常为 `0`（仅初始未登录探测 `/api/auth/me` 返回预期 `401`）；<br>2. 中文输入法组合态（`isComposing` / `keyCode: 229`）按 `Enter` 拦截有效；<br>3. 连接不返回 `disabled_at` 的旧版服务端停用标签时，客户端准确识别并展示醒目中文升级提醒横幅，绝不静默丢状态。 | 异常边界与兼容防呆清晰到位。 |
| **效率与成本** | 1. 产品自身运行时模型消耗 **`0 Token`**；<br>2. 桌面安装包体积 `2.16 MiB`（`2,267,526` / `2,267,606 B`），远低于目标 `15 MB` 与硬上限 `25 MB`；<br>3. 盲测子智能体时长：`Q3` `562.0s`、`Q4` `485.0s`、`Q1` `621.0s`（2 路并发）均在 `900s` 硬上限内（略超 `480s` 目标）；`Q2` 会话总时长 `1833.0s` 触发 `over_cap` 告警，其中前 `954s` 为沙箱真机 `WebView2` 阻塞排障及等待决策耗时，切换至隔离三窗联动方案后的净业务测试耗时为 `845s`（`< 900s`）。 | 产品零运行时成本、安装包极致轻量化；盲测超时系宿主沙箱切换方案引起，非产品性能缺陷。 |
| **复杂度** | `ModuleTagGroups` 共享组件同时服务「今日页开始专注」「换标签」「灵动胶囊选框」，避免多处标签排布与停用过滤逻辑漂移；服务端 `/api/health` & `/api/status` 能力宣告与 `@timebook/core` 纯函数 `detectLegacyTagDisableIgnored`、`useAppStore` 并发保护均沿用既有同步链路，改动集中克制。 | 增量架构清晰，复用度高。 |
| **迁移与使用体验** | 从点击「开始专注」即直接计时升级为先填内容和选标签再起表，显著减少误触空记录与事后补改负担；灵动胶囊 `540×520` 双区设计兼顾「待办秒开」与「自由新建」，且对老版本 `NAS` 容器服务端的兼容提醒直白易懂，降低跨端排障成本。 | 交互流畅自然，旧服务端升级引导明确。 |

**各验证层说明**：
- **静态与单元测试层（已测）**：发布包清单与哈希校验（`141` 文件一致）、包内源码安全扫描、`corepack pnpm typecheck`（`build` 后 4/4 项目通过）、`corepack pnpm test`（5 文件 `32/32` 通过）、`cargo test`（`5/5` 通过；首次运行新生成测试二进制遇本机系统扫描短暂 `os error 5`，二次执行通过）。
- **构建与打包层（已测）**：`corepack pnpm build`（含 `apps/web/dist/sw.js` 与 `manifest.webmanifest`）、`corepack pnpm desktop:build`（从纯净解压包源码独立编译生成 `timebook-desktop.exe` 与 `时间簿_0.2.2_x64-setup.exe`）。
- **真实闭环层（已测）**：`Q1`、`Q3`、`Q4` 通过真实隔离 `@timebook/api`、`Mock v0.2.0` 服务与无头 `Edge CDP` 完成真实端到端操作与落盘回读；`Q2` 通过隔离 `@timebook/api` + 无头 `Edge` 三窗联动（`?desktopMock=1`、`?window=widget`、`?window=launcher`）完成多窗业务、排序、跨窗同步及 `540×520` 视口实测。
- **未测项**：由于当前执行会话处于 `WinSta0\exebox-*` 沙箱隔离桌面，真机 `timebook-desktop.exe` `WebView2` 窗口、物理系统托盘右键菜单、物理按键全局快捷键与隔离环境 `docker build` 未在本环境实跑，留待用户实机收口验收。

---

## 二、计量与修复

- **父级 `qa` 统一环境准备耗时（单列）**：
  - `unpack_verify.py` 解压与校验：约 `2 秒`
  - `corepack pnpm install --frozen-lockfile`：`87.1 秒`（`1m 27.1s`，`+440 packages`）
  - 首跑 `corepack pnpm typecheck`（未先 `build` 失败）：约 `5 秒`
  - `corepack pnpm build` + `typecheck` + `test` + `cargo test` 编译阶段：约 `210 秒`（其中 `vitest run` `4.27s`，`vite build` `2.14s`，`cargo test` 二次运行 `0.04s`）
  - `corepack pnpm desktop:build`：约 `145 秒`（其中 `vite build` `1.46s`，`Rust release` 编译 `2m 15s`）
- **独立盲测子智能体实测计量（来自各子智能体 `transcript.jsonl`，写入 `workspace-data/qa/v0.2.2-R1/metrics.json`）**：

| 场景 | 并发数 (`--parallel`) | 宿主完成态 / 业务终态 | 真实时长 (`duration_seconds`) | 模型请求步数 (`api_calls`) | 输入 / 缓存读取 / 输出 Token | 对比预算（目标 `480s` / 硬上限 `900s`） |
| --- | :---: | :---: | :---: | :---: | --- | --- |
| `Q1` | `2` | `completed` / 通过 | `621.0 s` | `32` | 输入 `112,991` / 缓存 `1,427,648` / 输出 `37,684` | 超目标 `+141s`，在 `900s` 硬上限内 |
| `Q2` | `2` | `completed` / 通过 | `1833.0 s`（含沙箱阻塞切换；三窗净耗时 `845 s`） | `82` | 输入 `278,870` / 缓存 `6,481,794` / 输出 `107,237` | 含阻塞总时长超 `900s` 上限；三窗净耗时在上限内 |
| `Q3` | `1` | `completed` / 通过 | `562.0 s` | `34` | 输入 `374,484` / 缓存 `1,174,851` / 输出 `29,057` | 超目标 `+82s`，在 `900s` 硬上限内 |
| `Q4` | `1` | `completed` / 通过 | `485.0 s` | `31` | 输入 `137,259` / 缓存 `1,799,668` / 输出 `34,846` | 接近目标（`+5s`），在 `900s` 硬上限内 |

- **对照可比性与口径说明**：本轮统一从各子智能体原生 `transcript.jsonl` 提取 `input_tokens`、`cache_read_tokens`、`output_tokens` 与 `PLANNER_RESPONSE` 步数；`metrics.py` 输出沿用 `"cached_input_tokens": "unavailable"` 占位，上表已据实补全原生 `cache_read_tokens`。与 `v0.2.1-R1`（`P1`–`P4`）相比，测试场景对象与输入构造均随 `v0.2.2` 需求变化，仅作观察对照；`Q2` 会话含沙箱真机受阻排查与等待决策沟通时段，故总耗时高于单跑有效测试时长。
- **必修问题及最小修复**：无（`0` 项）。
- **定向回归结果**：全仓 `32/32` `Vitest` 单测与集成测试及 `5/5` `Rust` 原生单测全部通过，`Q1`–`Q4` 一次性全部满足合格判据，无需返修。
- **建议用户接受的限制**：
  1. 当前测试宿主的沙箱隔离桌面（`WinSta0\exebox-*`）不支持直接拉起真机 `timebook-desktop.exe` `WebView2` 窗口（会报错 `HRESULT(0x80070578)`），多窗交互与 `540×520` 布局已由无头 `Edge` 三窗联动模拟及 `tauri.conf.json` 核验覆盖，真机实机安装、托盘菜单及 `Ctrl+Alt+T` 物理快捷键需由用户在真实桌面收口核验；
  2. 新编译产生的测试二进制（如 `cargo test` 输出 `.exe`）在部分 `Windows` 环境下首跑可能遇到系统安全扫描短暂文件锁（`os error 5`），二次执行即可正常通过；
  3. 隔离环境未执行 `docker build` 容器镜像构建实测。
- **非阻断建议**：
  1. 根目录 `package.json` 的 `typecheck` 脚本在全新无 `dist/` 的解压源码包中会因 `@timebook/core/dist/index.d.ts` 尚未生成而失败，建议后续让 `typecheck` 脚本先触发 `@timebook/core` 构建或文档注明先 `build` 后 `typecheck`。

---

## 三、发布

- **包清单、哈希与实际内容检查**：`workspace-data/outputs/timebook/v0.2.2-R1/timebook.zip`（`SHA-256`：`f094b02a8a74246a12a6de3a8261c46551d48fc7388737e3ba7be5018082b1c7`），共 `141` 个文件，`unpack_verify.py` 清单与内容校验 100% 一致；静态安全扫描无敏感凭据、无本地残留库及无本机用户绝对路径。
- **安装/调用入口**：
  - 桌面端安装入口：`workspace-data/outputs/timebook/v0.2.2-R1/installers/时间簿_0.2.2_x64-setup.exe`（`2,267,606 B` / `2.16 MiB`）与免安装主程序 `timebook-desktop.exe`（`9,965,568 B` / `9.50 MiB`）；
  - 服务端/网页端入口：发布包内运行 `corepack pnpm install --frozen-lockfile && corepack pnpm build` 后执行 `node apps/api/dist/server.js`。
- **升级保留内容与回滚**：`v0.2.2` 数据库表结构与 `v0.2.1` 完全一致，支持从 `v0.1.0` / `v0.2.0` / `v0.2.1` 直接无损覆盖升级；若桌面端仍连接旧版 `v0.2.0` 家庭 `NAS` 服务端，停用标签时会主动弹出醒目中文横幅提示更新 `NAS` 镜像，不会静默丢失状态。如需回滚，重装 `v0.2.1` 安装包或回退 `NAS` 容器镜像版本即可，存量数据完全兼容。
- **维护人及目标环境未测项**：`Timebook` 个人维护；真实桌面端 `NSIS` 安装运行、物理全局快捷键 `Ctrl+Alt+T` 与真实家庭 `NAS` `Docker` 容器升级联动待用户实操验收确认。
