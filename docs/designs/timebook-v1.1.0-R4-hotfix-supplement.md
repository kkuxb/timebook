# 时间簿（Timebook）v1.1.0-R4 启动卡「正在加载时间簿…」根因与定向修复补充简报

- **日期 / 轮次**：2026-11-19 / `v1.1.0-R4`（累计第 4 轮，基于用户安装实操反馈明确要求检查原因并修复；保留前 3 轮历史记录不清零）
- **关联文档**：[v1.1.0 设计方案](timebook-v1.1.0-design.md) ｜ [v1.1.0 实施计划](timebook-v1.1.0-implementation-plan.md) ｜ [v1.1.0 测试计划](timebook-v1.1.0-test-plan.md)

---

## 1. 现象与只读复现铁证

用户在本机安装 `v1.1.0-R3` 后正常双击打开桌面端，主窗口一直停留在空白「`正在加载时间簿…`」界面。

经 `PM` 在隔离目录通过 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=..."` 对 `v1.1.0-R3` 真实 `timebook-desktop.exe` 进行只读复现与 `performance.getEntriesByType('resource')` 调用链取证，100% 稳定复现并锁定**三重叠加根因**：

1. **主根因（原生层状态注册晚于前端页面加载的启动时序竞态）**：
   - `apps/desktop/src-tauri/src/lib.rs` 的 `.setup()` 钩子中，先执行了磁盘配置读写、每日自动备份 `ensure_daily_local_backup`、系统托盘创建 `setup_tray`、全局热键注册及非 `--minimized` 下的 `show_and_focus_main`（触发窗口消息循环），**最后在第 429 行才调用 `app.manage(DesktopState { ... })`**。
   - 一旦前端页面加载较快（尤其是正常双击启动，或第 2 次启动已有缓存时），前端 `useAppStore.init()` 在第 6 个请求即发出 `invoke('desktop_get_init_state')`，此时 `DesktopState` 尚未注册，Tauri 直接报错返回失败。
2. **链式放大根因（`VitePWA` `sw.js` 在桌面端缓存劫持 + `init()` 无异常兜底）**：
   - `apps/web/vite.config.ts` 默认全局注入 `/registerSW.js` 激活了 `sw.js` Service Worker：一方面使第 2 次及以后启动时前端脚本从内存缓存毫秒级完成加载，100% 抢跑在 `app.manage(DesktopState)` 之前；另一方面**会在用户的 `%LOCALAPPDATA%\com.timebook.desktop\EBWebView` 中持久缓存旧版 `index.html` 与 `JS` 资源，导致后续覆盖安装新版 `.exe` 时仍被旧 `sw.js` 劫持加载旧前端代码**。
   - 同时 `apps/web/src/store/useAppStore.ts` 的 `init()` 未包裹 `try/catch` 且 `desktopBridge.getInitState()` 无暂态重试，`invoke` 一旦失败即中断异步流，`authState` 永久停留在 `'checking'`（即卡死在「正在加载时间簿…」）。
3. **存量脏数据清洗缺口**：
   - `useAppStore.ts` 仅在 `localDb.modules.count() === 0` 时调用了 `dedupeDuplicateModules`；若用户本机已存在早期生成的重复同名默认模块（如 12 个模块），启动时未自动去重合并。
4. **前序 `QA` 漏检原因**：
   - 前序测试在检查真实 `timebook-desktop.exe` 时仅传了 `--minimized` 检查磁盘 JSON 文件，而界面断言使用了静态 HTTP + `?desktopMock=1`，未通过 `CDP` 直连真实 `timebook-desktop.exe` 内置 `WebView2` 验证「非 `--minimized` 正常启动 / 第 2 次冷启动 / 存量旧 `sw.js` 覆盖升级启动」。

---

## 2. 允许变更范围与根治要求（`dev` 执行）

仅修改以下与该根因直接相关的文件，严禁触碰无关业务逻辑（统计、日历、待办、`Notion` 导入、服务端 `API` 均保全不动）：

1. **`apps/desktop/src-tauri/src/lib.rs`**：
   - 在 `.setup()` **最开头**先完成 `data_dir` 与初始 `config` 读取并**立即执行 `app.manage(DesktopState { ... })`**，确保任何时刻前端发起 `desktop_get_init_state` 均能立即成功拿到状态；然后再执行每日备份、托盘创建、全局快捷键注册与窗口显示。
   - 将 `on_window_event` 中的 `window.state::<DesktopState>()` 全部改为安全的 `window.try_state::<DesktopState>()`，杜绝早期窗口事件 panic。
   - **原生层旧 `Service Worker` 自愈清理（关键！保障用户直接覆盖安装即刻生效）**：在 `Builder`（如 `.on_page_load` 或窗口初始化脚本 / `setup` 中对 `main`/`widget`/`launcher` WebView 注入脚本）增加一段仅针对 `tauri.localhost` 的自愈逻辑：若检测到 `navigator.serviceWorker` 存在已注册的 Service Worker，立即注销全部 registration、清空 `caches`，且若当前页已被 `navigator.serviceWorker.controller` 控制（说明本次加载可能命中了旧版 `sw.js` 缓存），立即触发一次防循环的 `window.location.reload()` 以强制加载新 `.exe` 内嵌的最新前端资源。
