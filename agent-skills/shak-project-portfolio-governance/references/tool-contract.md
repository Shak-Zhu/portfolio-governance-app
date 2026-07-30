---
title: Shak 项目组合治理系统 · MCP 工具契约
bundle: shak-project-portfolio-governance
version: 1.0.0
---

# MCP 工具契约（Tools / CallToolResult）

本文档是 Agent 在调用 `shak-project-portfolio-governance` MCP 时应当依赖的运行事实来源。
所有工具均注册在 `agents/mcp/server` 的 `McpServer` 内，并通过 `server.registerTool(...)` 暴露。
每个工具使用 **Zod strict schema**——未声明字段会在 runtime 被拒绝；服务端不接受任何客户端伪造字段（如 `actor`、`scope`）。

> 鉴权：所有调用统一携带 `Authorization: Bearer <token>`。Token 通过管理后台 `/api/agent/install`
> 登录后动态获取，绝不出现在本 bundle 内。

## 通用约定

- 工具调用 JSON-RPC：`tools/call` / `params.name` / `params.arguments`。
- 输入：`arguments` 严格匹配该工具的 Zod schema；缺字段、未知字段、类型错、enum 非法均返回 `isError: true`。
- 输出：标准 `CallToolResult`：
  ```json
  {
    "content": [{ "type": "text", "text": "<human readable>" }],
    "structuredContent": { ...业务对象... },
    "isError": false
  }
  ```
- 审计 actor 永远是 `mcp:shak-pmo-owner`（服务端注入，不接受客户端覆盖）。

## 31 工具矩阵

### Portfolio（5）

| 工具 | 必填 | 可选 | 结构化输出 |
|---|---|---|---|
| `list_portfolios` | – | – | `{ portfolios: Portfolio[] }` |
| `get_portfolio` | `portfolioId` | – | `{ portfolio: Portfolio }` |
| `create_portfolio` | `name` | `description` | `{ portfolio: Portfolio }` |
| `update_portfolio` | `portfolioId`, (任一字段) | `name`, `description` | `{ portfolio: Portfolio }` |
| `delete_portfolio` | `portfolioId` | – | `{ success: true }` |

`Portfolio = { id, name, description?, created_at, updated_at }`.

### Project（8）

| 工具 | 必填 | 可选 | 结构化输出 |
|---|---|---|---|
| `list_projects` | `portfolioId` | `includeArchived` | `{ projects: Project[] }` |
| `get_project` | `projectId` | – | `{ project: Project }` |
| `create_project` | `portfolioId`, `title`, `owner` | `parent_id`, `stage`, `health`, `expectation`, `risk` | `{ project: Project }` |
| `update_project` | `projectId`, (任一字段) | `parent_id`, `title`, `owner`, `stage`, `health`, `expectation`, `risk`, `gate`, `status` | `{ project: Project }` |
| `delete_project` | `projectId` | – | `{ success: true }` |
| `complete_project` | `projectId` | – | `{ project: Project, status: 'completed' }` |
| `archive_project` | `projectId` | – | `{ project: Project, archived: true }` |
| `get_project_stats` | `portfolioId` | – | `{ total, active, completed, archived }` |

`health ∈ { green, blue, amber, red, unknown }`.

业务规则：
- `parent_id` 建立父子层级；顶级留空。
- `delete_project` **存在未归档子项目时被拒**。
- `archive_project` **仅顶级可归档**；**所有后代必须 `completed`**，否则被拒。

### Step / TBD（5）

| 工具 | 必填 | 可选 | 结构化输出 |
|---|---|---|---|
| `list_steps` | `projectId` | – | `{ steps: Step[] }` |
| `list_portfolio_steps` | `portfolioId` | – | `{ steps: Step[] }` |
| `create_step` | `projectId`, `name` | `start_date`, `end_date`, `status`, `dependency_type`, `dependency_detail`, `blocked_impact` | `{ step: Step }` |
| `update_step` | `stepId`, (任一字段) | `name`, `start_date`, `end_date`, `status`, `sort_order`, `dependency_type`, `dependency_detail`, `blocked_impact` | `{ step: Step }` |
| `delete_step` | `stepId` | – | `{ success: true }` |

`status ∈ { done, planned, risk, blocked, tbd }`. 日期 `YYYY-MM-DD`.

