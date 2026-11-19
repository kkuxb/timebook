# 时间簿（Timebook）v1.1.0 Windows 桌面版实施计划

- **日期 / 版本**：2026-11-19 / `v1.1.0`
- **依据设计**：[v1.1.0 Windows 桌面版设计方案](timebook-v1.1.0-design.md)（已于 2026-11-19 经用户确认冻结，确认条目 `C-08`～`C-12` 见 [讨论纪要第 3 节](../requirements/timebook-讨论纪要.md)）
- **本轮授权终点**：当前会话仅完成计划落盘与五项自查；由用户新建会话后，由 `PM` 直接按阶段 4 启动 `Swarm`（`dev` + `qa`）实施。
- **既有基线与边界**：基于已验收基线 `v1.0.0`（`eb3ae6d`）。严禁修改 `prototype/` 原件，严禁破坏一期网页版/`PWA`/`Docker` 构建与 14 项既有测试，严禁触碰其他项目目录或调用 `Notion` 写接口。

---

## 一、文件职责、共用接口合同与依赖顺序

### 1.1 新增与变更文件映射

```text
timebook/
├─ .gitignore                                      # [修改] 新增 target/ 忽略 Rust 编译目录
├─ package.json                                    # [修改] 新增 desktop:dev / desktop:build / desktop:test 脚本
├─ scripts/
│  └─ release_app.py                               # [修改] EXCLUDE_DIRS 新增 target，安全扫描新增 .rs / .toml
├─ .github/
│  └─ workflows/
│     └─ release-desktop.yml                       # [新增] GitHub Actions Windows 桌面安装包自动构建配置
├─ packages/
│  └─ core/
│     ├─ src/
│     │  ├─ merge.ts                               # [新增] 默认四模块种子生成、单机数据转连 NAS 无损合并纯函数
│     │  └─ index.ts                               # [修改] 导出 merge.ts
│     └─ test/
│        └─ merge.test.ts                          # [新增] 单机转连 NAS 合并去重与幂等序列单元测试
├─ apps/
│  ├─ api/
│  │  ├─ src/
│  │  │  ├─ auth.ts                                # [修改] 登录响应附带签名 token，鉴权兼容 Cookie 或 Bearer Token
│  │  │  └─ app.ts                                 # [修改] 受控 CORS 头支持桌面端跨域连接 NAS
│  │  └─ test/
│  │     └─ api.test.ts                            # [修改] 新增 Bearer Token 登录、跨域头与幂等同步回归断言
│  ├─ web/
│  │  └─ src/
│  │     ├─ lib/
│  │     │  └─ desktopBridge.ts                    # [新增] 桌面端运行环境识别、Tauri IPC 桥接与多窗口实时广播总线
│  │     ├─ store/
│  │     │  └─ useAppStore.ts                      # [修改] 扩展单机/NAS 双模式、本地文件双写恢复、首次连 NAS 合并上传
│  │     ├─ components/
│  │     │  ├─ DesktopTitlebar.tsx                 # [新增] 桌面无边框圆角顶栏（拖拽区、双模胶囊、小窗显隐、缩托盘）
│  │     │  ├─ AppShell.tsx                        # [修改] 桌面环境下挂载 DesktopTitlebar，网页环境保持原顶栏不变
│  │     │  └─ SettingsDrawer.tsx                  # [修改] 桌面环境下新增「桌面版与数据同步」设置区
│  │     ├─ pages/
│  │     │  ├─ WidgetPage.tsx                      # [新增] 置顶灵动胶囊小窗视图（紧凑窄条/悬停展开/白底墨底切换）
│  │     │  └─ LauncherPage.tsx                    # [新增] 全局快捷键 Ctrl+Alt+T 极速呼出框视图
│  │     └─ App.tsx                                # [修改] 根据 ?window=widget | launcher 分流渲染独立轻量窗口
│  └─ desktop/                                     # [新增] @timebook/desktop (Tauri v2 桌面壳)
│     ├─ package.json                              # 封装 @tauri-apps/cli 构建与启动脚本
│     └─ src-tauri/
│        ├─ Cargo.toml                             # Tauri v2、global-shortcut、autostart、serde 等依赖
│        ├─ build.rs
│        ├─ tauri.conf.json                        # 应用标识 com.timebook.desktop、NSIS 安装包与多窗口定义
│        ├─ capabilities/default.json              # Tauri v2 最小权限声明
│        ├─ icons/                                 # 由时间簿黄底时钟矢量图生成的标准 .ico 与多尺寸 .png
│        └─ src/
│           ├─ main.rs                             # 进程入口（支持 --minimized 静默驻留托盘启动参数）
│           ├─ storage.rs                          # 本地数据目录解析、原子落盘 timebook-local.json、每日自动备份轮转
│           ├─ tray.rs                             # 系统托盘状态更新、右键动态菜单（结束计时/最近5个常用事项/主窗/退出）
│           └─ lib.rs                              # 三窗口管理(main/widget/launcher)、全局快捷键注册、IPC 命令与 Rust 单测
└─ docs/
   └─ Windows桌面版使用说明.md                      # [新增] 面向个人日常使用的安装、单机备份与接入 NAS 操作说明
```

