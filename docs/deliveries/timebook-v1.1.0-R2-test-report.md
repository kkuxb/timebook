# 时间簿（`Timebook`）`v1.1.0` `R2` 验证与验收报告

> **给项目负责人的业务语言摘要**：本轮（`R2`）针对 `R1` 打回的 `D1-DEF-01`（多窗冷启动重复生成 12 个默认模块）完成独立包复测：**`D1-DEF-01` 已彻底修复通过**（全量 `20` 项单测与 `4` 项桌面原生单测 100% 通过，独立重现编译产出 `2.15 MiB` 安装包，真实桌面进程冷启动、二次重启及清缓存恢复均严格保持唯一 `4` 个默认模块），`D3` 多窗并发冷启动与毫秒同步（`17.8 ms` / 端到端 `67.42 ms`）同步通过。但在对受 `useAppStore.ts` 改动影响的 `D5`（全局快捷键呼出框）进行严格盲测复核时，**发现 1 项真实键盘流阻塞缺陷（`D5-DEFECT-1`）**：用户在呼出框输入内容后鼠标点选事项标签再直接按 `Enter` 时，因焦点停留在 `<button type="button">` 标签按钮上，导致 `Enter` 未能提交启动计时及收起呼出框，与界面提示「`Enter` 开始 · `Esc` 取消」及 `D5` 验收判据不符。当前为第 2 轮（未达 3 轮上限），本轮裁决为 **定向修复**，打回 `dev` 修复 `D5-DEFECT-1` 后进入 `R3` 定向复测。

结论：**定向修复**；用户业务确认：**待确认（需完成 `D5-DEFECT-1` 定向修复与 `R3` 复测后再交用户验收）**。

源码、安装副本、包版本与一致性：基于独立发布包 `workspace-data/outputs/timebook/v1.1.0-R2/timebook.zip`（`116` 个文件，`sha256: 807fd91af5e7d77e574f67c9ecaf571b5bb167708db89095ed5d26cf761c8907`）解压至 `workspace-data/tmp/qa/v1.1.0-R2/pkg/timebook` 实测；未修改任何包内文件或开发源码。`dev` 附带安装包 `workspace-data/outputs/timebook/v1.1.0-R2/installers/时间簿_1.1.0_x64-setup.exe`（`2,259,048` 字节）与 `timebook-desktop.exe`（`9,954,816` 字节）哈希与 `SHA256SUMS.txt` 一致；QA 在隔离解压包独立重现编译产出 `时间簿_1.1.0_x64-setup.exe`（`2,259,000` 字节 / `2.15 MiB`）与 `timebook-desktop.exe`（`9,956,352` 字节 / `9.50 MiB`）。

环境与测试范围：`Windows` 本机隔离目录（`TIMEBOOK_DESKTOP_DATA_DIR` + `WEBVIEW2_USER_DATA_FOLDER` + `--minimized` 后台启动）、无头 `Chromium 145.0.7632.6`（`Playwright` `?desktopMock=1` 多窗协同）及本地高端口（`14321`、`14323`、`14325`）。本轮复测受变更影响的 `D1`、`D3`、`D5`；`D2`、`D4`、`D6` 沿用 `R1` 有效通过证据（且其同源 `D1-DEF-01` 多窗冷启动 12 模块问题已在本轮 `D1` 与 `D3` 实测关闭）。未测范围同 `R1`。

---

## 实际结果

任务及授权：依据 [v1.1.0 测试计划](../designs/timebook-v1.1.0-test-plan.md) 在 `workspace-data/tmp/qa/v1.1.0-R2/` 执行定向复测，严格遵守只读发布包与无打扰隔离红线；本报告写入 `docs/deliveries/timebook-v1.1.0-R2-test-report.md`。

目标 / 确认完成 / 未处理：
- **本轮验证通过（含修复关闭项）**：静态安全扫描、全量构建、前端与接口单测（`20/20`，含新增 2 项多窗并发与去重单测）、桌面原生单测（`4/4`）、独立重现编译 `2.15 MiB` 安装包、`D1`（真实冷启动/重启/删 `webview2` 重建严格 4 模块，清 `IndexedDB` 自动无损恢复）、`D3`（多窗并发冷启动 4 模块、黑白双皮肤、跨页同步 `17.8 ms` / 端到端 `67.42 ms`）。
- **本轮复测不通过（必须修复）**：`D5-DEFECT-1`——呼出框点击事项标签后直接按 `Enter` 未能创建计时并关闭呼出框。

证据位置：
- 本轮计量：`workspace-data/qa/v1.1.0-R2/metrics.json`
- 复测回执：`workspace-data/tmp/qa/v1.1.0-R2/cases/D1-run1/result.json`、`D3-run1/result.json`、`D5-run1/result.json`
- 冷启动快照验证：`workspace-data/tmp/qa/v1.1.0-R2/cases/D1-run1/desktop-data/timebook-local.json`
- 关键视觉截图（均已由父级 `qa` 亲眼核验）：
  - [d1-main-local.png](../../workspace-data/tmp/qa/v1.1.0-R2/cases/D1-run1/d1-main-local.png)
  - [d3-widget-compact.png](../../workspace-data/tmp/qa/v1.1.0-R2/cases/D3-run1/d3-widget-compact.png)、[d3-widget-light.png](../../workspace-data/tmp/qa/v1.1.0-R2/cases/D3-run1/d3-widget-light.png)、[d3-widget-dark.png](../../workspace-data/tmp/qa/v1.1.0-R2/cases/D3-run1/d3-widget-dark.png)
  - [d5-launcher.png](../../workspace-data/tmp/qa/v1.1.0-R2/cases/D5-run1/d5-launcher.png)

### 七维复盘

