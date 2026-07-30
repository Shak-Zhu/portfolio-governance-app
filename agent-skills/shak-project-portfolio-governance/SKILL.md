---
name: shak-project-portfolio-governance
version: 1.0.0
description: 通过官方 Bearer Token MCP 维护「Shak 项目组合治理系统」的组合、项目、层级、步骤、Stage、关联资料、甘特、审计与归档。所有写操作走官方 MCP，禁止直写 D1 或直调私有 REST。
mcpName: shak-project-portfolio-governance
mcpUrl: https://pmo.pmoforms.com/mcp
---

# Shak 项目组合治理系统 · Agent Skill

本 Skill 指导 Agent 通过 **官方 Bearer MCP** 准确维护 Shak 项目组合治理系统。所有能力都以 MCP 工具暴露，
统一走既有业务服务、校验与审计。**唯一 MCP 名称**：`shak-project-portfolio-governance`；
**唯一 MCP URL**：`https://pmo.pmoforms.com/mcp`。

## 0. 核心纪律（必须遵守）

- **只用 MCP 工具**：禁止直写 D1、禁止直调私有 REST（`/api/*`）、禁止浏览器自动化、禁止任意 SQL/HTTP。
- **Bearer Token 是唯一鉴权**：从管理后台「Agent 接入中心」一键复制获得；不要伪造、不要泄露、不要提交到 Git。
- **不猜测 ID**：任何 `portfolioId / projectId / stepId / stageId / linkId` 都必须先用 `list_*` / `get_*` 读取确认，不得凭空构造。
- **不编造业务时间**：日期只来自用户明确输入或已存数据；`created_at / updated_at` 由服务端生成，不由 Agent 传。
- **actor 固定为 `mcp:shak-pmo-owner`**：服务端统一注入，客户端不可覆盖、不要尝试传 `actor` 字段。
- **写前先读**：更新/删除前先 `get_*` 或 `list_*` 确认对象存在与当前值，避免误改。
- **错误可恢复**：工具返回 `isError: true` 时读取文本原因，纠正参数后重试；不要静默忽略或伪造成功。

## 1. 鉴权方式（Bearer Token）

- 标准 Streamable HTTP 端点：`POST https://pmo.pmoforms.com/mcp`
- 鉴权：`Authorization: Bearer <token>`，缺失/错误 → `401` JSON-RPC 错误。
- Token 由系统管理员在网页登录后从「Agent 接入中心」一键复制：
  - **Codex**：先用 `launchctl setenv SHAK_PMO_MCP_TOKEN '<token>'` 写入环境变量；安装文案会先读取同名 MCP，目标配置一致则跳过，不一致才仅替换 `shak-project-portfolio-governance` 这一个条目。**必须完全退出 Codex Desktop 并重开**，新的 MCP 会话才会读到该环境变量。
  - **Cursor**：安全合并 `~/.cursor/mcp.json`，写入 `headers.Authorization: Bearer <token>`。
  - **通用 MCP Client**：直接发送 `Authorization: Bearer <token>` Header。
- **不存在 `--bearer-token <token>` / `--header` 等独立 CLI flag**；Codex 仅接受 `--bearer-token-env-var <ENV_VAR_NAME>`。
- **不存在 OAuth、scope、动态注册、KV token/grant、Access OAuth、`.well-known/oauth-*` 任何机制**；也不存在「dev OAuth」「pending_admin_enablement」等状态。
- Token 永不出现在静态资产、Git、Skill、manifest、日志、报告；网页 /api/agent/install 仅在用户登录会话内返回含真实 Token 的复制文案，并设置 `Cache-Control: no-store`。

## 2. 能力总览与工具矩阵（31 个工具）

| 领域 | 工具 | 业务副作用 |
|---|---|---|
| 组合 | list_portfolios / get_portfolio / create_portfolio / update_portfolio / delete_portfolio | 写操作产生审计事件（actor=mcp:shak-pmo-owner） |
| 项目与层级 | list_projects / get_project / create_project / update_project / delete_project / complete_project / archive_project / get_project_stats | parent_id 建立层级；delete 受子项目保护；archive 受后代完成规则 |
| 步骤、TBD 与依赖 | list_steps / list_portfolio_steps / create_step / update_step / delete_step | 日期/status 决定是否进入时间轴或未排期区；依赖字段说明前置与阻塞影响 |
| Stage | list_stages / create_stage / update_stage / delete_stage | 被引用 Stage 禁改名、禁删除 |
| 关联资料 | list_project_links / create_project_link / update_project_link / delete_project_link | url 仅 http(s) |
| 甘特 | get_gantt | 返回 timeline / rows.bars / unscheduled |
| 审计与归档 | list_audit_events / get_object_audit / list_archived_projects | 只读 |
| 发现与健康 | get_capabilities | 返回版本 / manifest / 健康 / 鉴权模式 |

## 3. 组合 Portfolio

- `list_portfolios()` → 组合数组。
- `get_portfolio({ portfolioId })` → 单个组合；不存在报业务错误。
- `create_portfolio({ name, description? })` → 新组合。
- `update_portfolio({ portfolioId, name?, description? })`。
- `delete_portfolio({ portfolioId })` → `{ success: true }`。

## 4. 项目与父子层级