### 1.2 跨组件共用接口合同（唯一权威定义）

1. **隔离目录与持久化路径规则（保障开发/测试零污染真实系统）**：
   - 数据目录解析优先级：若存在环境变量 `TIMEBOOK_DESKTOP_DATA_DIR` 且非空，则以该路径作为 `<desktop_data_dir>`；否则取操作系统 `%APPDATA%/com.timebook.desktop`。
   - 本地业务数据文件：`<desktop_data_dir>/timebook-local.json`（格式：`{ version: 1, savedAt, modules, tags, sessions, todos, todoChecks }`，采用写入临时文件 `.tmp` 后原子替换策略）。
   - 桌面配置文件：`<desktop_data_dir>/desktop-config.json`，结构如下：
     ```ts
     export interface DesktopConfig {
       connectionMode: 'local' | 'nas';     // 默认 'local'
       serverUrl: string;                   // 例如 'http://192.168.x.x:3210' 或 Tailscale HTTPS 地址，初始 ''
       sessionToken: string;                // 登录 NAS 获取的签名令牌，初始 ''
       backupDir: string;                   // 默认：隔离模式下为 '<desktop_data_dir>/backups'，正式环境为 '<用户文档>/TimebookBackups'
       lastLocalBackupDate: string | null;  // 'YYYY-MM-DD'
       widgetVisible: boolean;              // 默认 true
       autoHideWidgetWhenIdle: boolean;     // 默认 false
       widgetSkin: 'light' | 'dark';        // 默认 'light'
       widgetPosition: { x: number; y: number } | null;
       closeToTray: boolean;                // 默认 true
       autostart: boolean;                  // 默认 false（注意：当设置了 TIMEBOOK_DESKTOP_DATA_DIR 隔离变量时，仅更新此配置字段，不写宿主机真实 Windows 注册表 Run 项）
       globalShortcut: string;              // 默认 'CommandOrControl+Alt+T'
     }
     ```
2. **前后端向后兼容令牌协议（`apps/api`）**：
   - `POST /api/login`：成功时除 `Set-Cookie: tb_session=<token>` 外，JSON 响应体返回 `{ ok: true, serverTime, token }`。
   - `requireAuthMiddleware`：优先取 `Cookie` 中的 `tb_session`；若无，则读取 `Authorization` 请求头（匹配 `^Bearer\s+(.+)$`）提取 `token`，调用同一 `verifySessionToken(token, authConfig.secret)` 校验。
   - `CORS` 响应头：对带 `Origin` 的 `/api/*` 请求回显受控跨域头（允许 `GET, POST, DELETE, OPTIONS` 及 `Authorization, Content-Type` 头），确保本地桌面窗口请求任意 `NAS` 地址不被 WebView 拦截。
