# 时间簿（`Timebook`）`v1.1.0` `R4` 真机 `WebView2 CDP` 终验与收口报告

> **给项目负责人的业务语言摘要**：本轮（`v1.1.0-R4`，经用户实操反馈授权追加的第 4 轮定向热修）针对「正常打开桌面端主窗口卡在『正在加载时间簿…』」的三重叠加根因完成独立发布包重编译与真实 `WebView2 CDP` 三项正例盲测。实测结果：**`R4` 独立发布包静态扫描清白、`21` 项前端/接口单测与 `4` 项桌面原生单测 `100%` 通过、独立重现产出 `2.15 MiB` `NSIS` 安装包；全新目录连续 `3` 次真实非静默冷启动均在 `758 ms`～`1,702 ms` 内完整渲染主页且 `Service Worker` 为空；`1:1` 复现 `R3` 旧版第 2 次启动卡死与 `12` 重复模块现场后直接覆盖启动 `R4`，新版自动清除了旧 `sw.js` 与缓存并顺利进入「今日」主页，同时将 `12` 个重复默认模块无损清洗恢复为严格唯一的 `4` 个模块，自定义事项与 `45 min` 专注记录完整保留；网页版 `PWA` 构建与正常注册零退化**。当前无任何必须修复级缺陷，裁决 **可收口**，呈请项目负责人组织用户最终验收。

结论：**可收口**；用户业务确认：**待确认（技术验证与真机级 `WebView2 CDP` 覆盖升级闭环已全部通过，呈请用户安装实测验收）**。

源码、安装副本、包版本与一致性：基于独立发布包 `workspace-data/outputs/timebook/v1.1.0-R4/timebook.zip`（`121` 个文件，`sha256: 49d2fecaf9dd75fb0415b61a43d21d959993ab98a9d314b30ccaa68db01ba9b4`）解压至 `workspace-data/tmp/qa/v1.1.0-R4/pkg/timebook` 实测；未修改任何包内文件或开发源码。`dev` 交付目录 `workspace-data/outputs/timebook/v1.1.0-R4/installers/` 含 `时间簿_1.1.0_x64-setup.exe`（`2,255,663` 字节）与 `timebook-desktop.exe`（`9,934,848` 字节），哈希与 `SHA256SUMS.txt` 完全一致；QA 在隔离解压包独立重现编译产出 `时间簿_1.1.0_x64-setup.exe`（`2,255,067` 字节 / `2.15 MiB`）与 `timebook-desktop.exe`（`9,936,896` 字节 / `9.48 MiB`）。

环境与测试范围：`Windows` 本机隔离目录（`TIMEBOOK_DESKTOP_DATA_DIR` + `WEBVIEW2_USER_DATA_FOLDER` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=..."`）下直接启动真实编译出的 `timebook-desktop.exe`（不传 `--minimized` 以复现用户双击启动窗口渲染时序）与无头 `Chromium` 验证网页端 `PWA`。依据 [R4 补充简报](../designs/timebook-v1.1.0-R4-hotfix-supplement.md) 第 3 节全量验证三项正例（`R4-P1`、`R4-P2`、`R4-P3`），并全量重跑 `21` 项单测与 `4` 项原生单测；`D1`–`D6` 既有交互功能沿用 `R1`–`R3` 有效通过证据。**未测范围**：宿主机真实 `%APPDATA%`/注册表覆盖安装（留待用户本机安装确认）、真实绿联 `NAS` 设备、真实 `Notion` 线上账号与 `macOS`/`Linux`。

---

## 实际结果

任务及授权：依据 [v1.1.0 测试计划](../designs/timebook-v1.1.0-test-plan.md) 与 [R4 补充简报第 3 节](../designs/timebook-v1.1.0-R4-hotfix-supplement.md) 在 `workspace-data/tmp/qa/v1.1.0-R4/` 执行真机级 `WebView2 CDP` 定向正反例复测；本报告写入 `docs/deliveries/timebook-v1.1.0-R4-test-report.md`。

