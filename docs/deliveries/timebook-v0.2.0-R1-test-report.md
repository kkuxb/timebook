# 时间簿（Timebook）v0.2.0-R1 验证与验收测试报告

**给 PM 的业务摘要**：`timebook` `v0.2.0` 第 1 轮（`v0.2.0-R1`）独立盲测全部完成，结论为**可收口**。父级 `qa` 仅解压测试 `dev` 交付的独立发布包 `timebook.zip`（127 个文件清单与 SHA-256 校验通过），包内已彻底清除 `tools/notion-import/` 且静态安全扫描清白；全仓单测（`23/23`）、全仓构建（含 `PWA` `sw.js` 与 `manifest.webmanifest`）、`Rust` 原生单测（`5/5`）及桌面安装包独立编译全部 `100%` 通过，产出安装包体积 `2.16 MB`（远低于 `15 MB` 目标与 `25 MB` 硬上限）。六大隔离盲测场景（`V1`–`V6`）由 6 个干净隔离智能体在独立端口与 `TIMEBOOK_DESKTOP_DATA_DIR` / `WEBVIEW2_USER_DATA_FOLDER` 隔离目录下完成真实操作与回读核验，**全部一次通过**，关键截图均已由父级 `qa` 亲眼核验符合视觉规范：3,750 条记录下「历史」筛选响应 `25–47 ms`、130 条跨页批量改标签 `190.5 ms`、真机 `WebView2` 灵动胶囊起跳延迟 `4–11 ms`、同日多次计时零重复重写每日备份、`v0.1.0` 覆盖升级 `1.85 秒`免配直入主页且转连模拟 `NAS` 无损去重。产品自身运行消耗 `0 Token`；测试子智能体仅 `V3`（`493.0s`）略超 `480s` 期望目标 `13s`（远低于 `900s` 硬上限），无任何「必须修复」级缺陷，仅附 2 条体验限制与 2 条非阻断优化建议。

- **结论**：**可收口**；**用户业务确认**：**待确认**（技术盲测与通过规则全部满足，待 PM 复核后交用户最终实操验收）
- **源码、安装副本、包版本与一致性**：
  - 被测独立发布包：`workspace-data/outputs/timebook/v0.2.0-R1/timebook.zip`（`zip_sha256`: `2edb9cfbebac5206c8f9d0ef96852fcffe9b2676b7171c6a8970fb437696e0b6`，127 个文件，`_release-manifest.json` 全部核验一致）
  - 解压与隔离编译副本：`workspace-data/tmp/qa/v0.2.0-R1/pkg/timebook`
  - 自编译与交付安装包版本一致为 `0.2.0`：
    - 发布包独立编译：`timebook-desktop.exe`（`9,962,496 B` / `9.501 MB`）、`时间簿_0.2.0_x64-setup.exe`（`2,265,140 B` / `2.160 MB`）
    - `dev` 交付目录（`workspace-data/outputs/timebook/v0.2.0-R1/installers/`）：`timebook-desktop.exe`（`9,962,496 B` / `9.501 MB`）、`时间簿_0.2.0_x64-setup.exe`（`2,265,772 B` / `2.161 MB`）
- **环境与测试范围**：Windows 11（64 位）、Node + pnpm 10.0.0 + Cargo 1.100.0 + 无头 Edge CDP + 真实 Tauri v2 WebView2 CDP（隔离 `127.0.0.1` 端口 `14511–14661` 与独立临时数据目录，零触碰用户真实 `%APPDATA%`、真实「文档」或真实 `NAS`）。

---

## 一、实际结果与七维复盘