- `list_projects({ portfolioId, includeArchived? })`。
- `get_project({ projectId })`。
- `create_project({ portfolioId, title, owner, parent_id?, stage?, health?, expectation?, risk? })`
  - `health` ∈ `green/blue/amber/red/unknown`。
  - `parent_id` 指向父项目建立层级；顶级项目留空。
- `update_project({ projectId, parent_id?, title?, owner?, stage?, health?, expectation?, risk?, gate?, status? })`
  - 改 parent 用 `parent_id`。
- `complete_project({ projectId })` → status=completed。
- `delete_project({ projectId })` → **存在未归档子项目时被拒绝**。
- `archive_project({ projectId })` → 仅顶级项目可归档；**所有后代必须已完成**，否则拒绝并返回原因。
- `get_project_stats({ portfolioId })` → total/active/completed/archived。

## 5. 步骤 Step 与 TBD ↔ Plan

- `list_steps({ projectId })` / `list_portfolio_steps({ portfolioId })`。
- `create_step({ projectId, name, start_date?, end_date?, status?, dependency_type?, dependency_detail?, blocked_impact? })`
  - `status` ∈ `done/planned/risk/blocked/tbd`。
  - **无合法起止日期或 status=tbd → 进入"未排期工作包"区，不落时间轴**。
- `update_step({ stepId, name?, start_date?, end_date?, status?, sort_order?, dependency_type?, dependency_detail?, blocked_impact? })`
  - **TBD → Plan**：补齐合法 `start_date`+`end_date` 且原为 tbd（未显式指定 status）→ 自动转 `planned`，落入日期格彩色甘特条。
  - **Plan → TBD**：清空任一日期（传空串 `""`）→ 自动回退 `tbd`，返回未排期区。
- 日期格式 `YYYY-MM-DD`；非法格式被拒。
- **依赖治理字段**：
  - `dependency_type` ∈ `none` / `finish_to_start`（完成后开始）/ `input_required`（关键输入）/ `business_gate`（业务确认 Gate）/ `external_dependency`（外部依赖）。
  - 非 `none` 时必须同时填写 `dependency_detail`，准确写出前置项目、字段、确认或外部输入；如会造成阻塞，填写 `blocked_impact` 说明被阻塞的步骤、决策或交付。
  - 设置 `dependency_type=none` 会清除两项说明。**红色 `blocked` 只代表当前状态，不能替代依赖字段。**
- `delete_step({ stepId })`。

## 6. Stage（删除/改名保护）

- `list_stages({ portfolioId })`。
- `create_stage({ portfolioId, name })`。
- `update_stage({ stageId, name })` — **被任何项目（含已归档）引用的 Stage 禁止改名**。
- `delete_stage({ stageId })` — **被任何项目（含已归档）引用的 Stage 禁止删除**。

## 7. 关联资料 Project Links（URL 校验）

- `list_project_links({ projectId })`。
- `create_project_link({ projectId, title, url })` — **url 必须 http:// 或 https://**，否则拒绝。
- `update_project_link({ linkId, title?, url? })`。
- `delete_project_link({ linkId })`。

## 8. 甘特查询（日/周/月）

- `get_gantt({ portfolioId, start?, end?, scale? })`
  - `scale` ∈ `day/week/month`（默认 week）。
  - 返回：`timeline`（时间格）、`rows[].bars`（按真实格边界落位）、`unscheduled`（未排期工作包分组）、`config`。
  - 支持长区间（≥366 天 / 260 周 / 120 月），无静默截断。

## 9. 审计与归档

- `list_audit_events({ portfolioId, limit?, offset? })`。
- `get_object_audit({ objectType, objectId, limit? })` — objectType ∈ portfolio/project/step/stage/archive/project_link。
- `list_archived_projects({ portfolioId })`。

## 10. 发现与健康

- `get_capabilities()` → `{ systemName, mcpName, serverVersion, toolProtocolVersion, skillVersion, manifestUrl, mcpUrl, auth: { mode: 'bearer', header, audience }, toolCount, health }`。
- 连接成功后应先调用它做工具发现与版本验证。

## 11. 典型工作流

1. **加步骤并排期**：`list_projects` 找 projectId → `create_step`（先 tbd）→ 用户给日期后 `update_step` 补日期（自动转 planned）→ `get_gantt` 确认落位。
2. **记录阻塞关系**：先 `list_steps` 确认步骤 ID → `update_step({ stepId, status: 'blocked', dependency_type: 'business_gate', dependency_detail: '待业务确认的字段范围', blocked_impact: '阻塞 Monitoring 规则配置与试点' })` → `get_gantt` 复核条下方的依赖说明。
2. **整体归档**：`get_project_stats` / `list_projects` 确认后代均 completed → `archive_project`。若被拒，先 `complete_project` 各后代。
3. **改 Stage 名**：`list_stages` → 若被引用则不可改，需先迁移项目 stage 值。

## 12. 错误恢复速查

- 401 未授权 → 检查 Bearer Token 是否复制完整、是否被服务器撤销。
- `isError: true` + "不存在" → 先 list/get 确认 ID。
- `isError: true` + "http" → url 必须 http(s)。
- `isError: true` + "子项目/后代/完成" → 先完成或处理子项目再归档/删除。
- `isError: true` + "strict" / "unknown key" → 工具采用 Zod .strict()，未声明字段会被拒；移除多余字段后重试。