目标 / 确认完成 / 未处理：
- **`R4` 全部三项真机级验证通过**：
  1. **`R4-P1`（全新目录连续 3 次真实冷启动）**：`3` 次非静默启动实测主页渲染耗时分别为 `1,702 ms`、`915 ms`、`758 ms`（均 `< 3,000 ms`），`http://tauri.localhost/` 均完整渲染「今日」主页与 `[data-testid="desktop-titlebar"]`，`navigator.serviceWorker.controller === null`、`getRegistrations().length === 0`，`timebook-local.json` 模块严格为 `4` 个，控制台与页面 `0` 报错。
  2. **`R4-P2`（1:1 模拟 `R3` 旧版覆盖升级现场）**：先在隔离目录启动 `v1.1.0-R3` 真实程序激活旧版 `sw.js`（`workbox-precache-v2`）并注入 `12` 个重复默认模块（含挂在重复「工作」模块下的自定义标签「核心架构验证」与 `45 min` 专注记录），第 2 次启动 `R3` 真实复现卡死在「`正在加载时间簿…`」（`swControlled=true`）；随后同目录直接覆盖启动 `v1.1.0-R4` 真实程序，自动清除旧 `sw.js` 与 `caches`，顺利突破旧缓存进入「今日」主界面，且顶部模块与 `timebook-local.json` 自动清洗恢复为唯一 `4` 个模块，自定义标签重挂保留、`45 min` 专注记录与「工作 45 min」汇总分秒不差！
  3. **`R4-P3`（网页版 `PWA` 构建与注册零退化）**：`apps/web/dist/sw.js`、`manifest.webmanifest` 与 `workbox-abeb32eb.js` 完整产出且 `dist/index.html` 无硬编码 `/registerSW.js`；普通网页模式访问 `http://127.0.0.1:14343/` 正常注册 `/sw.js`（`activeState=activated`）并维持登录门禁与原网页顶栏；`?desktopMock=1` 桌面模式下不注册且清除残留 `SW`。
- **未处理项**：无（`0` 个必须修复项）。

证据位置：
- 本轮计量：`workspace-data/qa/v1.1.0-R4/metrics.json`
- 复测回执与真实落盘：`workspace-data/tmp/qa/v1.1.0-R4/cases/R4-P1-run1/result.json`、`R4-P2-run1/result.json`、`R4-P3-run1/result.json`、`R4-P2-run1/desktop-data/timebook-local.json`
- 关键实机 `CDP` 截图（均已由父级 `qa` 亲眼核验）：
  - 连续 3 次冷启动：[r4-p1-boot1.png](../../workspace-data/tmp/qa/v1.1.0-R4/cases/R4-P1-run1/r4-p1-boot1.png)、[r4-p1-boot2.png](../../workspace-data/tmp/qa/v1.1.0-R4/cases/R4-P1-run1/r4-p1-boot2.png)、[r4-p1-boot3.png](../../workspace-data/tmp/qa/v1.1.0-R4/cases/R4-P1-run1/r4-p1-boot3.png)
  - 旧版 `R3` 卡死现场 vs `R4` 覆盖升级清洗恢复对比：[r4-p2-r3-before.png](../../workspace-data/tmp/qa/v1.1.0-R4/cases/R4-P2-run1/r4-p2-r3-before.png)、[r4-p2-upgraded.png](../../workspace-data/tmp/qa/v1.1.0-R4/cases/R4-P2-run1/r4-p2-upgraded.png)

### 七维复盘