- **任务及授权**：依据 [v0.2.0 设计方案](../designs/timebook-v0.2.0-design.md) 与 [v0.2.0 测试计划](../designs/timebook-v0.2.0-test-plan.md) 执行 `v0.2.0-R1` 独立发布包静态核查、统一编译回归及 `V1`–`V6` 六大隔离场景真实盲测。
- **目标 / 确认完成 / 未处理**：
  - 已完成：发布包清单与安全扫描、全仓单测（23/23）、全仓构建与 PWA 产物检查、Rust 单测（5/5）、桌面可执行与 NSIS 安装包独立重编译、`V1`–`V6` 六大隔离场景盲测及 11 张关键截图人工视觉复核。
  - 未在无头隔离环境实操覆盖项（详见限制说明）：Windows 系统托盘右键菜单与物理系统全局热键人工按键触发、`docker build` 容器构建实跑（已静态核验 `Dockerfile`）。
- **证据位置**：
  - 计量汇总：`workspace-data/qa/v0.2.0-R1/metrics.json`
  - 场景回执与截图：`workspace-data/tmp/qa/v0.2.0-R1/cases/V1-run1` ～ `V6-run1`

| 维度 | 观察及依据 | 判断 / 影响范围 |
| --- | --- | --- |
| **业务完成度** | 1. **`V1`（历史导航与 3,750 条筛选）**：桌面顶栏与手机 `375px` 底栏均完整单行显示五栏「今日 · 日历 · 历史 · 统计 · 标签」（已亲眼核验 `v1-history-overview.png`、`v1-mobile-nav.png`）；注入 `3,750` 条已结束 + `1` 条进行中记录后，历史页默认「全部时间」正确排除进行中计时，跨零点记录单行完整展示（如 `23:20 – 01:05+1天`），`17` 项预设（今日/昨日/本周/上周/本月/上月/自选区间）、一级模块、二级事项、「未分类」及关键词多词组合筛选的命中条数与总时长与独立脚本基准 `100%` 一致（切换耗时 `24.89–46.69 ms`）。<br>2. **`V2`（行内直改与百条批量操作）**：`165` 条测试数据下，行内直改标签、行内改标题、行内改跨次日时间段（`v2-inline-edit.png`）即时更新排序与顶部汇总且刷新持久；顶部 `+ 新增记录` 与单行删除正常；筛选 `130` 条跨页全选后底部浮现深色批量栏（`v2-batch-bar.png`），依次执行批量改标签（`190.5 ms`）、批量改标题、批量清空独立标题、批量删除全部 `0` 漏改；设置「回收站」成功恢复已删除记录。<br>3. **`V3`（灵动胶囊与每日备份去重）**：3,750 条存量快照下启动真实 `timebook-desktop.exe`，主窗口点击开始到 `widget` 切换运行态耗时 `5 / 4 / 4 ms`（轮询 `15–21 ms`），`launcher` 回车起跳耗时 `11 ms`（`v3-main-running.png`、`v3-widget-running.png`），跳秒正常；连续 `3` 次专注期间主快照递增而当日备份 `timebook-local-2026-11-20.json` 的 `mtime_ns` 与 `sha256` 完全不变，手动点「立即备份到本地」可正常刷新。<br>4. **`V4`（今日页自适应时间横条）**：构造三态数据，日常态展示 `8·12·16·20·24`（`v4-axis-8to24.png`，`09:00-11:00` 占比 `left:6.25% / width:12.5%`）、早起态展示 `6·12·18·24`（`v4-axis-6to24.png`）、凌晨态展示 `0·6·12·18·24` 且 `0–8` 点带温和斜线扩展底纹与 `08:00` 虚线分界线（`v4-axis-0to24.png`），凌晨色块贴边零裁切。<br>5. **`V5`（Notion 下线与存量兼容）**：包内已无 `tools/notion-import`，`Dockerfile` / `pnpm-workspace.yaml` / `vitest.config.ts` / `vite.config.ts` 零残留，`sw.js`（`1,332 B`）与 `manifest.webmanifest`（`453 B`）正常生成；`/api/import/notion`、`/api/import/batches`、`/api/import/b1` 均返回 `404`；设置抽屉无 Notion 入口或批次撤销（`v5-settings-clean.png`）；`source: "import"` 存量数据在今日/日历/历史/统计 4 页及 `JSON`/`CSV` 导出中 `100%` 读写正常、RFC 4180 转义准确。<br>6. **`V6`（覆盖升级与模拟 NAS 同步）**：模拟 `v0.1.0` 老用户数据覆盖启动 `0.2.0` 桌面端耗时 `1,845 ms`（`< 3 秒`）免配直入主页（`v6-upgraded-desktop.png`），五栏导航、存量导入数据、待办及 `widgetSkin: "dark"` / `CommandOrControl+Alt+T` 配置 `100%` 保留；历史页改完记录后转连模拟 `NAS`（`127.0.0.1:14561`），自动合并上传 `10` 条变动且四默认模块去重零重复（`v6-nas-connected.png`）。 | 全部 `6` 项核心验收场景及前置回归 `100%` 满足合格判据。 |
| **质量** | 1. 静态扫描、TS 类型检查与全仓 23 项 Vitest 单测、5 项 Rust 单测一次全过；<br>2. 视觉核验：父级 `qa` 使用 `read_file` 逐张审查 `V1`–`V6` 共 `11` 张实机截图，布局、字体、黄/墨/灰/数据色阶、胶囊与扩展斜纹均符合 [视觉与动效设计规范](../设计规范.md)；<br>3. 发现 2 项非阻断视觉/导出细节（前端下载 `CSV` 时 `res.text()` 剥离服务端 BOM；行内跨次日提示三行折行），均不影响功能正确性与中文无乱码要求。 | 质量达标，无阻断缺陷。 |
| **权限与副作用** | 1. 严格只读独立解压包与交付目录，未修改被测包与研发源码；<br>2. 所有 `api`、`msedge` 与 `timebook-desktop.exe` 实例均绑定 `127.0.0.1` 隔离高端口、独立 `DATA_DIR`、`TIMEBOOK_DESKTOP_DATA_DIR` 与 `WEBVIEW2_USER_DATA_FOLDER`，零触碰真实 `%APPDATA%`、真实「文档」或注册表；<br>3. 全部 `V1`–`V6` 场景结束均通过自有 `PID` 精准清理并经 `Get-NetTCPConnection` 复核 `14500–14700` 端口无残留监听。 | 隔离严密，零外部/本机数据污染。 |
| **异常处理** | 1. `V1`–`V6` 所有真实操作及跨页面跳转均无前端 `console.error`、`pageerror` 或未处理请求异常；<br>2. 行内时间编辑器支持次日跨零点自动判定；已下线 `/api/import/*` 路由统一返回规范 JSON `404`；`v0.1.0` 覆盖升级与单机转连 `NAS` 均正确去重合并。 | 异常边界清晰可控。 |
| **效率与成本** | 1. 产品运行时自身模型消耗 **`0 Token`**；<br>2. 性能全部优于设计目标：3,750 条历史筛选 `24.89–46.69 ms`（目标 `< 200 ms`）、130 条批量改标签 `190.5 ms`（目标 `< 200 ms`，硬上限 `1000 ms`）、真机胶囊起跳 `4–11 ms`（目标 `< 50 ms`，硬上限 `200 ms`）、NSIS 安装包 `2.16 MB`（目标 `<= 15 MB`，硬上限 `25 MB`）；<br>3. 盲测子智能体耗时：仅 `V3`（`493.0s`）因需构造 3,750 条本地快照并对多窗口高频 CDP 采样，略超 `480s` 目标 `13s`，但远低于 `900s` 硬上限；其余 5 场景 `190s–404s` 全部低于目标线。 | 性能与体积全面达标，盲测成本可控。 |
| **复杂度** | 下线 `tools/notion-import/` 与 3 个 `/api/import/*` 路由并将 `toCsv` 收敛至 `@timebook/core`，包结构精简为 `core` + `api` + `web` + `desktop` 四块；`desktop_save_snapshot` 复用 `last_local_backup_date` 条件判断消除每日重复全量备份写盘，零引入多余后台服务或迁移脚本。 | 架构更简洁，维护成本降低。 |
| **迁移与使用体验** | `v0.1.0` 存量快照与配置在 `0.2.0` 桌面端实现 `1.85s` 零配置无缝兼容，含 `source: "import"` 与 `import_batch` 的历史数据全页面可读写导出；桌面/网页/手机三端五栏导航单行清晰不折行，行内直改与跨页全选批量栏大幅提升千条级历史整理效率。 | 平滑无痛升级，体验显著提升。 |

