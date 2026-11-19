# 时间簿（Timebook）v0.1.0 开源首发版验证与验收记录

结论：**可收口（已正式验收收口并开源发布 `v0.1.0`）**；用户业务确认：**已确认收口**（2026-11-19 18:11 用户在本机完成 Windows 桌面端覆盖安装实操体验后明确确认：「确认收口，请将本次开发整理为 V0.1.0：同步版本号并撰写 readme 等相关文档，然后完成必要检查并提交，最后推送远端、创建 tag 和 GitHub Release（附上 windows 桌面端安装包）」）。

版本映射说明：项目内部研发期间分两阶段迭代验收——第一阶段全栈 Web / 移动端 PWA / NAS 容器版（内部代号 `v1.0.0`，见 [一期验收记录](timebook-v1.0.0-acceptance.md)），第二阶段 `Tauri v2` Windows 轻量桌面版（内部代号 `v1.1.0-R1`～`R4`，见 [R4 终验报告](timebook-v1.1.0-R4-test-report.md)）。现按用户收口指令，将全仓包清单版本号统一同步收敛为首个 GitHub 开源正式版 **`v0.1.0`**。

源码、安装包与一致性：
- 全仓 `package.json`（根工程、`@timebook/core`、`@timebook/notion-import`、`@timebook/api`、`@timebook/web`、`@timebook/desktop`）、`apps/desktop/src-tauri/Cargo.toml`、`tauri.conf.json` 与数据导出元信息已统一同步为 `0.1.0`；
- 基于 `0.1.0` 版本号重新执行全仓类型检查、`21/21` 前端与接口单测、`4/4` `Rust` 原生单测、全栈构建与 `Tauri` 生产编译打包，生成正式发布包 `workspace-data/outputs/timebook/v0.1.0/timebook.zip` 及桌面端安装包与便携版程序，静态安全与隐私路径扫描零违规；只读原型目录 `prototype/` 零改动。

## 实际结果

任务及授权：完成全栈四视图、Notion 历史导入导出、绿联 NAS 容器部署套件及 Windows 轻量桌面版（单机免配直用 + 双保险本地备份 + 随时转连 NAS 无损去重合并 + 置顶灵动胶囊黑白双皮肤 + 托盘最近 5 常用事项秒开 + `Ctrl+Alt+T` 极速呼出框）全链路开发、四轮独立隔离盲测、真机 `WebView2 CDP` 连续冷启动与覆盖升级验证、用户本机安装验收，以及 `v0.1.0` 开源文档整理、Git 提交推送、`v0.1.0` 标签与 GitHub Release 发布；未处理项：`0`。

| 维度 | 观察及依据 | 判断 / 影响范围 |
| --- | --- | --- |
| 业务完成度 | 全栈四大主视图（今日/日历/统计/标签）、移动端 `PWA`、Notion 三表导入对账与整批撤销、桌面双模式存储合并及四大快捷部件全部落地并通过用户本机实测验收。 | **100% 满足全部已确认需求合同** |
| 质量 | `Vitest` `21/21` 单测与集成测试 + `Rust` `4/4` 原生单测全绿；`A1`–`A6`、`D1`–`D6` 及 `R4-P1`～`R4-P3` 真机 `WebView2 CDP` 验证全通；四轮盲测与实操中发现的多窗冷启动重复种子、呼出框选标签回车焦点、桌面状态延迟注册与 `sw.js` 缓存抢跑问题已全部根治。 | **数据零丢失、启动秒开、视觉严格对齐规范** |
| 权限与副作用 | 开源提交树经全量扫描无任何 `.env`、`*.sqlite*`、本机个人用户路径、局域网私密 IP 或第三方凭据泄漏；`workspace-data/` 与 `target/` 严格忽略不入库。 | **符合公开开源仓库安全标准** |
| 异常处理 | 单机双写原子替换防断电损坏、内置旧 `Service Worker` 自愈清理与前端 `try/catch` 防白屏死锁、存量重复模块自动无损清洗、NAS 断联橙色暂存与恢复幂等补传完备。 | **单机与联网异常自愈稳健** |
| 效率与成本 | 产品日常运行消耗 `0 Token`；Windows NSIS 安装包体积仅约 `2.15 MiB`（目标 `<= 15 MB`），真实冷启动进入主页仅 `0.76s`～`1.70s`，多窗状态同步延迟 `17.8ms`～`67.4ms`。 | **超轻量、低延迟、零运行费用** |
| 复杂度 | 单仓 `pnpm workspace` + `Tauri v2` 复用单一 `React` 前端代码库，前后端共享 `@timebook/core` 纯函数计算引擎，结构清晰易读。 | **便于开源社区阅读与长期自维护** |
| 迁移与开源体验 | 根目录 [README.md](../../README.md) 面向开源使用者图文并茂展示 9 张实景截图与三种上手方式，配套 [Windows 桌面版使用说明](../Windows桌面版使用说明.md) 与 [绿联 NAS 部署指南](../绿联NAS部署指南.md)，GitHub Release 直接附带可下载安装包与校验文件。 | **开源开箱即用体验完备** |

## 发布与归档信息

- **开源仓库地址**：`https://github.com/kkuxb/timebook`
- **发布版本与标签**：`v0.1.0`
- **GitHub Release 附件**：Windows 安装包 `Timebook_0.1.0_x64-setup.exe`（中文安装向导）、免安装便携版 `Timebook_0.1.0_x64-portable.exe` 及 `SHA256SUMS.txt`
- **后续升级兼容**：桌面单机数据独立存于 `%APPDATA%/com.timebook.desktop/timebook-local.json` 与 `文档/TimebookBackups/`，NAS 容器数据独立挂载于 `/data/timebook.sqlite`，后续版本直接覆盖安装或更新镜像即可无损保留全部历史记录。