3. **单机转连 `NAS` 无损合并协议（`planLocalToRemoteMerge`）**：
   - 输入：本机有效快照 `local` 与刚从 `NAS` `GET /api/sync?since=0` 拉到的 `remote`。
   - 映射规则：
     - 模块对齐：按 `deleted_at === null` 且 `name.trim()` 完全相同匹配（如本机默认「工作」自动映射到远端默认「工作」`remoteMod.id`）；未匹配到的本机自定义模块保留原 `ULID` 生成 `module.upsert`。
     - 事项对齐：在映射后的同一 `module_id` 下，按 `deleted_at === null` 且 `name.trim()` 相同匹配映射到 `remoteTag.id`；未匹配到的本机事项将 `module_id` 替换为映射后模块 `ID`，生成 `tag.upsert`。
     - 记录与待办合并：将本机所有未同步至远端（`!remoteSessionIds.has(s.id)`）的 `sessions`、`todos`、`todoChecks` 中的 `tag_id` 替换为映射后的 `tagId`，按依赖顺序生成幂等 `MutationItem[]`（`modules -> tags -> todos -> todoChecks -> sessions`），一次性或分批（每批 `<= 200` 条）通过 `POST /api/mutations` 提交至 `NAS`。
4. **`Tauri` 原生 IPC 命令与多窗事件合同**：
   - 命令：`desktop_get_init_state`、`desktop_save_snapshot`、`desktop_save_config`、`desktop_run_local_backup`、`desktop_set_widget_expanded`、`desktop_sync_tray`、`desktop_window_action`（`minimizeMain | closeMain | showMain | toggleWidget | hideLauncher | quitApp`）。
   - 多窗口实时同步事件：任一窗口（`main`、`widget`、`launcher` 或托盘原生菜单点击）修改计时或配置后，同时通过 `Tauri emit('timebook://state-updated', payload)` 与浏览器 `BroadcastChannel('timebook-sync-bus')` 广播，其余窗口收到后立即刷新内存状态（延迟 `< 50ms`）。

### 1.3 任务依赖顺序

`T1 (P0 Rust 工具链探针与桌面包骨架)` → 并行可推进 `T2 (API 令牌与跨域兼容)` + `T3 (Core 单机种子与合并纯函数)` → `T4 (Tauri Rust 原生存储/备份/托盘/快捷键/多窗)` → `T5 (Web 双模式 Store、无边框顶栏与桌面设置)` → `T6 (灵动胶囊小窗与全局呼出框)` → `T7 (CI 配置、使用说明、打包与全链路冒烟)`。

---

## 二、分步可执行任务

### 任务 T1（P0 探针与骨架）：安装本机 `Rust` 工具链并初始化 `apps/desktop` 工程

- **对应设计要求**：第 2.1、3 节工具链准备（已获 `C-09`、`C-12` 用户明确授权）与 `Tauri v2` 工程骨架。
- **文件与资源**：`.gitignore`、`package.json`、`pnpm-workspace.yaml`、`scripts/release_app.py`、`apps/desktop/**`。
- **前置与依赖**：无前置任务。
- **实施动作**：
  1. **安装并验证 `Rust` 工具链**：检查 `%USERPROFILE%\.cargo\bin\rustc.exe` 是否已存在；若不存在，下载官方 `https://win.rustup.rs/x86_64` 至 `workspace-data/tmp/rustup-init.exe`，执行 `rustup-init.exe -y --default-toolchain stable-x86_64-pc-windows-msvc --profile minimal` 静默安装到当前用户目录，随后验证 `rustc -V` 与 `cargo -V` 可正常输出版本号。
  2. 更新 `.gitignore` 加入 `target/`；更新 `scripts/release_app.py`：在 `EXCLUDE_DIRS` 中加入 `"target"`，在 `security_scan` 的 `text_exts` 中加入 `".rs"` 与 `".toml"`。
  3. 创建 `apps/desktop/package.json`（安装 `@tauri-apps/cli@^2` 与 `@tauri-apps/api@^2`）及 `apps/desktop/src-tauri/` 基础结构，使用 Python 脚本从时间簿品牌黄底时钟图标生成合规的 `icons/icon.ico`、`32x32.png`、`128x128.png`（RGBA 格式，满足 `Tauri` Windows 资源编译要求）。