**各验证层说明**：
- **静态与单元测试层（已测）**：独立发布包清单校验（127 文件 SHA-256 匹配）、源码敏感词与 `notion-import` 残留扫描、`corepack pnpm test`（4 文件 23/23 通过）、`cargo test`（5/5 通过）。
- **构建与打包层（已测）**：`corepack pnpm build`（含 `apps/web/dist/sw.js` 与 `manifest.webmanifest`）、`corepack pnpm desktop:build`（从纯净解压包独立编译生成 `.exe` 与 `-setup.exe`）。
- **真实闭环层（已测）**：`V1`、`V2`、`V4`、`V5` 通过真实 `@timebook/api` + 无头 Edge CDP 操作全流程；`V3`、`V6` 通过真实编译的 `timebook-desktop.exe`（Tauri v2 WebView2）CDP 多窗口实时观测。
- **未测项**：物理桌面人工点击系统托盘右键菜单与物理快捷键 `Ctrl+Alt+T` 唤醒（仅通过 Rust 单测及 CDP 触发 `launcher` 验证核心链路）、隔离环境 `docker build` 实跑（已静态核对 `Dockerfile`）。

---

## 二、计量与修复

- **父级监督与准备计量**（`qa` 主会话 `c3d9735a-8044-4d49-9c6f-bc135f3a153d`）：
  - 接收 `dev` 交接启动时间：`2026-11-19 23:33:58`（`#5`），报告落盘完成：`2026-11-20 00:20` 左右；
  - 统一环境准备与编译构建阶段（解压校验 + `pnpm install` 28.2s + `pnpm test` 2.20s + `pnpm build` + `cargo test` + `pnpm desktop:build`）：约 `363 秒`（`23:34:21` 至 `23:40:24`）；
  - 监督复核总墙钟（含串/并调度子智能体、视觉查验与报告撰写，不含此前 `swarm_wait` 等待 `dev` 开发时间）：约 `46 分钟`，`api_calls`: 见父会话步骤统计。
