# 时间簿（`Timebook`）`v1.1.0` `R1` 验证与验收报告

> **给项目负责人的业务语言摘要**：本轮（`R1`）对 `dev` 交付的 `v1.1.0-R1` 独立发布包完成了静态安全扫描、隔离环境全量编译与单测回归（`18` 项前端/接口单测 + `4` 项桌面原生单测全部通过，成功重现编译 `2.15 MiB` 安装包），并由 `6` 个干净隔离子智能体无打扰盲测了 `D1`–`D6` 六大验收场景。**`D2`–`D6` 在核心交互、多窗同步（实测 `56 ms`）、托盘联动、快捷键呼出与单机转连模拟 `NAS` 无损去重合并方面表现达标；但在 `D1` 真实桌面可执行程序冷启动实测中发现 1 项阻断性缺陷**：桌面端启动时 3 个隐藏浏览器视图并发初始化且缺少互斥/幂等保护，导致本地快照与每日备份文件中默认四模块重复写入 3 份共 `12` 个模块（工作×3、学习×3、游戏×3、锻炼×3，在 `D1`、`D2`、`D4` 隔离冷启动中 `100%` 复现）。因此本轮裁决为 **定向修复**，打回 `dev` 修复后进入 `R2` 复测。

结论：**定向修复**；用户业务确认：**待确认（需完成定向修复与 `R2` 复测后再交用户验收）**。

源码、安装副本、包版本与一致性：基于独立发布包 `workspace-data/outputs/timebook/v1.1.0-R1/timebook.zip`（`115` 个文件，`sha256: 4901bd75ccb475339ef2c940a4ce140241712b81e00080f2bf8391e2102e317a`）解压至隔离目录 `workspace-data/tmp/qa/v1.1.0-R1/pkg/timebook` 实测；未修改任何包内文件或开发源码。`dev` 附带产物目录 `workspace-data/outputs/timebook/v1.1.0-R1/installers/` 含 `时间簿_1.1.0_x64-setup.exe`（`2,259,569` 字节）与 `timebook-desktop.exe`（`9,954,304` 字节），哈希与 `SHA256SUMS.txt` 完全一致；QA 在隔离解压包独立重现编译产出 `时间簿_1.1.0_x64-setup.exe`（`2,258,740` 字节 / `2.15 MiB`）与 `timebook-desktop.exe`（`9,956,352` 字节 / `9.50 MiB`）。

环境与测试范围：`Windows` 本机隔离目录（`TIMEBOOK_DESKTOP_DATA_DIR` + `WEBVIEW2_USER_DATA_FOLDER` + `--minimized` 后台启动）、无头 `Chromium 145.0.7632.6`（`Playwright` `?desktopMock=1` 多窗协同）及本地高端口（`14311`–`14316`、`14326`）模拟 `NAS`（真实 `@timebook/api` + `SQLite`）；**未测范围**：真实绿联 `NAS` 硬件、真实 `Notion` 账号接口、宿主机真实 `%APPDATA%`/文档目录/开机自启注册表写入、真实系统级热键焦点抢占及 `macOS`/`Linux` 实机环境。

---

## 实际结果

任务及授权：依据 [v1.1.0 测试计划](../designs/timebook-v1.1.0-test-plan.md)、[v1.1.0 设计方案](../designs/timebook-v1.1.0-design.md) 与 [设计规范](../设计规范.md) 在 `workspace-data/tmp/qa/v1.1.0-R1/` 执行只读发布包验证，严格遵守无打扰隔离红线；本报告写入 `docs/deliveries/timebook-v1.1.0-R1-test-report.md`。

目标 / 确认完成 / 未处理：
- **已完成并核验通过**：包清单与静态安全扫描、依赖锁安装、全量编译构建、前端与后端 `18/18` 单测、桌面原生 `4/4` 单测、`D2`（定制顶栏与网页零退化/设置持久化）、`D3`（胶囊小窗紧凑展开/黑白双皮肤/`56ms` 同步）、`D4`（托盘状态与前 5 最近常用联动）、`D5`（呼出框聚焦/回车秒开/`Esc` 取消/改键持久化）、`D6`（单机转连模拟 `NAS` 无损合并去重与断联补传）。
- **实测不通过（必须修复）**：`D1` 中真实桌面可执行程序首次冷启动在 `timebook-local.json` 与 `backups/timebook-local-2026-11-19.json` 重复生成 `12` 个默认模块（应为 `4` 个）。