- **验证**：运行 `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` 退出码为 `0`。
- **完成与阻塞**：`cargo check` 通过即完成；若官方 `rustup` 或 `crates.io` 下载因网络问题连续重试失败，立即发送 `@coordinator [blocked]` 说明具体报错，不篡改系统全局网络配置。

### 任务 T2：`@timebook/api` 服务端 `Bearer` 令牌与桌面跨域兼容

- **对应设计要求**：第 2.2 节桌面程序远程连接绿联 `NAS` 鉴权与跨域兼容。
- **文件与资源**：`apps/api/src/auth.ts`、`apps/api/src/app.ts`、`apps/api/test/api.test.ts`。
- **前置与依赖**：独立于 `T1`，可先行或并行。
- **实施动作**：
  1. 在 `auth.ts` 中让 `issueSessionCookie` 返回生成的签名 `token` 字符串；在 `extractSessionToken(c)` 中先查 `getCookie(c, SESSION_COOKIE_NAME)`，为空再解析 `c.req.header('authorization')` 的 `Bearer <token>`。
  2. 在 `app.ts` 中为 `/api/*` 增加 `OPTIONS` 预检与跨域响应头支持，并在 `POST /api/login` 成功响应中返回 `{ ok: true, serverTime: Date.now(), token }`。
  3. 在 `apps/api/test/api.test.ts` 新增测试用例：不带 `Cookie` 仅凭 `Authorization: Bearer <token>` 请求 `/api/sync` 与 `/api/mutations` 返回 `200`；伪造或过期 `Bearer` 返回 `401`；原有 `Cookie` 流程保持 100% 通过。
- **验证**：运行 `corepack pnpm --filter @timebook/api test` 全绿。
- **完成与阻塞**：测试全通过且零破坏既有接口。

### 任务 T3：`@timebook/core` 单机默认种子与单机转连 `NAS` 无损合并纯函数

- **对应设计要求**：第 1 节质量底线第 2 条、第 2.2 节首次连 `NAS` 无损合并（`C-11`）。
- **文件与资源**：`packages/core/src/merge.ts`、`packages/core/src/index.ts`、`packages/core/test/merge.test.ts`。
- **前置与依赖**：无外部依赖。
- **实施动作**：
  1. 实现 `createDefaultModulesSeed(nowMs)`：返回标准 4 个默认模块（`工作/blue`、`学习/violet`、`游戏/teal`、`锻炼/rose`），与服务端种子完全同构。
  2. 实现 `planLocalToRemoteMerge(local, remote)`：
     - 输入本机与远端五张表数组；
     - 对同名未删模块（如本机 `工作` 与远端 `工作`）建立 ID 映射，避免合并后出现两个「工作」模块；对同模块下同名未删事项建立 ID 映射；
     - 返回 `{ remappedLocalState, mutationsToPush }`，其中 `mutationsToPush` 包含本机新增模块、新增事项、全部待合并待办、重复打卡与专注记录（含进行中计时），所有外键均已重写为对齐后的目标 ID。
  3. 编写 `merge.test.ts`：覆盖「单机默认 4 模块 + 新建自定义模块 + 新建事项 + 已结束与进行中记录 + 待办」合并到「远端全新空库（仅有默认 4 模块但 ID 不同）」及「远端已有部分历史数据的库」两种场景，断言合并后模块不重复、记录条数与总时长 100% 守恒。
- **验证**：`corepack pnpm --filter @timebook/core test` 全绿。
- **完成与阻塞**：单测 100% 通过。

### 任务 T4：实现 `apps/desktop` `Rust` 原生存储、每日自动备份、系统托盘、全局快捷键与多窗口

