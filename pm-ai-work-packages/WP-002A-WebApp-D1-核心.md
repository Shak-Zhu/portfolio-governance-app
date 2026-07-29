# 工作包 WP-002A｜Web App 与 D1 核心

## 基本信息

- 项目：多项目治理 Web App
- 工作包编号：WP-002A
- 签发人：Codex（PM / QC）
- 接收人：Cursor
- 签发日期：2026-07-29
- 对应需求：REQ-007、REQ-008、REQ-009、REQ-010、REQ-011、REQ-016
- 对应 WBS：2.0
- 复杂度：High
- 预计 PM-Coder 迭代次数：2-3
- 不确定性：Medium
- 主要工作语言：中文

## Required Project Files to Read Before Editing

| 文件 | 为什么必须读取 | Required / Conditional |
|---|---|---|
| `pm-ai-work-packages/WP-002A-WebApp-D1-核心.md` | 本工作包的唯一权威范围与验收条件 | Required |
| `docs/项目章程.md` | 确认产品目标、阶段与角色边界 | Required |
| `docs/生产架构.md` | 确认 D1、审计、归档和数据安全规则 | Required |
| `docs/需求登记册.md` | 确认 P0 需求与可验证标准 | Required |
| `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/PM_CURRENT_STATUS.md` | 确认 Cloudflare、域名和 R2 当前状态 | Required |
| `/Users/didi/Desktop/Project Management/甘特图/governance-demo/` | 仅作为已获认可的视觉与交互参考；不可作为生产数据源 | Conditional |

执行报告必须有 `Read Evidence`，逐项列出已读文件及关键结论。

## 背景

Human Owner 已接受交互 Demo，并授权正式开发独立网页程序。生产入口已经是 `https://pmo.pmoforms.com`，现有 Worker `pmo-governance` 仅返回初始化文本。系统不再依赖 Cooper，项目、步骤、Stage 与审计必须持久化于 D1。

## 本次目标

在本地完成一个可部署的 Cloudflare Worker Web App：以 D1 保存组合、项目、步骤、Stage 和审计记录；以一个可交互页面维护主数据并自动展示组合甘特图。此包不实现 R2 或 MCP。

## scope_in

- 初始化生产代码目录、依赖锁定文件、Cloudflare Worker 配置和 D1 migrations。
- 设计并实现组合、项目、步骤、Stage、关联资料和审计的数据模型；关联资料与项目为一对多关系，保存显示标题与 `http(s)` URL；所有 migration 可重复执行，且不得在 deploy 时清空表。
- 提供 API 或等价服务器端接口：组合、项目、步骤、Stage 的读取与写入；写入后记录 audit event。
- 提供一个中文 Web UI：组合切换、项目主数据表、项目新增/编辑/删除、步骤新增/编辑/删除、自定义 Stage 管理、完成标记。
- 每个项目可维护多条关联资料；主数据表显示资料入口/数量，点击后以新窗口打开；关联资料的创建、修改和删除均须写入审计。
- 甘特图由步骤数据生成；支持日 / 周 / 月切换；有日期的条显示步骤名称；无明确日期的阶段只显示灰色 TBD 顺序，不能落入具体日期轴。
- 显示图例：绿色完成、蓝色已确认计划、黄色风险/待决、红色前置依赖/阻塞、灰色 TBD。
- 归档前端和服务端均执行规则：只有顶级项目且所有后代完成时可以整体归档；子项目不可单独归档。
- 提供本地初始化样例（含 B2B Pain Point、CRM 总项目、Phase 0、Contract Extractor、Sales Monitoring、Sales Copilot），但不得从 Cooper 读取或写入。
- 提供 README：本地运行、D1 migration、测试、部署前检查的中文步骤。

## scope_out

- 不实现 R2 bucket、每日备份、恢复演练：账户尚未开通 R2，留给 WP-002B。
- 不实现 MCP endpoint、Agent 授权、OAuth/Access 或 MCP 使用说明：留给 WP-003。
- 不导入、同步、写入或改动任何 Cooper 文档/表格。
- 不实现成本、预算、资源、工时、复杂 WBS 或多人权限体系。
- 不将任何 Cloudflare OAuth token、账户密钥或本地凭证提交到代码、`.env`、README 或日志。