证据位置：
- 计量汇总：`workspace-data/qa/v1.1.0-R1/metrics.json`
- 各场景隔离实测回执与日志：`workspace-data/tmp/qa/v1.1.0-R1/cases/D1-run1/result.json` ～ `D6-run1/result.json`
- 关键视觉截图（均已由父级 `qa` 亲眼核验）：
  - 主窗与定制顶栏对照：[d1-main-local.png](../../workspace-data/tmp/qa/v1.1.0-R1/cases/D1-run1/d1-main-local.png)、[d2-web-header.png](../../workspace-data/tmp/qa/v1.1.0-R1/cases/D2-run1/d2-web-header.png)、[d2-desktop-titlebar.png](../../workspace-data/tmp/qa/v1.1.0-R1/cases/D2-run1/d2-desktop-titlebar.png)、[d2-desktop-settings.png](../../workspace-data/tmp/qa/v1.1.0-R1/cases/D2-run1/d2-desktop-settings.png)
  - 灵动胶囊小窗三态双皮肤：[d3-widget-compact.png](../../workspace-data/tmp/qa/v1.1.0-R1/cases/D3-run1/d3-widget-compact.png)、[d3-widget-light.png](../../workspace-data/tmp/qa/v1.1.0-R1/cases/D3-run1/d3-widget-light.png)、[d3-widget-dark.png](../../workspace-data/tmp/qa/v1.1.0-R1/cases/D3-run1/d3-widget-dark.png)
  - 全局呼出框与同步状态：[d5-launcher.png](../../workspace-data/tmp/qa/v1.1.0-R1/cases/D5-run1/d5-launcher.png)、[d6-nas-synced.png](../../workspace-data/tmp/qa/v1.1.0-R1/cases/D6-run1/d6-nas-synced.png)、[d6-nas-offline.png](../../workspace-data/tmp/qa/v1.1.0-R1/cases/D6-run1/d6-nas-offline.png)

### 七维复盘

| 维度 | 观察及依据 | 判断 / 影响范围 |
| --- | --- | --- |
| 业务完成度 | `D2`、`D3`、`D4`、`D5`、`D6` 全部达成判据，一期回归（`18/18`）与桌面原生单测（`4/4`）全绿；`D1` 真实冷启动生成 `12` 个重复默认模块（`D1-run1`、`D2-run1`、`D4-run1` 三次隔离冷启动均复现） | **部分完成（`5/6` 场景全过，`D1` 阻断）**；影响所有首次冷启动单机初始化场景 |
| 质量 | 视觉与设计规范高度一致（56px 定制顶栏、胶囊紧凑/展开圆角与对比度、黑白双皮肤、呼出框 2px 聚焦描边、断联橙色描边 `#FFB38A`/底 `#FFF7F1`/字 `#9A3A0A`）；多窗同步实测 `56ms`（端到端 `69ms < 200ms`）；单机转连 `NAS` 总时长分秒不差且服务端去重为 `5` 模块。仅多窗口并发初始化缺互斥导致默认四模块重复 3 倍 | **交互与视觉质量优秀，启动初始化并发一致性不达标** |
| 权限与副作用 | 静态扫描包内无 `target/`、`.env`、`*.sqlite*` 或硬编码内网敏感地址；全过程均使用 `TIMEBOOK_DESKTOP_DATA_DIR`、`WEBVIEW2_USER_DATA_FOLDER` 与 `--minimized`，无头浏览测试未抢占用户桌面焦点；只读查询 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 确认无 `timebook` 残留；测试结束检查无残留进程及监听端口 | **安全与隔离完全达标，零越权副作用** |
| 异常处理 | 单机无后端免口令直入不报错；`Esc` 取消呼出框无脏数据；模拟 `NAS` 断联即时切橙色「连接断开 · 1 条待保存」，重启服务后自动幂等补传 4 条至 `SQLite` 无丢失无重复 | **断联与取消异常处置稳健** |
| 效率与成本 | 产品运行时消耗 `0 Token`；安装包实编 `2.15 MiB`（目标 `<= 15 MB`，硬上限 `25 MB`）；多窗同步 `56ms`（硬上限 `200ms`）。盲测中 `D1`（`295s`）、`D2`（`416s`）、`D3`（`339s`）、`D5`（`255s`）、`D6`（`289s`, `parallel=1`）均在 `480s` 目标内；`D4`（`628s`, 59 步）超出 `480s` 目标但低于 `900s` 硬上限（系测试造 7 事项+6 记录步数较多所致） | **产品资源与性能优异；测试耗时除 `D4` 略高外均达标** |
| 复杂度 | 单一前端代码库复用双模式，通过轻量桥接层兼容桌面运行时与网页降级；但桌面配置 3 个预创建隐藏窗口同时执行 `useAppStore.init()` 产生竞态 | **架构简洁，需补齐跨窗口初始化单点保护** |
| 迁移与使用体验 | 网页模式保持原顶栏与登录拦截零退化；纯中文使用说明清晰；单机转连 `NAS` 自动合并去重有效（但若用户单机冷启动已因 `D1-DEF-01` 产生 3 套同名「工作」模块，虽 `planLocalToRemoteMerge` 可按名映射合并，单机状态下已破坏界面观感） | **网页无缝兼容，修复 `D1-DEF-01` 后单机与迁移体验完整** |

