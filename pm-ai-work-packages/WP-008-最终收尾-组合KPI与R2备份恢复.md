# 工作包 WP-008｜最终收尾：组合 KPI 与 R2 备份恢复

## 基本信息

- 项目：Shak 项目组合治理系统
- 接收人：Cursor（Coder）
- 签发人：Codex（PM / QC）
- 对应需求：REQ-012、REQ-025
- 工作语言：中文
- 交付状态限制：最终只能写 `implemented, pending PM/QC review`

## Required Project Files to Read Before Editing

| 文件 | 原因 | Required |
|---|---|---|
| `pm-ai-work-packages/WP-008-最终收尾-组合KPI与R2备份恢复.md` | 当前权威工作包 | Required |
| `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/PM_CURRENT_STATUS.md` | 确认这是统一验收前最后收尾 | Required |
| `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/PM_SCOPE_BASELINE.md` | 确认顶级 KPI 与 R2 恢复范围 | Required |
| `src/api/projects.ts`、`public/app.js`、`public/index.html` | 当前错误统计查询与四个 KPI 展示入口 | Required |
| `src/index.ts`、`wrangler.toml`、`docs/生产架构.md` | Worker、R2 binding、计划任务与架构边界 | Required |
| `migrations/0001_initial_schema.sql`、`src/api/portfolios.ts`、`src/api/steps.ts`、`src/api/stages.ts`、`src/api/projectLinks.ts` | 逻辑备份必须覆盖的实体和字段 | Required |
| `scripts/real-mcp-test.mjs`、`scripts/smoke-test.js`、`package.json` | 现有验证入口与回归约束 | Required |

## 目标

在不改变父子项目明细、甘特或 MCP 治理规则的前提下，修正组合级 KPI 的重复计数；实现可验证的每日 R2 逻辑备份、30 日保留策略和**不覆盖生产 D1**的恢复演练能力。

## scope_in

### A. 组合级 KPI 只统计顶级项目

1. `getProjectStats()` 的 `total`、`active`、`completed`、`archived` 必须统一只统计：

```sql
portfolio_id = ? AND parent_id IS NULL
```

2. 子项目仍必须出现在项目主数据表、甘特、归档明细和所有 `list_*` 结果中；只是不再计入首页四张组合 KPI 卡。
3. 首页标签改为清晰的组合级语义，例如：
   - `当前组合总项目（顶级）`
   - `执行中（顶级）`
   - `已完成，待归档（顶级）`
   - `已归档（顶级）`
4. REST `GET /api/portfolios/:portfolioId/stats` 与 MCP `get_project_stats` 必须返回同一口径；不得新增另一个互相矛盾的计数。
5. 新增确定性测试数据：至少 2 个顶级项目、每个至少 1 个子项目，并覆盖 active、completed、archived；断言统计只返回顶级项目数。

### B. R2 逻辑备份与恢复演练

1. 新增独立、可复用的备份服务，逻辑备份必须覆盖所有业务表：
   - portfolios
   - projects
   - stages
   - steps
   - project_links
   - audit_events
2. 备份格式为结构化 JSON，包含：
   - schema/version
   - createdAt
   - 数据表行数摘要
   - 各表数据
   - 内容 SHA-256 或等价完整性摘要
3. Worker `scheduled()` 每日触发一次备份；在 `wrangler.toml` 使用一个明确 UTC cron。不要猜测或修改现有生产数据。
4. R2 object key 必须可排序且可追踪，例如：`backups/YYYY-MM-DD/<timestamp>.json`。
5. 每次成功备份后保留最近 30 个备份对象，删除更旧对象；删除失败/备份失败必须在日志中明确抛错，不能静默成功。
6. 仅向已登录网页用户提供：
   - 最近备份列表（key、createdAt、size、摘要）
   - 手动触发一次备份的入口
   - 恢复演练入口：只验证备份 JSON、哈希、表结构与行数，并恢复到**本地/隔离测试 D1**；严禁提供会覆盖生产 D1 的网页或 MCP 操作。
7. 如需添加 REST 路由，必须复用网页登录保护；不向 MCP 增加任意 SQL、任意 R2、任意恢复或生产覆盖工具。
8. README 与 `docs/生产架构.md` 更新为真实 R2 行为、保留期、恢复演练限制和操作方法。

## scope_out

- 不执行 `wrangler deploy`、`wrangler secret put`、Git commit、Git push、生产备份或生产恢复；这些由 Codex 负责。
- 不修改或删除生产 D1 项目数据，不新增 destructive restore endpoint。
- 不修改 31 个 MCP 工具的治理范围、Bearer、登录、Skill 或 GitHub 发布机制。
- 不新增成本、预算、工时、Cooper 同步或复杂 WBS。

## 验收标准

1. 构造 2 顶级 + 3 子项目后，四项 REST/MCP KPI 只统计顶级项目；项目明细/甘特仍含全部 5 个项目。
2. 备份 JSON 完整覆盖 6 张业务表，行数、schemaVersion 与 SHA-256 可验证。
3. 手动备份及 scheduled handler 使用同一服务；R2 key 符合约定；保留策略只保留最新 30 份。
4. 恢复演练使用隔离 D1，完整导入并逐表验证行数/哈希；测试能证明生产 DB 不作为恢复目标。
5. 未登录访问新增备份 API 为 401；没有匿名写入或读取备份内容的端点。
6. `npm run lint`、`npm test`、`npm run test:e2e`、`npm run build`、`git diff --check` 全部通过；新增备份/恢复测试必须真实执行，不能只测试字符串。
7. `RESULT.md` 使用中文，含 Read Evidence、修改文件、各验收项证据、未执行生产动作。最终状态只能为 `implemented, pending PM/QC review`。

## 允许修改文件

- `src/**`、`public/**`、`scripts/**`、`wrangler.toml`、`README.md`、`docs/生产架构.md`
- `package.json`（仅新增必要验证命令）
- `pm-ai-work-packages/WP-008-最终收尾-组合KPI与R2备份恢复-RESULT.md`

