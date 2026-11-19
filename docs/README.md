# 时间簿（Timebook）项目文档索引

- **项目标识（`slug`）**：`timebook`
- **开源仓库**：`https://github.com/kkuxb/timebook`
- **当前正式发布版本**：**`v0.2.0`**（2026-11-20 用户实操验收收口，在 `v0.1.0` 全栈与桌面版基础上新增五栏「历史」检索与行内/批量整理模块、升级「今日」`8–24` 点自适应时间横条、根治灵动胶囊起跳延迟并正式下线 `Notion` 导入模块）

---

## 一、面向使用者的快速指南

- [项目主页与快速开始（根目录 README）](../README.md)
- [Windows 桌面版使用说明](Windows桌面版使用说明.md)：单机免配直用、灵动胶囊小窗、托盘秒开、全局快捷键、双保险自动备份与转连 `NAS` 无损合并
- [绿联 NAS 与手机 PWA 部署指南](绿联NAS部署指南.md)：图形界面容器部署、`Notion` 历史数据对账导入与 `Tailscale` 免费 `HTTPS` 配置

---

## 二、产品规范与能力总览

- [项目开发规则](../AGENTS.md)
- [原始产品开发方案](开发方案.md)
- [视觉与动效设计规范](设计规范.md)
- [交互原型目录说明](../prototype/README.md)
- [全栈与 NAS 版工作流程与能力总览](deliveries/timebook-v1.0.0-workflow-capability-overview.md)
- [Windows 桌面版工作流程与能力总览](deliveries/timebook-v1.1.0-workflow-capability-overview.md)
- [v0.2.0 迭代版工作流程与能力总览](deliveries/timebook-v0.2.0-workflow-capability-overview.md)

---

## 三、研发设计、盲测报告与验收记录归档

> 说明：内部研发期间按两期里程碑推进（一期全栈与容器版内部代号 `v1.0.0`，二期 `Windows` 桌面版内部代号 `v1.1.0`），最终统一收敛并以 **`v0.1.0`** 正式开源发布。

- **正式收口验收记录**：
  - **[v0.2.0 迭代版验证与验收记录](deliveries/timebook-v0.2.0-acceptance.md)**（2026-11-20 最终收口基线）
  - [v0.1.0 开源首发版验证与验收记录](deliveries/timebook-v0.1.0-acceptance.md)
  - [一期全栈版阶段验收记录](deliveries/timebook-v1.0.0-acceptance.md)
- **需求澄清与确认纪要**：
  - [需求澄清与讨论纪要](requirements/timebook-讨论纪要.md)（`C-01`～`C-17` 全部已确认冻结）
- **冻结设计、实施计划与测试计划**：
  - `v0.2.0` 迭代版：[设计方案](designs/timebook-v0.2.0-design.md) ｜ [实施计划](designs/timebook-v0.2.0-implementation-plan.md) ｜ [测试计划](designs/timebook-v0.2.0-test-plan.md)
  - 一期全栈与 `NAS` 版：[设计方案](designs/timebook-v1.0.0-design.md) ｜ [实施计划](designs/timebook-v1.0.0-implementation-plan.md) ｜ [测试计划](designs/timebook-v1.0.0-test-plan.md)
  - 二期 `Windows` 桌面版：[设计方案](designs/timebook-v1.1.0-design.md) ｜ [R4 热修补充简报](designs/timebook-v1.1.0-R4-hotfix-supplement.md) ｜ [实施计划](designs/timebook-v1.1.0-implementation-plan.md) ｜ [测试计划](designs/timebook-v1.1.0-test-plan.md)
- **独立隔离盲测报告**：
  - `v0.2.0` 迭代版：[R1 收口报告](deliveries/timebook-v0.2.0-R1-test-report.md)
  - 一期全栈版：[R1 报告](deliveries/timebook-v1.0.0-R1-test-report.md) ｜ [R2 收口报告](deliveries/timebook-v1.0.0-R2-test-report.md)
  - 二期桌面版：[R1 报告](deliveries/timebook-v1.1.0-R1-test-report.md) ｜ [R2 报告](deliveries/timebook-v1.1.0-R2-test-report.md) ｜ [R3 报告](deliveries/timebook-v1.1.0-R3-test-report.md) ｜ [R4 真机 WebView2 终验报告](deliveries/timebook-v1.1.0-R4-test-report.md)
