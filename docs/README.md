# 时间簿（Timebook）当前有效文档索引

- **项目标识（`slug`）**：`timebook`
- **项目根目录**：`H:/个人项目/timebook`
- **协作方法**：FDE 三角色多智能体开发模式（`PM` / `dev` / `qa`，`dev` 与 `qa` 固定绑定模型 `gemini-4-hydrogen-high`，`workspace: "inherit"`）

## 核心规则与参考依据

- [项目开发规则](../AGENTS.md)
- [原始开发方案 v1.1](开发方案.md)
- [视觉与动效设计规范](设计规范.md)
- [交互原型目录说明](../prototype/README.md)

## 当前工作状态（`v1.0.0`）

- **当前版本**：`v1.0.0`（一期完整交付版：含今日/日历/统计/标签四主视图、移动端与 `PWA`、右上角设置抽屉与真实 `Notion` 结构历史导入导出、30 天回收站、自动备份、绿联 `NAS` 容器部署配置与指南）
- **当前阶段**：**阶段 6 已完成（`v1.0.0` 已通过用户验收正式收口，归档提交至 `main` 分支）**
- **当前有效文档清单**：
  - 需求与确认记录：[需求澄清与讨论纪要](requirements/timebook-讨论纪要.md)（`C-01`～`C-07` 已全部确认冻结）
  - 冻结设计方案：[v1.0.0 完整版设计方案](designs/timebook-v1.0.0-design.md)（状态：**已确认冻结**）
  - 可执行实施计划：[v1.0.0 实施计划](designs/timebook-v1.0.0-implementation-plan.md)（`T1`–`T8` 已全部实施落地）
  - 独立盲测计划：[v1.0.0 测试计划](designs/timebook-v1.0.0-test-plan.md)（`A1`–`A6` 全部达标通过）
  - 工作流程与能力总览：[v1.0.0 工作流程与能力总览](deliveries/timebook-v1.0.0-workflow-capability-overview.md)
  - 绿联部署说明：[绿联 NAS 部署指南](绿联NAS部署指南.md)
  - 阶段测试报告：[v1.0.0-R1 测试报告](deliveries/timebook-v1.0.0-R1-test-report.md) ｜ [v1.0.0-R2 测试报告（最终可收口版）](deliveries/timebook-v1.0.0-R2-test-report.md)
  - 正式验收记录：[v1.0.0 验证与验收记录](deliveries/timebook-v1.0.0-acceptance.md)（2026-11-19 用户实操预览确认通过）
  - 正式验收发布包：`workspace-data/outputs/timebook/v1.0.0-R2/timebook.zip`（84 个清单文件，`SHA-256: aec7b90a88c10cc4fa497ccb549ef16c2ce1b9a5d591394fda5f3debddee8dbe`，本地留档不入版本库）

## 阶段进度与轮次追踪

- **`v1.0.0-R1`（2026-11-19）**：完成 `T1`–`T8` 首轮开发与全量 `A1`–`A6` 隔离盲测，`A1`/`A2`/`A4` 一次通过，检出 3 项缺陷（整批撤销漏删同批待办与新建事项、删除空模块校验失败、手机端日历 3 天默认窗口未含今天）退回修复。
- **`v1.0.0-R2`（2026-11-19）**：完成 3 项缺陷定向修复并重跑完整单测与 `A3`/`A5`/`A6` 隔离盲测，6 大验收场景全部通过；经用户本机预览实操确认验收通过，正式收口并归档推送至 `main` 分支。
