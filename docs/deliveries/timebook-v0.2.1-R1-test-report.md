# 时间簿（Timebook）v0.2.1-R1 验证与验收测试报告

**给 PM 的业务摘要**：`timebook` `v0.2.1` 第 1 轮（`v0.2.1-R1`）独立盲测全部完成，结论为**可收口**。父级 `qa` 仅解压测试 `dev` 交付的独立发布包 `timebook.zip`（133 个文件清单与 `SHA-256` 校验通过），包内静态安全扫描清白且 7 处包版本已统一同步至 `0.2.1`。在解压包内完成 `corepack pnpm build`（15.01s）、`corepack pnpm typecheck`（3.96s）、全仓单测（27/27 通过，3.12s）、`Rust` 原生单测（`--lib` 5/5 通过，2.00s）以及 `Windows` 桌面端独立重编译（187.02s），产出的 NSIS 安装包体积 `2.16 MB`（远低于 `15 MB` 目标与 `25 MB` 硬上限）。`P1`–`P4` 四大验收场景由 4 个干净隔离子智能体在独立临时目录、独立高端口（`14601`–`14615`）及双隔离环境变量（`TIMEBOOK_DESKTOP_DATA_DIR` + `WEBVIEW2_USER_DATA_FOLDER`）下完成真实操作与回读核验，**全部一次通过**，12 张关键截图均已由父级 `qa` 用 `read_file` 亲眼核验符合视觉规范：网页宽屏/手机窄屏/桌面定制标题栏向下滚动 `1000px` 后顶栏 `top === 0` 稳固吸顶且弹窗/抽屉遮罩完整覆盖、待办「今日」与「全部未完成」双视图按截止时间统一排序且改期即时重排、二级事项停用后主列表隐藏且模块占比精确重算（`50%/25%/25%` → `50%/50%`）、跨页统计/导出/历史筛选无损保留原标签名与颜色、无 `disabled_at` 列的 `v0.2.0` `SQLite` 与无 `disabled_at` 键的 `timebook-local.json` 零损升级并完成单机停用→转连服务端合并→多端启用双向同步。产品自身运行时 `0 Token`；测试子智能体中仅全链路最复杂的 `P3`（`712.0s`）超过 `480s` 期望目标（仍在 `900s` 硬上限内），无任何「必须修复」级缺陷。

- **结论**：**可收口**；**用户业务确认**：**待确认**（技术盲测与通过规则全部满足，待 PM 复核后交用户最终实操验收）
- **源码、安装副本、包版本与一致性**：
  - 被测独立发布包：`workspace-data/outputs/timebook/v0.2.1-R1/timebook.zip`（`1,560,681 B`，`zip_sha256`：`5f96492c539ba59f0ff93a72c196c1561d76fac0a61fc06350448cdb5a067342`，133 个文件全部核验一致）
  - 解压与隔离编译副本：`workspace-data/tmp/qa/v0.2.1-R1/pkg/timebook`
  - 自编译与交付产物版本一致为 `0.2.1`（产品名称：`时间簿`）：
    - 发布包独立编译：`timebook-desktop.exe`（`9,963,520 B` / `9.50 MB`）、`时间簿_0.2.1_x64-setup.exe`（`2,265,357 B` / `2.16 MB`）
    - `dev` 交付目录（`workspace-data/outputs/timebook/v0.2.1-R1/installers/`）：`timebook-desktop.exe`（`9,963,520 B` / `9.50 MB`）、`时间簿_0.2.1_x64-setup.exe`（`2,265,304 B` / `2.16 MB`）
- **环境与测试范围**：`Windows` 64 位、`Node.js` + `pnpm 10.0.0`、`Cargo`、无头 `Edge CDP`（`msedge.exe`）与真实 `Tauri v2 WebView2 CDP`（`timebook-desktop.exe --minimized`），全程绑定 `127.0.0.1` 隔离高端口 `14601`–`14615` 与独立临时数据目录，零触碰本机真实 `%APPDATA%`、真实「文档」目录、开机自启注册表、真实家庭 `NAS` 或外部 `Notion` 接口。

---

