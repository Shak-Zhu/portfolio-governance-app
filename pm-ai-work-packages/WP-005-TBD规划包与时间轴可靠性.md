# 工作包 WP-005｜TBD 未排期工作包、时间轴可靠性与系统命名

## 基本信息

- 项目：Shak 项目组合治理系统
- 工作包编号：WP-005
- 签发人：Codex（PM / QC）
- 接收人：Cursor
- 签发日期：2026-07-29
- 对应需求：REQ-017、REQ-018、REQ-019
- 复杂度：Medium
- 状态：已签发，待开发

## Required Project Files to Read Before Editing

1. `pm-ai-work-packages/WP-005-TBD规划包与时间轴可靠性.md`
2. `pm-ai-work-packages/WP-002A-WebApp-D1-核心-QC.md`
3. `docs/项目章程.md`
4. `docs/生产架构.md`
5. `docs/需求登记册.md`
6. `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/PM_CURRENT_STATUS.md`
7. `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/PM_SCOPE_BASELINE.md`

结果报告必须列出上述 Read Evidence 及关键结论。

## 唯一正式名称

系统唯一正式名称是：**Shak 项目组合治理系统**。

- 必须更新用户可见的网页 title、H1、README、项目章程和相关产品说明。
- 不得改动技术资源名称：`pmo-governance`、`pmo-governance-prod`、`pmo.pmoforms.com`、GitHub repository slug。

## scope_in

### A. TBD 未排期工作包

1. 甘特日期轴只显示同时具备合法 `start_date` 与 `end_date` 且状态非 `tbd` 的步骤。
2. 无完整日期或状态为 `tbd` 的步骤，统一显示在甘特图下方独立的“未排期工作包”区域，不得放在日期轴右侧、日期轴内部、浮层或文字角标。
3. 未排期区域必须按项目分组；每个项目分组清楚显示项目名称、Owner、Stage；每个虚线工作包卡内也显示项目归属和工作包名称。
4. 卡片固定尺寸、灰色虚线边框；无日期、不占用日期格、不遮挡任何甘特条、不制造排期含义。
5. 当步骤补齐有效开始/结束日期并且状态切换为 `planned`、`done`、`risk` 或 `blocked` 时，卡片自动从未排期区域消失，按现有颜色与名称显示到正确日期轴位置。
6. 若用户清空任一日期或将状态改为 `tbd`，步骤回到未排期区域。
7. 无 TBD 时整个未排期区域隐藏。

### B. 日/周/月时间轴可靠性

1. 删除所有静默截断时间格的实现；不得使用固定 `length < 90` 或等价硬上限导致无提示停止生成。
2. 甘特条位置必须通过实际 `timeline` 单元格的开始/结束日期计算，不能以总天数同时充当周/月单元格上限。
3. 日、周、月时间轴各自的 cell 边界、条形起止和宽度必须一致。
4. 至少验证：连续 366 天日视图、260 周周视图、120 月月视图；不可出现白色尾部、丢失日期格、超出时间轴的条或错误宽度。
5. 长范围可横向滚动，但不得白屏、截断、卡死或覆盖固定项目列。

### C. 测试与文档

1. 更新 unit test 与 smoke test，测试真实实现而非复制业务逻辑。
2. 测试 TBD → Plan → TBD 状态迁移与前端展示/隐藏逻辑。
3. 测试日/周/月长范围的 timeline cell 数、条形起止位置和无越界。
4. 更新 README，说明“未排期工作包”的业务语义与转 Plan 规则。

## scope_out

- 不新增 D1 schema，不改变既有生产业务数据。
- 不实现 R2 备份、MCP、认证或 Cooper 同步。
- 不改 Cloudflare Worker、D1、R2、域名、GitHub remote 或执行生产 deploy；这些属于 Codex。

## 验收标准

1. 在真实网页中，一个含两个 TBD 步骤的项目，在甘特图下方显示一个清晰项目分组和两张固定尺寸灰色虚线卡；任意卡都可独立识别所属项目。
2. 日期轴没有任何 TBD 卡/文字占位、浮层或遮挡；现有计划条不改变位置。
3. 将其中一个 TBD 填入日期并改为 `planned`，刷新后该卡从下方消失，并以蓝色条正确落入日期轴；反向操作后恢复为 TBD 卡。
4. 日 366 天、周 260 周、月 120 月下：日期头连续、无空白尾部；步骤条起止处于正确格内；无静默截断。
5. 正式网页、README 与用户可见产品说明均使用“Shak 项目组合治理系统”；技术资源名称保持不变。
6. `npm run lint`、`npm test`、`npm run build`、migration、Worker HTTP smoke 均通过。

## 禁止事项

- 不得执行 `wrangler deploy`。
- 不得修改生产 Cloudflare、D1、R2、DNS、Git remote 或 PM baseline。
- 不得将完成状态写为 accepted、complete、ready 或 MVP done；结果只能是 `implemented, pending PM/QC review`。

## 完成后提交

1. 更新或新增 `pm-ai-work-packages/WP-005-TBD规划包与时间轴可靠性-RESULT.md`。
2. 在结果中提供 Read Evidence、文件清单、验收项逐条证据、全部命令真实输出摘要与已知限制。