业务规则（TBD ↔ Plan）：
- 无合法起止日期或 `status=tbd` → 进入"未排期工作包"区。
- `update_step` 补齐合法 start/end 且原状态 tbd → 自动转 `planned` 落时间轴。
- `update_step` 把任一日期传空串 `""` → 回退 `tbd`、回未排期区。
- `dependency_type` ∈ `none | finish_to_start | input_required | business_gate | external_dependency`；非 `none` 必须有非空 `dependency_detail`。设置 `none` 会清除 `dependency_detail` 与 `blocked_impact`。
- `blocked_impact` 是被阻塞的步骤、决策或交付说明；不可仅以 `status=blocked` 或颜色代替。

### Stage（4）

| 工具 | 必填 | 可选 | 结构化输出 |
|---|---|---|---|
| `list_stages` | `portfolioId` | – | `{ stages: Stage[] }` |
| `create_stage` | `portfolioId`, `name` | – | `{ stage: Stage }` |
| `update_stage` | `stageId`, `name` | – | `{ success, message? }` |
| `delete_stage` | `stageId` | – | `{ success, message? }` |

业务规则：被任何项目（含已归档）引用的 Stage **禁止改名与删除**。

### Project Link（4）

| 工具 | 必填 | 可选 | 结构化输出 |
|---|---|---|---|
| `list_project_links` | `projectId` | – | `{ links: ProjectLink[] }` |
| `create_project_link` | `projectId`, `title`, `url` | – | `{ link: ProjectLink }` |
| `update_project_link` | `linkId`, (任一字段) | `title`, `url` | `{ link: ProjectLink }` |
| `delete_project_link` | `linkId` | – | `{ success: true }` |

业务规则：`url` 必须以 `http://` 或 `https://` 开头；其他协议被拒。

### Gantt（1）

| 工具 | 必填 | 可选 | 结构化输出 |
|---|---|---|---|
| `get_gantt` | `portfolioId` | `start`, `end`, `scale` | `{ timeline, rows, unscheduled, config }` |

`scale ∈ { day, week, month }`，默认 `week`。
支持长区间（≥366 天 / 260 周 / 120 月），无静默截断。
`timeline` 为真实时间格；`rows[].bars` 按真实格边界落位；`unscheduled` 分组展示 TBD。

### Audit / Archive（3）

| 工具 | 必填 | 可选 | 结构化输出 |
|---|---|---|---|
| `list_audit_events` | `portfolioId` | `limit`, `offset` | `{ events: AuditEvent[] }` |
| `get_object_audit` | `objectType`, `objectId` | `limit` | `{ events: AuditEvent[] }` |
| `list_archived_projects` | `portfolioId` | – | `{ projects: Project[] }` |

`objectType ∈ { portfolio, project, step, stage, archive, project_link }`。

### Discovery / Health（1）

| 工具 | 必填 | 可选 | 结构化输出 |
|---|---|---|---|
| `get_capabilities` | – | – | `{ systemName, mcpName, serverVersion, toolProtocolVersion, skillVersion, manifestUrl, mcpUrl, auth: { mode, header, audience }, toolCount, health }` |

`auth.mode = 'bearer'`；`header = 'Authorization'`；`audience = 'shak-pmo-owner'`。
`toolCount` 必须与 Skill `toolMatrix` 一致（当前为 31）。

## 错误码与恢复速查

| Server 文本片段 | 含义 | 处理 |
|---|---|---|
| `401` | Bearer Token 缺失/错误 | 检查 Token 是否复制完整 |
| `不存在` | ID 未匹配 | 先 `list_*`/`get_*` 确认 |
| `子项目` / `后代` / `完成` | 父子 / 归档未完成 | 先 `complete_project` 或迁移子项目 |
| `已被 ... 项目使用` | Stage 改名/删除被拒 | 迁移项目 Stage 引用或放弃操作 |
| `URL 必须是` | 关联资料 url 协议 | 改用 `http(s)://` |
| `strict` / `unknown` | Zod strict 未声明字段 | 移除多余字段后重试 |
| `未授权` / `scope` | 历史 OAuth 残留字段 | Bearer Token 唯一鉴权，不要传 scope |

## 调用约定与审计 actor

- 任何 `create_*` / `update_*` / `delete_*` / `complete_*` / `archive_*` 写入都会在 `audit_events` 落一条记录，actor 固定为 `mcp:shak-pmo-owner`。
- 客户端禁止传 `actor`、`scope`、`audience`、`login_token` 等字段；运行时 schema 校验会直接拒绝。
- 单次调用：JSON-RPC `tools/call`，结构化输出从 `result.structuredContent` 读取。