## 一、实际结果与七维复盘

- **任务及授权**：依据 [v0.2.1 增量设计方案](../designs/timebook-v0.2.1-design.md) 与 [v0.2.1 测试计划](../designs/timebook-v0.2.1-test-plan.md) 执行 `v0.2.1-R1` 独立发布包静态安全检查、统一编译回归及 `P1`–`P4` 四大隔离场景真实盲测。
- **目标 / 确认完成 / 未处理**：
  - 已完成：发布包清单与安全扫描、全仓构建与 `PWA` 产物检查、类型检查、全仓 `Vitest` 单测（27/27）、`Rust` 原生单测（`--lib` 5/5）、桌面程序与 `NSIS` 安装包独立重编译、`P1`–`P4` 四大隔离场景真实盲测及 `12` 张关键截图人工视觉核验。
  - 未实操覆盖项（与 `dev` 披露一致，详见限制说明）：`Windows` 物理系统托盘右键菜单与物理全局快捷键人工按键触发、`docker build` 容器构建实跑。
- **证据位置**：
  - 计量汇总：`workspace-data/qa/v0.2.1-R1/metrics.json`
  - 场景回执与截图：`workspace-data/tmp/qa/v0.2.1-R1/cases/P1-run1` ～ `P4-run1`

| 维度 | 观察及依据 | 判断 / 影响范围 |
| --- | --- | --- |
| **业务完成度** | 1. **`P1`（顶部导航栏吸顶常驻与层级遮挡）**：注入 `110` 条记录与 `12` 条待办后，网页桌面宽屏（`1280×800`）滚至 `scrollY=1000` 时 `.tb-header-wrap` `top: 0`、`position: sticky`、`zIndex: 25`，`15` 个采样点无正文穿透重叠，顶栏仅含五栏导航、同步胶囊与设置按钮，**未新增「新建待办」按钮**；滚动中点击顶栏「统计」「标签」切页响应准确；手机窄屏（`375×812`）顶部栏 `top: 0` 吸顶且底部五栏 `bottom: 0`（`zIndex: 30`）互不冲突；桌面定制标题栏模式（`?desktopMock=1`）滚至 `1000px` 时 `titlebar` `top: 0`（高 `56px`）稳固常驻；滚动中打开「补记录」弹窗（遮罩 `zIndex: 40`）与「设置与数据」抽屉（遮罩 `zIndex: 50`）均完整覆盖顶栏。已亲眼核验 `p1-web-sticky.png`、`p1-mobile-sticky.png`、`p1-desktop-sticky.png`、`p1-modal-overlay.png`、`p1-drawer-overlay.png`。<br>2. **`P2`（待办双视图按截止时间统一排序与即时重排）**：构造 `8` 条覆盖过期 2 天/1 天、今天截止、3 天后截止、无截止早/晚创建、今天已完成且今天截止、明天计划且明天截止的待办。「今日」视图顺序严格为 `过期2天 → 过期1天 → 今天截止 → 3天后截止 → 无截止(晚) → 无截止(早) → 今天已完成`；「全部未完成」视图顺序严格为 `过期2天 → 过期1天 → 今天截止 → 明天计划明天截止 → 3天后截止 → 无截止(晚) → 无截止(早)`；通过 UI 把「无截止较早创建」改期为今天截止并保存后，即时跃迁至「今天截止」组并排在较晚创建的 `P2-03` 之后，刷新页面与服务端/本地（`pendingMutationsCount: 0`）完全一致。已亲眼核验 `p2-todo-sort-today.png`、`p2-todo-sort-all.png`、`p2-todo-after-edit.png`。<br>3. **`P3`（二级标签停用、占比重算、跨页无损与重新启用全闭环）**：初始「工作」卡片 `4 h 0 min / 3 事项 / 4 记录`（`A: 50%, B: 25%, C: 25%`）；停用 `A` 后主列表隐藏 `A`，按钮徽标显示 `已停用 1`，卡片重算为 `2 h 0 min / 2 事项 / 2 记录` 且 `B/C` 占比重算为 `50% / 50%`；「统计」页（周总计 `4 h 45 min`，工作 `4 h 0 min 84%`，`A` `2 h 0 min 42%`）、日历、今日时间线、历史列表及 `CSV`/`JSON` 导出均原样保留 `A` 名称、模块蓝配色及 `120 min` 时长；开始专注、补记录、编辑待办、历史行内与批量改标签 `5` 处选择器均隐藏 `A`；打开绑定 `A` 的旧记录/旧待办仅改标题保存后 `tag_id` 完整保留；历史筛选下拉出现「已停用事项」分组且搜索 `A` 可命中；同模块新建同名 `A` 被拦截提示去启用并禁用保存按钮；打开「已停用事项」弹窗点击「重新启用」立即恢复主列表与 `50%/25%/25%` 占比；从弹窗删 `TempTag` 及删含已停用标签的「临时模块」均安全无孤儿数据。已亲眼核验 `p3-tags-after-disable.png`、`p3-disabled-modal.png`。<br>4. **`P4`（`v0.2.0` 旧数据零损升级、多端同步与安装包产出）**：无 `disabled_at` 列的 `v0.2.0` `SQLite` 在新版 `@timebook/api` 启动后自动 `ALTER TABLE` 补齐 `disabled_at` 列，存量标签默认启用；无 `disabled_at` 键的 `v0.2.0` `timebook-local.json` 在双隔离环境变量启动的真实 `0.2.1` `timebook-desktop.exe` 加载无报错且标签全部启用；单机停用 `desk-tag-1` 后转连模拟服务端无损上传停用态，在无头 `Edge` 网页端「已停用」弹窗重新启用后桌面端同步恢复启用态，两端最终一致为 `4` 启用标签与 `2` 条记录（`50 min`）；`setup.exe` 安装包体积 `2.16 MB <= 25 MB` 且版本信息为 `0.2.1`。已亲眼核验 `p4-desktop-loaded.png`、`p4-web-synced.png`。 | 全部 `4` 项核心验收场景及全仓单测回归 `100%` 满足合格判据。 |
| **质量** | 1. 静态扫描未检出 `target/`、`node_modules/`、`.env`、`*.sqlite*`、本机绝对路径、局域网真实 IP 或后门；<br>2. 类型检查、`Vitest` 27/27、`Rust --lib` 5/5 全过；<br>3. 视觉核验：父级 `qa` 亲眼核验 `P1`–`P4` 全部 `12` 张截图，吸顶毛玻璃底边、遮罩层次、卡片汇总与配色、徽标徽章与弹窗样式均符合 [视觉与动效设计规范](../设计规范.md)；<br>4. 发现 `1` 处工程脚本小瑕疵（纯净解压包先跑 `typecheck` 会因未生成 `packages/core/dist/` 报 `TS2307`，先执行 `pnpm build` 即全部通过），不影响实际交付产物质量。 | 质量达标，无「必须修复」级缺陷。 |
| **权限与副作用** | 1. 严格仅操作解压包与隔离输出目录，未修改被测包与项目源码；<br>2. `P4` 启动真实 `timebook-desktop.exe` 严格同时设置 `TIMEBOOK_DESKTOP_DATA_DIR`、`WEBVIEW2_USER_DATA_FOLDER` 与隔离 `backups` 路径，未触碰用户真实 `%APPDATA%`、真实「文档」或本机已运行的桌面实例（用户原有 `PID 14952` 完整保留未受干扰）；<br>3. `P1`–`P4` 测完均按自有 `PID` 精准清理并经 `Get-NetTCPConnection` 复核 `14601`–`14699` 端口 `0` 监听残留。 | 隔离严密，零本机与外部数据污染。 |
| **异常处理** | 1. `P1`–`P4` 全流程浏览器控制台零报错、无未捕获页面异常、无失败接口请求；<br>2. 同模块新建与已停用事项重名时阻止提交并给出准确引导文案；<br>3. 删已停用标签与含已停用标签的模块均正常触发删除/迁移保护，零孤儿数据。 | 异常边界清晰可控。 |
| **效率与成本** | 1. 产品运行时自身模型消耗 **`0 Token`**；<br>2. 桌面安装包体积 `2.16 MB`（`2,265,304` / `2,265,357 B`），远低于目标 `15 MB` 与硬上限 `25 MB`；<br>3. 盲测子智能体单场景时长：`P1` `256.0s`、`P2` `212.0s`、`P4` `477.0s` 均低于 `480s` 目标；仅 `P3`（`712.0s`）因单个场景覆盖 5 大跨页操作、导出校验与删改闭环，超过 `480s` 期望目标，但仍在 `900s` 硬上限内。 | 体积与运行时零成本达标；盲测总耗时可控。 |
| **复杂度** | `disabled_at` 字段、辅助函数 `isTagDisabled`、`compareTodoViewItems` 及 `buildTagLookup` 拆分复用既有同步、乐观更新与查找表链路，未新增后台轮询服务或手工迁库脚本；吸顶采用原生 `position: sticky` 而非重写内部滚动容器，零破坏日历拖拽与历史批量栏定位。 | 增量设计克制简洁，回归风险低。 |
| **迁移与使用体验** | 老版本 `SQLite` 与桌面本地快照 `timebook-local.json` 均做到零配置自动向上兼容，存量标签无误停用；停用/启用交互顺滑、全站汇总与选择器口径自然统一；吸顶顶栏免除长页面来回拉回顶部的操作成本。 | 无痛升级，核心痛点解决到位。 |