- **独立盲测子智能体实测计量（来自各子智能体 `transcript.jsonl`，记录于 `workspace-data/qa/v0.2.0-R1/metrics.json`）**：

| 场景 | 并发数 (`--parallel`) | 宿主完成态 / 业务终态 | 真实时长 (`duration_seconds`) | 模型请求步数 (`api_calls`) | 输入 / 缓存 / 输出 Token | 对比预算（目标 `480s` / 上限 `900s`） |
| --- | :---: | :---: | :---: | :---: | :---: | --- |
| `V1` | `1` | `completed` / 通过 | `190.0 s` | `11` | `不可用`（日志未提供原生字段） | 低于目标 |
| `V2` | `1` | `completed` / 通过 | `376.0 s` | `28` | `不可用` | 低于目标 |
| `V3` | `1` | `completed` / 通过 | `493.0 s` | `30` | `不可用` | **超目标 +13s**，远低于 `900s` 上限 |
| `V4` | `2` | `completed` / 通过 | `258.0 s` | `17` | `不可用` | 低于目标 |
| `V5` | `2` | `completed` / 通过 | `404.0 s` | `24` | `不可用` | 低于目标 |
| `V6` | `1` | `completed` / 通过 | `328.0 s` | `24` | `不可用` | 低于目标 |

- **对照可比性与质量边界**：所有子智能体均为 `gemini-4-hydrogen-high`，首次运行即通过，无重启或重试浪费；因宿主会话日志未输出原生 Token 用量字段，严格按规程标记为 `null / 不可用`（不估算）。`V4` 与 `V5` 以 `parallel=2` 并发运行，其余关键场景均 `parallel=1` 独立独占运行以确保计时与性能延迟真实可信。