| 维度 | 观察及依据 | 判断 / 影响范围 |
| --- | --- | --- |
| 业务完成度 | 彻底根治用户实测卡死「正在加载时间簿…」三重根因，`R4-P1`/`R4-P2`/`R4-P3` 全过，且单测回归扩充至 `21/21` + `4/4` | **100% 解决反馈问题并覆盖升级存量清洗** |
| 质量 | `.setup()` 首位注册 `DesktopState`、`on_window_event` 改 `try_state`、`tauri.localhost` 原生自愈清理旧 `SW`、前端 `invoke` 短退避重试 + `try/catch` 兜底与无条件存量模块去重，环环相扣且经真实 `WebView2 CDP` 1:1 复现对照验证 | **根因修复彻底，升级路径稳健** |
| 权限与副作用 | 包内静态扫描清白；`R4` 真实启动严格限定在 `TIMEBOOK_DESKTOP_DATA_DIR` 与 `WEBVIEW2_USER_DATA_FOLDER` 隔离目录与调试端口 `19441`/`19442`，每次测试均按 PID 树彻底终结，验证无残留进程与端口 | **无越权与污染副作用** |
| 异常处理 | 即使前端遭遇暂态时序或旧版缓存劫持，原生自愈与前端 `try/catch` 兜底可确保不卡死在加载页；`12` 重复存量模块按创建时间保留最早模块并无损重映射标签与记录 | **异常恢复与数据迁移健壮** |
| 效率与成本 | 准备与编译：`pnpm install` `18.01s`、`pnpm build` `9.99s`、`pnpm test` `2.26s`、`cargo test` `76.83s`、`desktop:build` `122.14s`；安装包 `2.15 MiB`。盲测 `R4-P1` `172.0s`（11 步）、`R4-P2` `291.0s`（17 步）、`R4-P3` `235.0s`（18 步），全数低于 `480s` 目标 | **构建、产品启动速度与测试成本全部达标** |
| 复杂度 | 仅在入口与初始化路径做精准防竞态与条件 `SW` 注册，未触碰日历、统计、待办、`Notion` 或 `API` 业务代码 | **变更收敛可控，低回归风险** |
| 迁移与使用体验 | 用户直接安装新版 `v1.1.0-R4` `-setup.exe` 覆盖现有安装即可自动清洗旧版缓存与存量 12 模块，无需手工卸载或清空 `%APPDATA%` / `%LOCALAPPDATA%` | **平滑无痛升级** |

---

## 计量与修复

### `R4` 盲测子智能体实测计量（来自各子智能体 `transcript.jsonl`）

| 场景 | 并发数 | 宿主终态 | 业务结果 | 时长（秒） | 模型请求步数 | 原生 `Token` / 费用 |
| --- | --- | --- | --- | --- | --- | --- |
| `R4-P1`（连续 3 次 `WebView2` 冷启动） | `2` | `completed` | **通过** | `172.0` | `11` | 不可用 |
| `R4-P2`（1:1 `R3->R4` 覆盖升级 `CDP`） | `1` | `completed` | **通过** | `291.0` | `17` | 不可用 |
| `R4-P3`（网页版 `PWA` 保留与回归） | `2` | `completed` | **通过** | `235.0` | `18` | 不可用 |

对照可比性与质量边界：`R4` 三项场景均针对新增补充简报第 3 节真机级 `WebView2 CDP` 验收设计，子智能体日志均未提供原生 `Token` 与费用字段，按规范统一标为不可用，不作估算。

### 累计缺陷关闭与限制

- 本轮关闭：`R4-startup-race-desktop-state`、`R4-desktop-sw-cache-hijack`、`R4-legacy-duplicate-modules-cleanup`（经 `R4-P1`、`R4-P2`、`R4-P3` 真机级验证关闭）。
- 建议用户接受的限制：宿主机真实 `%APPDATA%` / `%LOCALAPPDATA%` 覆盖安装点检需由用户在个人电脑双击新版 `时间簿_1.1.0_x64-setup.exe` 确认。

---

## 发布

包清单、哈希与实际内容检查：
- 最终发布源码包：`workspace-data/outputs/timebook/v1.1.0-R4/timebook.zip`（`121` 文件，`ok=true`，`sha256: 49d2fecaf9dd75fb0415b61a43d21d959993ab98a9d314b30ccaa68db01ba9b4`）。
- 最终桌面安装包：`workspace-data/outputs/timebook/v1.1.0-R4/installers/时间簿_1.1.0_x64-setup.exe`（`2,255,663` 字节，`sha256: 46e769d8dd863531b3f96a6f7102389a053f54e3fb1a2914b8cc36dc0584bd6f`）与便携程序 `timebook-desktop.exe`（`9,934,848` 字节，`sha256: fa9916cc96e76a18c8006a9f329a06d30e39d71a0c11741a8dacd9a61d7b43`）。

安装 / 调用入口：用户直接双击运行新版 `时间簿_1.1.0_x64-setup.exe` 覆盖安装即可，无需先清除本地数据目录；打开后将自动清理旧版浏览器缓存并清洗存量重复模块。