- **对应设计要求**：第 2.2 节本地文件防丢双保险、第 2.3 节主窗缩托盘/置顶小窗/托盘最近常用菜单/全局快捷键。
- **文件与资源**：`apps/desktop/src-tauri/src/{main.rs,lib.rs,storage.rs,tray.rs}`、`tauri.conf.json`。
- **前置与依赖**：依赖 `T1`。
- **实施动作**：
  1. `storage.rs`：实现基于 `TIMEBOOK_DESKTOP_DATA_DIR`（优先）或系统 `app_data_dir` 的原子 JSON 读写；实现 `ensure_daily_local_backup` 与 `run_local_backup_now`（向配置的 `backupDir` 写入 `timebook-local-YYYY-MM-DD.json`，自动保留最近 30 份备份文件）。
  2. `tray.rs`：创建系统托盘图标，监听左键点击唤起并聚焦 `main` 窗口；实现 `rebuild_tray_menu` 动态挂载菜单项：
     - 状态说明项（如 `单机模式 · 2 个进行中`）；
     - 当前进行中计时快捷「结束：`<名称>`」动作项 +「结束全部进行中计时」；
     - 「快速开始最近常用」子菜单或分组（最多 5 个事项，点击直接向前端发送 `timebook://tray-quick-start` 事件）；
     - 「显示 / 隐藏悬浮小窗」、「打开时间簿主窗口」、「彻底退出时间簿」。
  3. `lib.rs`：
     - 管理 `main`、`widget`、`launcher` 三个窗口；拦截 `main` 的 `CloseRequested` 事件，当 `closeToTray == true` 时阻止销毁改为 `window.hide()`；支持命令行 `--minimized` 启动时隐藏 `main` 窗口；
     - 集成 `tauri-plugin-global-shortcut` 注册全局快捷键（默认 `CommandOrControl+Alt+T`，配置变更时先注销旧键再注册新键，冲突返回可读中文错误不崩溃），触发时置顶居中显示并聚焦 `launcher` 窗口；
     - 集成开机自启配置（当处于 `TIMEBOOK_DESKTOP_DATA_DIR` 隔离环境时仅持久化配置值而不污染宿主机注册表；正式环境调用 `tauri-plugin-autostart`）；
     - 实现 `desktop_set_widget_expanded` 动态调整 `widget` 窗口逻辑尺寸及保存拖拽后的窗口位置。
  4. 编写 `Rust` 单元测试（`#[cfg(test)]`）：验证原子快照读写、备份生成与 30 份轮转清理、托盘菜单数据组装与隔离目录逻辑。
- **验证**：`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` 全绿通过。
- **完成与阻塞**：原生层编译与单测全部通过。

### 任务 T5：实现 `@timebook/web` 双模式数据流、无边框主窗顶栏与桌面设置分区

- **对应设计要求**：第 2.1–2.3 节单一前端复用、双模式无缝切换与定制主窗口。
- **文件与资源**：`apps/web/src/lib/desktopBridge.ts`、`apps/web/src/store/useAppStore.ts`、`apps/web/src/components/{DesktopTitlebar.tsx,AppShell.tsx,SyncStatusPill.tsx,SettingsDrawer.tsx}`。
- **前置与依赖**：依赖 `T2`、`T3`、`T4`。
- **实施动作**：
  1. `desktopBridge.ts`：封装 `isDesktopEnvironment()`（支持真实 `window.__TAURI_INTERNALS__` 及浏览器隔离测试模拟桥 `?desktopMock=1`），提供读写本地快照、读写桌面配置、触发备份、控制窗口、同步托盘及跨窗口实时事件订阅。
  2. `useAppStore.ts`：
     - 在普通网页环境下保持 `v1.0.0` 原有口令登录与同源 `/api/*` 逻辑 100% 不变；
     - 在桌面端 `connectionMode === 'local'` 下：跳过口令页直接 `authState = 'authenticated'`；初始化时若 `IndexedDB` 无数据则从 `timebook-local.json` 恢复（仍为空则写入默认四模块种子）；每次业务变更同步调用 `desktop_save_snapshot` 落盘并刷新托盘数据（提取最近使用过的 5 个未删事项传给托盘），右上角同步胶囊展示青绿圆点 **「本机已保存 · 单机模式」**；
     - 在桌面端连接 `NAS` 动作 `connectToNas(serverUrl, password)`：规范化 URL 后请求 `POST ${serverUrl}/api/login` 获取 `token` → 拉取 `${serverUrl}/api/sync?since=0` → 调用 `planLocalToRemoteMerge` 计算合并项并推送 `${serverUrl}/api/mutations` → 拉回权威状态覆盖本地 `Dexie` 与 `timebook-local.json` → 保存 `connectionMode = 'nas'`、`serverUrl`、`sessionToken`，切换为增量同步心跳循环；支持随时「切换回单机模式」（保留当前本机全部数据不断联报错）。
  3. `DesktopTitlebar.tsx` & `SettingsDrawer.tsx`：桌面主窗顶部提供可拖拽标题栏（含小窗显隐按钮与最小化/隐藏到托盘按钮）；设置抽屉在桌面端顶部呈现「桌面版与数据同步」完整配置卡（单机/`NAS` 切换、备份目录与「立即备份到本地」、开机自启、关闭缩托盘、无计时自动隐藏小窗、小窗白底/墨底切换、全局快捷键自定义）。