**各验证层说明**：
- **静态与单元测试层（已测）**：发布包清单与哈希校验（133 文件一致）、源码安全扫描、`corepack pnpm typecheck`（4/4 项目通过，需在 `build` 后）、`corepack pnpm test`（4 文件 27/27 通过）、`cargo test --lib`（5/5 通过；不带 `--lib` 运行空 `src/main.rs` 二进制桩在本机遇 `Windows os error 5` 拒绝访问）。
- **构建与打包层（已测）**：`corepack pnpm build`（含 `apps/web/dist/sw.js` 与 `manifest.webmanifest`）、`corepack pnpm desktop:build`（从纯净解压包源码独立编译生成 `timebook-desktop.exe` 与 `时间簿_0.2.1_x64-setup.exe`）。
- **真实闭环层（已测）**：`P1`–`P3` 通过真实 `@timebook/api` + 无头 `Edge CDP` 完成真实界面交互与落盘回读；`P4` 通过真实隔离启动的 `timebook-desktop.exe`（`WebView2 CDP`）+ `@timebook/api` + 无头 `Edge CDP` 完成旧库迁移与多端双向同步。
- **未测项**：物理桌面人工点击系统托盘右键菜单与物理按键触发全局快捷键、隔离环境 `docker build` 容器实跑。