## 允许修改的文件

- 仅限 `/Users/didi/Desktop/Project Management/甘特图/portfolio-governance-app/` 下为本工作包新增或修改的应用文件。
- `docs/` 仅可补充实现说明；不得篡改已批准的需求、范围或角色描述。

## 禁止修改事项

- 不得修改 `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/` 中任何 PM baseline 文件。
- 不得修改、删除或重命名 `pmo.pmoforms.com`、`pmo-governance`、Cloudflare DNS/Route、Cloudflare 账户配置。
- 不得将 production deploy 当作本工作包完成条件；部署由 PM/QC 审查后另行决定。
- 不得使用真实用户业务数据或任何未获批准的第三方服务。

## 数据库 / 环境 / 部署限制

- 数据库：Cloudflare D1。生产库已由 PM 创建：`pmo-governance-prod`；在 Worker 配置中使用 binding `DB`。migration 必须单独保存并可在空库执行。
- R2：生产 Bucket `pmo-governance-backups-prod` 已由 PM 创建，预留 binding `BACKUPS`；本工作包不得写入 R2 或实现备份逻辑。
- 环境：本地开发与本地 D1 验证；可使用 Worker preview，但不得覆盖生产 Worker。
- 部署：禁止执行 `wrangler deploy` 到生产；提交部署前命令和预期输出供 PM/QC 复核。

## 验收标准

1. 在空本地 D1 执行 migrations 后，五张表均存在；`projects.parent_id`、`steps.project_id`、`audit_events` 所需字段可由 SQL schema 验证。
2. 通过 UI 新建一个组合、一个父项目、一个子项目和一条具日期步骤后，刷新浏览器，四项对象仍存在；同一次写入至少产生四条对应 audit event。
3. 将任一步骤开始/结束日期修改为不同周后，日、周、月三种视图的甘特条位置均发生对应变化；条内显示步骤名称。
4. 创建无日期步骤后，它只以灰色 `TBD` 阶段顺序展示，且不占用具体日期格。
5. 未完成子项目存在时，对父项目执行整体归档必须返回明确拒绝结果；全部子项目完成后，父项目可归档且归档项目不再出现在活动组合视图。
6. 已被项目使用的 Stage 不可删除；未使用的 Stage 可删除；服务端与 UI 均返回一致结果。
7. 项目修改、步骤修改、Stage 修改、完成和归档等写操作均写入审计记录，记录至少包含 actor、时间、动作、对象类型、对象 ID 和变更摘要。
8. `npm run lint`、`npm test`、生产构建命令以及本地 Worker/D1 smoke test 全部退出码为 0；提交每条命令与实际输出摘要。
9. README 的本地启动、migration 和 smoke test 命令由干净 checkout 可复现；不得要求手工修改源码才能启动。
10. 对同一项目创建 3 条关联资料后刷新页面，资料仍存在；主数据表显示正确资料数量，资料链接以新窗口打开；非法协议 URL 被服务端拒绝，创建、修改、删除均产生 audit event。

## 必须运行的验证命令

- `npm run lint`
- `npm test`
- 项目定义的 production build 命令
- D1 migration 命令
- 本地 Worker 启动命令
- 使用 HTTP 请求或自动化测试覆盖创建、刷新持久化、TBD、归档阻断/放行、审计查询的 smoke test

## 依赖

- 已满足：Cloudflare Wrangler OAuth、`pmoforms.com`、`pmo.pmoforms.com` 和初始化 Worker。
- 未纳入本包：R2 初始开通（Cloudflare API code `10042`）。

## 完成后操作

1. 将结果存档为 `pm-ai-work-packages/WP-002A-WebApp-D1-核心-RESULT.md`。
2. 在当前对话中用中文报告：Read Evidence、修改文件清单、每项验收标准的证据、验证命令输出摘要、已知限制。
3. 最终状态只能写：`implemented, pending PM/QC review`。
4. 不得宣布 accepted、complete、MVP done、finished 或 ready。