分层验证说明：
- **静态检查**：已测（压缩包校验 115 文件、`installers/` SHA256 核验、源码敏感信息扫描）。
- **确定性回归**：已测（`corepack pnpm test` `18/18`、`cargo test` `4/4`）。
- **真实闭环**：已测（隔离 `timebook-desktop.exe --minimized` 文件与备份落盘、真实 `@timebook/api` + `SQLite` 服务跨域合并与断联补传、多窗 `Playwright` 实测）。
- **最终包**：已测（全程基于 `v1.1.0-R1/timebook.zip` 解压包独立安装、编译与测试）。
- **客户目标环境**：未测（未连接真实绿联 `NAS`、`Notion` 线上服务或修改真实宿主机用户注册表）。

---

## 计量与修复

### 准备与编译阶段（父级 `qa` 单列计时，不计入盲测场景预算）

- 依赖安装（`corepack pnpm install --frozen-lockfile`）：`17.22s`
- 工作区构建（`corepack pnpm build`）：`16.58s`
- 前端与后端单测（`corepack pnpm test`，4 文件 18 项）：`4.48s`
- 桌面原生单测（`cargo test`，4 项，临时 `rsproxy-sparse` 环境变量命中缓存）：`130.86s`
- 桌面打包重现编译（`corepack pnpm desktop:build`）：`129.90s`

### 盲测子智能体实测计量（来自各子智能体 `transcript.jsonl` 与 `metrics.json`）

| 场景 | 并发数 | 宿主终态 | 业务结果 | 时长（秒） | 模型请求步数 | 输入/输出/缓存 `Token` | 费用 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `D1` | `3` | `completed` | **不通过** | `295.0` | `25` | 不可用（日志未提供原生字段） | 不可用 |
| `D2` | `3` | `completed` | 通过 | `416.0` | `40` | 不可用 | 不可用 |
| `D3` | `3` | `completed` | 通过 | `339.0` | `35` | 不可用 | 不可用 |
| `D4` | `2` | `completed` | 通过 | `628.0` | `59` | 不可用 | 不可用 |
| `D5` | `2` | `completed` | 通过 | `255.0` | `20` | 不可用 | 不可用 |
| `D6` | `1` | `completed` | 通过 | `289.0` | `23` | 不可用 | 不可用 |

对照可比性与质量边界：本轮为 `R1` 首轮评审，无上一轮基线；关键场景 `D6` 按 `parallel=1` 单独运行实测 `289.0s`（目标 `<= 480s`）；`D4` 超出 `480s` 目标（`628.0s < 900s` 硬上限）属测试脚本分步造数调用次数较多，非产品阻塞。子智能体会话日志均未输出原生 `Token` 用量，按规则统一标为不可用，未作任何估算。