---

## 二、计量与修复

- **父级 `qa` 统一环境准备耗时（单列）**：
  - `unpack_verify.py` 解压与校验：约 `2 秒`
  - `corepack pnpm install --frozen-lockfile`：`48.95 秒`（+440 packages）
  - 首跑 `corepack pnpm typecheck`（未先 `build` 失败）：`4.45 秒`
  - `corepack pnpm build`：`15.01 秒`
  - `corepack pnpm typecheck`（`build` 后）：`3.96 秒`
  - `corepack pnpm test`：`3.12 秒`（27/27 通过）
  - `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`：`102.50 秒`（`lib` 5/5 通过，`bin` 桩 `os error 5`）；单独 `cargo test --lib`：`2.00 秒`
  - `corepack pnpm desktop:build`：`187.02 秒`
  - **准备与回归阶段合计净执行耗时**：约 `367.0 秒`（约 `6.1 分钟`）
- **独立盲测子智能体实测计量（来自各子智能体 `transcript.jsonl`，写入 `workspace-data/qa/v0.2.1-R1/metrics.json`）**：

| 场景 | 并发数 (`--parallel`) | 宿主完成态 / 业务终态 | 真实时长 (`duration_seconds`) | 模型请求步数 (`api_calls`) | 输入 / 缓存读取 / 输出 Token | 对比预算（目标 `480s` / 硬上限 `900s`） |
| --- | :---: | :---: | :---: | :---: | --- | --- |
| `P1` | `2` | `completed` / 通过 | `256.0 s` | `22` | 输入 `120,233` / 缓存 `1,409,936` / 输出 `23,307` | 低于目标 |
| `P2` | `2` | `completed` / 通过 | `212.0 s` | `17` | 输入 `94,425` / 缓存 `702,181` / 输出 `19,464` | 低于目标 |
| `P3` | `1` | `completed` / 通过 | `712.0 s` | `38` | 输入 `215,615` / 缓存 `4,028,864` / 输出 `38,865` | **超目标 +232s**，在 `900s` 硬上限内 |
| `P4` | `1` | `completed` / 通过 | `477.0 s` | `46` | 输入 `179,697` / 缓存 `3,873,019` / 输出 `32,019` | 低于目标 |

