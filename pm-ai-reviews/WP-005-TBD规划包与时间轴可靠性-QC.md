# PM/QC 报告｜WP-005 TBD 规划包与时间轴可靠性

- 审查日期：2026-07-29
- Coder 报告状态：`implemented, pending PM/QC review`
- PM/QC 结论：**L1 / accepted，待 Human Owner 最终业务验收**

## 五层验收状态

| 层级 | 状态 |
|---|---|
| Coder Implemented | 是 |
| PM Reviewed | 是 |
| PM/QC Accepted | 是（L1） |
| Human Accepted | 待 Human Owner 确认 |
| Product Done | 否；仍待本次生产发布、业务验收及后续 WP-002B / WP-003 |

## 验收条件核对

| 条件 | 结果 | 独立证据 |
|---|---|---|
| TBD 在甘特图下方按项目分组，不进入日期轴 | PASS | 本地真实 UI：两张 TBD 卡显示于独立区域；分组头显示项目、Owner、Stage；日期轴仅显示已计划条。|
| TBD → Plan → TBD 双向迁移 | PASS | Worker HTTP smoke #30、#31 通过；日期清空空串能使状态回退 `tbd`。|
| 日 366 天、周 260 周、月 120 月无截断且正确落位 | PASS | 真实核心模块单测 12/12 通过；Worker HTTP smoke #32–#35 通过。|
| 正式名称统一、技术资源标识不变 | PASS | 页面 title/H1、README、产品文档为“Shak 项目组合治理系统”；`wrangler.toml` 仍为 `pmo-governance` / `pmo-governance-prod` / `pmo.pmoforms.com`。|
| 构建、迁移与既有功能回归 | PASS | `npm run lint`、`npm test`、`npm run build`、连续两次 `npm run db:migrate` 均 exit 0；本地 Worker 静态资源与 `/api/health` 均 200；完整 smoke 36/36 通过。|

## 范围与回归审计

- 已检查 Git diff：修改限于 WP-005 允许的前端、甘特计算、步骤状态迁移、测试、README、产品文档与工作包结果；未改 migration。
- 未发现 Cursor 修改 PM baseline、Cloudflare、D1、R2、DNS、Git remote 或执行生产 deploy。
- `git diff --check` 与 `node --check public/app.js` 通过。
- 发现的真实缺陷（清空日期空串未触发 Plan → TBD 回退）已在 `src/api/steps.ts` 修复并由 smoke #31 验证。

## 发布边界

本 QC 仅确认代码满足 L1。下一步由 Codex 负责 Git 提交、Cloudflare 生产发布与线上复验；Human Owner 对生产界面进行最终业务验收前，不得标记为 Human Accepted 或 Product Done。

## 生产发布复验

- Git：提交 `d5b2cbd feat: add unscheduled TBD packages and reliable gantt timeline` 已推送至 `Shak-Zhu/portfolio-governance-app` 的 `main`。
- Cloudflare：Worker `pmo-governance` 已发布，Version ID：`c51fcb39-d28e-4e5e-80fe-de59e93aa897`。
- 公网复验：`https://pmo.pmoforms.com/`、`/index.html`、`/app.js`、`/styles.css`、`/api/health` 全部返回 HTTP 200；线上 HTML 的 title/H1 均为“Shak 项目组合治理系统”。
- 本工作包状态：**已生产发布，待 Human Owner 最终业务验收**。