### 必须修复项（`R2` 复测准入）

1. **`D1-DEF-01`（高优先级）：真实桌面应用冷启动时多窗口并发初始化导致默认四模块重复写入 3 份（共 `12` 个模块）**
   - **复现步骤**：在全新隔离 `TIMEBOOK_DESKTOP_DATA_DIR` 与 `WEBVIEW2_USER_DATA_FOLDER` 环境变量下静默启动 `timebook-desktop.exe --minimized`，等待 3–5 秒后检查 `timebook-local.json` 与 `backups/timebook-local-YYYY-MM-DD.json`。
   - **实测结果**：`modules` 数组包含 `12` 个 `deleted_at: null` 的模块（`工作`×3、`学习`×3、`游戏`×3、`锻炼`×3），三组各自持有不同 `ULID`，在 `D1-run1`、`D2-run1`、`D4-run1` 三份冷启动目录中 `100%` 复现。
   - **原因定位**：`tauri.conf.json` 启动即创建 3 个 `WebView2` 窗口（`main`、`widget`、`launcher`），它们共享同一 `IndexedDB` 来源并同时触发 `useAppStore.init()`；在 `apps/web/src/store/useAppStore.ts` 中，`widget` 和 `launcher` 与 `main` 同时查到 `snap.modules.length === 0`，各自调用 `createDefaultModulesSeed()` 生成随机 `ULID` 并并发写入 `localDb.modules` 与 `timebook-local.json`。
   - **最小修复与验收要求**：
     - 仅允许主窗口（或通过跨窗口锁 / 确定性默认模块 ID + 幂等初始化 / 主窗口完成后再广播同步）执行首次默认四模块种子创建及从 `timebook-local.json` 恢复 `IndexedDB`；`widget` / `launcher` 初始化时不重复创建默认模块也不向空库覆盖落盘；
     - 在冷启动真实 `timebook-desktop.exe --minimized` 实测中，`timebook-local.json` 与每日备份的 `modules` 数组长度必须严格为 `4`（工作/学习/游戏/锻炼各 1 个），且增补多窗并发/确定性默认模块单元测试覆盖。

### 定向回归结果、限制与建议

- 定向回归结果：待 `dev` 修复 `D1-DEF-01` 并交付 `v1.1.0-R2` 包后，复测全量编译与单测回归，重点复测受变更影响的 `D1`（真实冷启动四模块验证与清缓存恢复）及跨窗初始化相关验证（如 `D3`/`D5` 子窗首次启动协同）。
- 建议用户接受的限制：
  1. 桌面端离线/真机限速环境下，`Cargo` 重编需借助临时镜像参数或本机用户目录已有缓存；
  2. 宿主机真实开机启动注册表、真实绿联 `NAS` 硬件、真实系统全局热键抢焦点行为及 `macOS`/`Linux` 未在本轮环境实测，交付后由用户在目标电脑按《`Windows` 桌面版使用说明》做最后一次人工点检确认。
- 非阻断建议：无（若在修复 `D1-DEF-01` 时顺带对极罕见历史重复同名模块做一次性幂等防护会更稳健，但不作为额外强制要求）。

---

## 发布

包清单、哈希与实际内容检查：`timebook.zip`（`115` 文件，校验通过 `ok=true`），`installers/` 哈希与 `SHA256SUMS.txt` 一致，包内静态安全扫描清白；独立重现编译产出的 `时间簿_1.1.0_x64-setup.exe` 为 `2.15 MiB`。

安装 / 调用入口：用户端双击 `时间簿_1.1.0_x64-setup.exe` 安装或直接运行 `timebook-desktop.exe`（详见 [Windows桌面版使用说明.md](../Windows桌面版使用说明.md)）；`NAS` 后端按原容器部署流程运行 `@timebook/api`。

升级保留内容与回滚：单机数据独立存于 `%APPDATA%/com.timebook.desktop/timebook-local.json` 及每日备份文件夹 `文档/TimebookBackups/`，支持随时切换或回退至单机/网页模式而不丢失记录；**当前 `v1.1.0-R1` 因存在 `D1-DEF-01` 暂不建议直接发布给终端用户，待 `R2` 验证通过后放行。**