### 问题分级清单

- **必须修复**：**无**。
- **建议用户接受的限制**：
  1. **托盘右键与物理全局热键**：受限于隔离无头环境，`V3` 通过 `CDP` 验证了 `launcher` 显隐及回车即时同步，但未人工物理点击 Windows 系统托盘菜单及按键触发系统级全局热键（Rust `tray.rs` 与 `lib.rs` 逻辑已通过静态核对与 `cargo test` 5/5 单测），建议用户实操验收时顺手轻点确认。
  2. **容器镜像实建**：测试机未运行 Docker Daemon，未实跑 `docker build`，已静态检查 `Dockerfile` 无 `tools/notion-import` 引用且构建步骤与已通过的 `pnpm build` 一致。
  3. **`V3` 盲测时长略超期望线**：`V3` 含构造 3,750 条快照及 4 轮毫秒级多窗 `CDP` 采样共耗时 `493.0s`，超过 `480s` 目标 `13s`（未触发 `900s` 硬上限）。
- **非阻断建议**：
  1. **网页端导出 `CSV` 保留原字节 `BOM`**：服务端 `GET /api/export?format=csv` 正确返回带 `UTF-8 BOM (EF BB BF)` 的字节流，但 `SettingsDrawer.tsx` 网页端触发下载时若经由 `res.text()` 构造 `Blob` 会由浏览器剥离前导 BOM（`V5` 实测 `apiCsvHasBomBytes: true`、`browserCsvHasBomBytes: false`，UTF-8 中文无乱码）；后续小迭代可改用 `res.blob()` 以兼容 Windows Excel 直接双击打开无 BOM CSV。
  2. **行内时间编辑「次日」提示防折行**：`v2-inline-edit.png` 中行内起止时间编辑器左下角「次日 · 1 h 45 min」因空间紧凑折为三行，后续可补充 `white-space: nowrap` 提升排版观感。

---

## 三、发布与交付物核验

- **包清单、哈希与实际内容检查**：
  - 发布包 `workspace-data/outputs/timebook/v0.2.0-R1/timebook.zip` 通过 `unpack_verify.py` 校验（127 个文件，`_release-manifest.json` 100% 匹配，无额外未清单文件或危险路径）；
  - 交付安装包 `workspace-data/outputs/timebook/v0.2.0-R1/installers/`：
    - `时间簿_0.2.0_x64-setup.exe`（`2,265,772 B`，`sha256: 9f3749d158fce049f3182dc52388c8bb75a3df7fb6f3113262c699af44be9cea`，文件/产品版本 `0.2.0`）
    - `timebook-desktop.exe`（`9,962,496 B`，`sha256: 3955f2a1e553d9e2d7580a765c9dd02956d16b9c6dffa9a09ffe4cea12ed2016`，文件/产品版本 `0.2.0`）
  - 解压包独立重编译产物一致，文件大小 `2.16 MB` 满足 `<= 15 MB` 目标与 `25 MB` 硬上限。
- **升级保留内容与回滚**：
  - 覆盖升级完整保留旧版 `%APPDATA%/com.timebook.desktop/timebook-local.json` 与 `desktop-config.json`，含 `source: "import"` 存量数据、自定义标签、待办、灵动胶囊外观/位置及快捷键配置，并保留 `v1.1.0-R4` 防旧 `Service Worker` 自愈机制；
  - 如需回滚，重新运行 `v0.1.0` 安装包并配合本地每日自动备份（`TimebookBackups/timebook-local-YYYY-MM-DD.json`）即可无损恢复。
- **维护人及目标环境未测项**：待用户收到 PM 验收通知后，在日常 Windows 主机覆盖安装 `时间簿_0.2.0_x64-setup.exe` 并实测连接真实家庭 `NAS`（与托盘右键、全局快捷键 `Ctrl+Alt+T`）。