2. **`apps/web/vite.config.ts` 与 `apps/web/src/main.tsx`**：
   - 将 `VitePWA` 配置加上 `injectRegister: null`（或 `false`），不再无条件在 `index.html` 硬编码注入 `/registerSW.js`；
   - 在 `main.tsx` 中判断：仅当**非桌面环境**（`!isDesktopEnvironment() && window.location.hostname !== 'tauri.localhost'`）且生产环境支持 `serviceWorker` 时，才注册 `/sw.js`（保持网页版与手机 `PWA` 离线安装能力 100% 不变）；桌面环境下永不注册 `sw.js`，若发现残留 registration 则静默注销并清 `caches`。
3. **`apps/web/src/lib/desktopBridge.ts` 与 `apps/web/src/store/useAppStore.ts`**：
   - 在 `desktopBridge.getInitState()` 对 `invoke('desktop_get_init_state')` 增加最多 5 次短间隔退避重试（如 `40ms / 80ms / 160ms / 300ms`）；
   - 在 `useAppStore.init()` 的桌面分支加上完整 `try / catch` 保底：任何异常不得阻断 `authState: 'authenticated'` 切换，失败时使用 `localDb` 现有数据或默认四模块种子兜底进入主页并设置可读 `errorBanner`；
   - **存量重复模块自动清洗**：`main` 窗口启动时无论 `localDb.modules.count()` 是否为 `0`，对合并加载出的模块与事项统一检查一次 `dedupeDuplicateModules`（若 `deduped === true` 或 `initRes.snapshot` 含重复默认模块但 `localDb` 为空，则重写清理后的唯一模块列表回 `localDb`（`clear` 后 `bulkPut`）并同步写回 `timebook-local.json`），确保用户本机已有的 12 个重复默认模块在打开新版后自动恢复为干净的 4 个模块。
4. **补充单元测试**：
   - 在 `packages/core/test/merge.test.ts`（或桌面存储测试）验证存量 12 个重复默认模块清洗后严格保留 4 个默认模块且既有事项关联不丢失。

---

## 3. 定向正反例验证要求（`qa` 必查）

本轮 `v1.1.0-R4` 必须对独立发布包重编译出的真实 `timebook-desktop.exe`（通过 `TIMEBOOK_DESKTOP_DATA_DIR` + `WEBVIEW2_USER_DATA_FOLDER` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=<port>"` 连接真实 `Tauri WebView2`）完成以下三项真机级验证（为避免抢焦点，允许测试无 `--minimized` 启动时将初始测试配置 `widgetPosition` 移偏或验证完立即按 PID 关闭，但**至少覆盖一次真实 WebView2 连续重启与旧 SW 升级验证**）：

1. **正例 1（全新目录连续 3 次冷启动）**：在全新隔离目录启动真实 `timebook-desktop.exe`，通过 `CDP` 检查 `http://tauri.localhost/` 第 1 次、关闭后第 2 次、关闭后第 3 次启动均在 3 秒内正常渲染出完整「今日」主页（绝不停留在「正在加载时间簿…」），且 `navigator.serviceWorker.controller === null`、模块严格为 4 个。
2. **正例 2（1:1 模拟用户本机已安装 `R3` 后的覆盖升级场景）**：
   - 先在同一隔离 `DATA_DIR` 与 `WEBVIEW2_USER_DATA_FOLDER` 下运行一次旧包 **`v1.1.0-R3` 的 `timebook-desktop.exe`**（使其在 `WebView2` 中真实种下旧版 `sw.js` 缓存，并在 `timebook-local.json` 写入 12 个重复默认模块，复现第 2 次启动卡在「正在加载时间簿…」的现场）；
   - 终止旧进程后，**不删除该隔离目录**，直接在同一隔离目录启动新编译的 **`v1.1.0-R4` `timebook-desktop.exe`**；
   - 通过 `CDP` 亲眼核验并截图证明：新版自动清除旧 `sw.js` 缓存、成功进入完整「今日」主界面（不卡「正在加载时间簿…」），且顶部模块与 `timebook-local.json` 已自动从 12 个重复模块清洗恢复为**严格唯一的 4 个默认模块**！
3. **回归正例 3（网页版 `PWA` 构建产物检查）**：确认 `apps/web/dist/sw.js` 与 `manifest.webmanifest` 依然正常产出，普通网页环境仍正常注册 `PWA`，零退化。