- **对照可比性与口径说明**：本版 `v0.2.1` 为首个含真实原生 `input_tokens` / `output_tokens` / `cache_read_tokens` 统计的版本（`metrics.py` 脚本按 `delegate_task` 旧模板保留 `"cached_input_tokens": "unavailable"`，此处已在表格及备注中如实补列来自 `transcript.jsonl` 的原生 `cache_read_tokens` 累计值）；`P1` 与 `P2` 为 `parallel=2` 并发，`P3` 与 `P4` 为 `parallel=1` 独立单跑。
- **必修问题及最小修复**：无（`0` 项）。
- **定向回归结果**：全仓 `27/27` 单元测试与 `5/5` `Rust` `lib` 单测全部通过，`P1`–`P4` 一次性全部通过，无需返修。
- **建议用户接受的限制**：
  1. 本机 `Windows` 环境下执行不带 `--lib` 的 `cargo test` 会在 `src/lib.rs` 5/5 通过后因执行空的 `src/main.rs` 二进制桩触发系统 `os error 5（拒绝访问）`，使用 `--lib` 可完整覆盖所有 `Rust` 单元测试；
  2. 物理系统托盘右键菜单、物理按键全局热键与 `docker build` 镜像构建未在本轮无头隔离环境中实操。
- **非阻断建议**：
  1. 根目录 `package.json` 的 `typecheck` 脚本在全新无 `dist/` 解压包中会因 `@timebook/core/dist/index.d.ts` 未生成而报错，建议后续在 `typecheck` 前先触发 `@timebook/core` 构建（或调整构建检查指引先 `build` 后 `typecheck`）。

---

## 三、发布

- **包清单、哈希与实际内容检查**：`workspace-data/outputs/timebook/v0.2.1-R1/timebook.zip`（`1,560,681 B`，`SHA-256`：`5f96492c539ba59f0ff93a72c196c1561d76fac0a61fc06350448cdb5a067342`），共 `133` 个文件，`unpack_verify.py` 清单与内容校验 100% 一致；静态安全扫描无敏感凭据、无本地残留库及无本机路径。
- **安装/调用入口**：
  - 桌面端安装入口：`workspace-data/outputs/timebook/v0.2.1-R1/installers/时间簿_0.2.1_x64-setup.exe`（`2,265,304 B` / `2.16 MB`）与免安装主程序 `timebook-desktop.exe`（`9,963,520 B` / `9.50 MB`）；
  - 服务端/网页端入口：发布包内运行 `corepack pnpm install --frozen-lockfile && corepack pnpm build` 后执行 `node apps/api/dist/server.js`。
- **升级保留内容与回滚**：覆盖安装 `0.2.1` 沿用 `com.timebook.desktop` 应用数据目录，老版 `SQLite` 自动 `ALTER TABLE tags ADD COLUMN disabled_at INTEGER`、老版 `timebook-local.json` 自动缺省补全 `disabled_at: null`，完整保留全部存量模块、事项标签、专注记录、待办及桌面偏好设置；如需回滚，重装 `v0.2.0` 安装包并可从自动每日备份恢复快照。
- **维护人及目标环境未测项**：`Timebook` 个人维护；目标真实家庭 `NAS` `Docker` 生产部署及真实桌面物理托盘菜单/热键待用户实操验收确认。