| 维度 | 观察及依据 | 判断 / 影响范围 |
| --- | --- | --- |
| 业务完成度 | `D1` 彻底关闭 `D1-DEF-01`（真实 `timebook-desktop.exe --minimized` 三次启动均严格为 4 个默认模块）；`D3` 全部通过；`D5` 暴露「选标签后按 `Enter` 未提交」缺陷（仅点「立即开始」可提交） | **未完全闭环（`D1`、`D3` 通过，`D5` 存在 1 项阻塞缺陷）** |
| 质量 | 跨窗初始化并发与去重防护设计扎实；`D3` 同步延迟实测 `17.8 ms`；视觉截图符合规范（注：`R2-D3` `d3-widget-dark.png` 在 0.2s 切肤过渡中抓帧显过渡中间色，样式本体与 `R1` 一致正常）。`D5` 中 `LauncherPage.tsx` 点选标签按钮后焦点被 `<button type="button">` 截留导致键盘流断链 | **除 `D5` 回车提交焦点问题外，其余质量指标优异** |
| 权限与副作用 | 静态扫描清白；全过程使用隔离目录与无头浏览器；测试完毕检查无残留桌面进程或高端口监听 | **安全与隔离完全达标** |
| 异常处理 | 清空 `webview2` 或删除 `IndexedDB` 均无损恢复为 4 模块；`Esc` 取消呼出框零脏数据；但 `Enter` 在按钮焦点下被误吞导致静默无响应 | **`D5` 键盘回车操作缺少兜底处理** |
| 效率与成本 | 准备与编译：`pnpm install` `17.04s`、`pnpm build` `10.52s`、`pnpm test` `2.62s`、`cargo test` `85.00s`、`desktop:build` `130.42s`。盲测 `D1` 耗时 `203.0s`（较 `R1` `295.0s` 下降 `31.2%`），`D5` 耗时 `168.0s`（较 `R1` 下降 `34.1%`），`D3` 耗时 `614.0s`（超 `480s` 目标、未超 `900s` 硬上限，系多步冷启动+延时校验所致） | **编译与单测高效；关键场景 `D1` 达标** |
| 复杂度 | 主窗单点事务初始化 + 辅窗只读加载设计清晰，未引入复杂分布式锁 | **架构合理简洁** |
| 迁移与使用体验 | 呼出框核心卖点是「手不离键盘秒开计时」，顶部文案明确提示「`Enter` 开始 · `Esc` 取消」，若用户用鼠标点选标签后再按 `Enter` 无反应会严重影响实际使用流畅度 | **修复 `D5-DEFECT-1` 后即可达到顺滑免打扰键盘流体验** |

---

## 计量与修复

### 盲测子智能体实测计量与 `R1` 基线观察对照

| 场景 | 轮次 | 并发数 | 业务结果 | 时长（秒） | 模型请求步数 | 较 `R1` 均值变化 | 原生 `Token` / 费用 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `D1` | `R2` | `1` | **通过** | `203.0` | `16` | `-31.2%` 时长 / `-36.0%` 步数 | 不可用 |
| `D3` | `R2` | `2` | 通过 | `614.0` | `46` | `+81.1%` 时长 / `+31.4%` 步数 | 不可用 |
| `D5` | `R2` | `2` | **不通过** | `168.0` | `17` | `-34.1%` 时长 / `-15.0%` 步数 | 不可用 |
| `D2` / `D4` / `D6` | `R1` | `3` / `2` / `1` | 通过（复用） | `416.0` / `628.0` / `289.0` | `40` / `59` / `23` | 基线（未改） | 不可用 |

对照可比性与质量边界：`R2` 仅重跑受变更影响的 `D1`、`D3`、`D5`，且 `D1` 改为 `parallel=1` 单跑；不同并发度与断言步骤变化下的时长对比仅作观察参考。

### 必须修复项（`R3` 复测准入）

1. **`D5-DEFECT-1`（高优先级）：呼出框点选事项标签后焦点停留在标签按钮，直接按 `Enter` 无法提交开始计时与隐藏呼出框**
   - **复现步骤**：打开呼出框（`?window=launcher`），在输入框输入「桌面快捷键测试」，鼠标点击任意事项标签按钮（或「稍后再选」），随后直接按下键盘 `Enter` 键。
   - **实测结果**：`document.activeElement` 停留在 `<button type="button" data-testid="launcher-tag-...">` 上，按 `Enter` 仅触发按钮自身无提交动作，主窗口进行中计时仍为 `0`，未触发 `hideLauncher`（点击「立即开始」按钮则正常提交）。
   - **最小修复与验收要求**：
     - 在 `apps/web/src/pages/LauncherPage.tsx` 中，点选事项标签或「稍后再选」后立即将焦点归还 `inputRef.current?.focus()`，并在全局按键/表单层级确保当焦点不在「取消」按钮且非中文输入法组合态（`!e.isComposing`）时按下 `Enter` 即可触发表单提交创建计时并发送 `hideLauncher`（而焦点在「取消」按钮上按 `Enter` 仍执行取消）；
     - 独立盲测中按真实用户路径「输入文字 → 鼠标点击标签按钮 → 直接 `keyboard.press('Enter')`（不手动点回输入框）」必须成功新增带标题与标签的进行中计时并触发 `hideLauncher`。

---

## 发布

包清单、哈希与实际内容检查：`v1.1.0-R2/timebook.zip`（`116` 文件，`ok=true`），独立重现编译产物 `时间簿_1.1.0_x64-setup.exe` 为 `2.15 MiB`。**当前 `v1.1.0-R2` 因存在 `D5-DEFECT-1` 暂不放行，待 `R3` 定向修复复测通过后收口发布。**