- **验证**：`corepack pnpm --filter @timebook/web build` 零类型与打包错误；一期既有测试回归全通。
- **完成与阻塞**：网页模式与桌面双模式状态流转全部就绪。

### 任务 T6：实现置顶灵动胶囊小窗（`WidgetPage`）与全局呼出框（`LauncherPage`）

- **对应设计要求**：第 2.3 节第 2、4 条及用户确认的交互原型（`C-10`）。
- **文件与资源**：`apps/web/src/pages/{WidgetPage.tsx,LauncherPage.tsx}`、`apps/web/src/App.tsx`。
- **前置与依赖**：依赖 `T5`。
- **实施动作**：
  1. `App.tsx`：读取 URL 查询参数 `window=widget` 或 `window=launcher` 时，跳过主壳直接渲染对应极轻量组件，并将页面 `body` 设为透明以适配圆角无边框窗口。
  2. `WidgetPage.tsx`（严格对齐原型「方案一：灵动胶囊」）：
     - 紧凑态：圆角胶囊（支持按住非按钮区拖拽窗口），展示首条进行中计时的呼吸模块色点、事项/标题、多条并行 `+N` 黄底徽标及等宽每秒读数；无进行中计时时显示「当前空闲 · `+ 开始专注`」（若开启 `autoHideWidgetWhenIdle` 则自动隐藏窗口，有新计时时自动重新显示）；
     - 悬停展开态：`onMouseEnter` 通知原生窗口扩展高度并丝滑展开全部进行中计时行（每行带「结束」按钮）与底部「`+ 新建专注`」「`主界面`」按钮，`onMouseLeave` 收回紧凑态；
     - 完整响应 `widgetSkin`（`light` 白底干净 `#FFFFFF` vs `dark` 墨色深底 `#111827`）实时切换。
  3. `LauncherPage.tsx`：居中置顶圆角面板，显示时自动聚焦具体内容输入框，展示常用事项标签胶囊，支持键盘回车立即开始计时并隐藏窗口、按 `Esc` 取消关闭。
- **验证**：在多窗口下实测主窗、胶囊小窗与呼出框秒级同步、皮肤切换与自动显隐准确无误。
- **完成与阻塞**：桌面四部件交互闭环全部完成。

### 任务 T7：云端自动打包配置、中文桌面使用说明、本机实编安装包与发布打包自测

- **对应设计要求**：第 1、3、4 节安装包交付、云端配置与文档要求。
- **文件与资源**：`.github/workflows/release-desktop.yml`、`docs/Windows桌面版使用说明.md`、`scripts/release_app.py`。
- **前置与依赖**：依赖 `T1`–`T6` 全部完成。
- **实施动作**：
  1. 编写 `.github/workflows/release-desktop.yml`：配置在 `windows-latest` 安装 `Node 20`、`pnpm`、`Rust stable`，运行 `pnpm test` 后执行 `Tauri` 构建并上传 `-setup.exe` 安装包产物。
  2. 编写 `docs/Windows桌面版使用说明.md`：纯中文自然语言说明（① 双击安装与单机零配置开始用；② 灵动胶囊小窗、右下角托盘秒开常用事项与 `Ctrl+Alt+T` 快捷键用法；③ 单机本地自动备份位置与恢复方法；④ 以后绿联 `NAS` 部署好后如何填入地址一键把单机历史合并同步上去）。
  3. **完整构建与移交前自测**：
     - 运行全仓单测 `corepack pnpm test` 与 `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`；
     - 运行真实桌面打包构建 `corepack pnpm desktop:build`，确认在 `src-tauri/target/release/` 产出真实可运行的 `timebook-desktop.exe` 与 `bundle/nsis/*-setup.exe` 安装包；
     - 设置隔离环境变量 `TIMEBOOK_DESKTOP_DATA_DIR` 启动编译出的真实桌面程序（传 `--minimized` 避免干扰桌面焦点），验证 `timebook-local.json` 与本地备份文件真实生成后正常退出进程；
     - 运行 `python scripts/release_app.py build --output workspace-data/outputs/timebook/v1.1.0-R1/timebook.zip` 构建源码发布包（并用 `unpack_verify.py` 试解压校验 `"ok": true`），同时将本轮实编产出的便携程序与 `-setup.exe` 安装包复制到 `workspace-data/outputs/timebook/v1.1.0-R1/installers/` 目录附带 SHA-256 清单供 `QA` 与用户核验。
- **验证**：`pnpm test`、`cargo test`、`pnpm desktop:build`、`unpack_verify.py` 全部成功，所有自测临时进程已关闭。
- **完成与阻塞**：自测通过后在 `Swarm` 面板向 `@qa` 发送 `[review_requested]` 及结构化交接清单。

---

## 三、计划五项自查记录

1. **需求覆盖自查**：已逐条核对 [v1.1.0 设计方案](timebook-v1.1.0-design.md) 与确认条目 `C-08`～`C-12`，单机+`NAS` 双模式、本地文件双写与每日备份、单机转连 `NAS` 同名模块合并复用、主窗缩托盘、灵动胶囊小窗（悬停展开+白底/墨底切换+无计时隐藏）、托盘最近 5 个常用事项、全局快捷键呼出框、本机编译安装包与 `GitHub Actions` 配置均已落到具体任务与验证命令。
2. **接口一致性自查**：`DesktopConfig` 字段、`Bearer` 令牌头、`planLocalToRemoteMerge` 输出格式与 `Tauri` 多窗同步事件在 `core` / `api` / `web` / `desktop` 四端完全对齐；已提前识别并修补了 `scripts/release_app.py` 需忽略 `Rust` `target/` 目录的关键点。
3. **可执行性自查**：将本机安装官方 `Rust` 工具链列为 `T1` 明确可验证步骤，为自动化隔离测试专门设计了 `TIMEBOOK_DESKTOP_DATA_DIR` 与 `--minimized` 启动机制，无任何模糊占位。
4. **顺序与权限自查**：任务依赖成有向无环图；严格限制隔离测试期间不改宿主机真实注册表、不写用户真实个人文档目录、不碰日常浏览器与 `Notion`。
5. **范围与复杂度自查**：直接复用 `@timebook/web` 单一前端代码库，未引入多余第三方重框架或未确认功能。**结论：自查通过，可在下一会话直接派单实施。**

---

## 四、`v1.1.0-R4` 定向修复补充（2026-11-19 用户实操反馈追加）

- **补充依据**：[v1.1.0-R4 启动卡「正在加载时间簿…」根因与定向修复补充简报](timebook-v1.1.0-R4-hotfix-supplement.md)（覆盖原 3 轮暂停上限，追加第 4 轮定向修复）。
- **执行任务 `T8`**：按上述补充简报第 2 节同步修改 `apps/desktop/src-tauri/src/lib.rs`（`setup` 首步立即 `app.manage(DesktopState)`、`try_state` 安全保护、`tauri.localhost` 旧 `Service Worker` 自愈清理与重载）、`apps/web/vite.config.ts` 与 `apps/web/src/main.tsx`（桌面端禁注 `sw.js`，网页版保留 `PWA`）、`apps/web/src/lib/desktopBridge.ts` 与 `apps/web/src/store/useAppStore.ts`（`getInitState` 退避重试、`init` 异常防死锁兜底、存量重复同名模块自动清洗回写），实编产出 `v1.1.0-R4` 安装包与独立发布包后移交 `@qa`。
