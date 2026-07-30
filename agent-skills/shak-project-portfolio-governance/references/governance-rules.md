---
title: Shak 项目组合治理系统 · 治理规则与状态机
bundle: shak-project-portfolio-governance
version: 1.0.0
---

# 治理规则（Governance Rules）

本文档规定通过 MCP 修改 Shak 项目组合治理系统的所有治理与状态机规则。
**Agent 不允许猜测、绕过或扩展这些规则**——任何例外必须先向 PM 提交变更单。

## 1. 通用纪律

1. **唯一可信后端**：组合、项目、步骤、Stage、关联资料、审计、归档——所有写操作只走官方 MCP（`/mcp`）。
2. **禁止绕过**：禁止直写 D1、直调私有 `/api/*`、浏览器自动化、任意 SQL / 任意 HTTP 转发。
3. **鉴权唯一**：Bearer Token，缺/错返回 JSON 401，绝不返回 302 或 HTML。
4. **audited actor**：所有写工具的服务端日志 `actor = mcp:shak-pmo-owner`，不接受客户端覆盖。
5. **强 schema**：每个工具 `registerTool` 使用 Zod `.strict()`，未声明字段（包括 `actor` / `scope`）会被运行时拒绝。
6. **写前先读**：所有 `update_*` / `delete_*` / `complete_*` / `archive_*` 之前先用 `get_*` 拿当前值，避免覆盖错误。
7. **错误可恢复**：所有错误以 `isError: true` + 文本原因返回，必须读原因、纠参重试，不得伪造成功。

## 2. Portfolio（组合）

- `create_portfolio({ name, description? })`：组合为顶层容器，所有项目与 Stage 必须挂在 portfolio 下。
- `update_portfolio(...)` 仅修改名称与描述；`id` / `created_at` 不允许修改。
- `delete_portfolio(...)` **应当由 PM 决定**：当前实现允许，但所有项目、步骤、Stage、链接会一并孤立。生产操作前应先 `list_projects({ portfolioId })` 与 PM 确认。
- 每个 `create_portfolio` 都会写入一条 `create / portfolio` 审计。

## 3. Project（项目）

### 3.1 字段与合法值
- `title`（必填）、`owner`（必填）、`parent_id?`（顶级留空）。
- `health ∈ { green, blue, amber, red, unknown }`。
- `stage` 是 **Stage.name 字符串引用**；不允许客户端自由文本（如果随便写将被 `update_stage` 删除保护挡掉）。
- `expectation` / `risk` 为自由文本；`gate` 仅作为里程碑短语。

### 3.2 父子层级
- `parent_id` 建立父子树；只能在同一 portfolio 内。
- `list_projects({ includeArchived: true })` 返回含归档；`false` 默认仅活动项目。
- 业务规则：
  - **存在未归档子项目 → 父项目禁止 `delete_project`**；必须先处理子项目。
  - `archive_project`：仅顶级项目可归档，且所有后代必须 `completed`，否则返回 `{ isError, message: '后代项目 X 未完成' }`。

### 3.3 `complete_project` / `archive_project` 边界

| 操作 | 前置条件 | 失败行为 |
|---|---|---|
| `complete_project` | 项目存在 | 不存在 → `isError: doesn't exist` |
| `archive_project` | 项目为顶级 ∧ 所有后代 `completed` | 不为顶级 → `isError: only top-level`；后代未完成 → 列出未完成对象 |
| `delete_project` | 无未归档子项目 | 有未归档子项目 → `isError` 列出子项目 |

## 4. Step / TBD ↔ Plan 状态机

### 状态枚举
`status ∈ { done, planned, risk, blocked, tbd }`.

### 状态迁移规则
| 来源 | 操作 | 触发 | 落位 |
|---|---|---|---|
| 无 → tbd | `create_step` 无日期 / status=tbd | 缺日期 或 status=tbd | 未排期工作包区 |
| tbd → planned | `update_step` 补 start+end（合法 YYYY-MM-DD），不显式传 status | 完整日期 ∧ 原 status=tbd | 时间轴（彩色甘特条） |
| tbd → planned | `update_step` status=done/risk/blocked 且有完整日期 | 显式 + 完整日期 | 时间轴（彩色甘特条） |
| planned → tbd | `update_step` 任一日期传 `""`（清空） | 缺日期 | 自动回退未排期区 |
| planned → done | `update_step` status=done ∧ 有合法日期 | 显式 | 时间轴 done 颜色 |
| 任意 → tbd | `update_step` status=tbd | 显式 | 未排期工作包区 |

## 5. 依赖与阻塞治理

- 依赖必须用步骤字段表达，不允许用红色状态、项目名称或自由文本猜测替代。
- 先选择 `dependency_type`：完成后开始（`finish_to_start`）、关键输入（`input_required`）、业务确认 Gate（`business_gate`）或外部依赖（`external_dependency`）。
- 写 `dependency_detail` 时必须说明前置具体是什么；如状态为 `blocked`，必须写 `blocked_impact`，说明阻塞的下游步骤、决策或交付。
- `get_gantt` 的步骤条位置仍只由开始/结束日期决定；依赖说明是条下方治理注释，绝不自动延长、移动或生成新的日期条。

### 日期合法性
- 必须 `YYYY-MM-DD`，正则 `^\d{4}-\d{2}-\d{2}$`。
- `start_date <= end_date`，否则业务拒绝。
- 非法格式被 Zod / 业务规则同时拒绝。

## 5. Stage

- `Stage.name` 是唯一展示名；`Stage.id` 是稳定主键。
- `update_stage` / `delete_stage` 在引用计数 `> 0` 时返回 `isError: true`：
  - "Stage "X" 已被 N 个项目使用，禁止改名。请先修改项目或删除未使用的 Stage。"
  - "Stage "X" 已被 N 个项目使用，无法删除"
- 引用统计覆盖 **活动 + 归档** 项目。

## 6. Project Links（关联资料）

- 每个项目 0..N 条资料。
- `url` 强制以 `http://` 或 `https://` 开头；其他协议、纯文本、空串被拒绝（业务校验）。
- 任何 `create / update / delete` 写入一条 audit_events。
- URL 长度上限 2048；title 上限 200 字符（应用层校验）。

## 7. 甘特（Gantt）

- `get_gantt({ portfolioId, start?, end?, scale? })`：`scale ∈ { day, week, month }`，默认 `week`。
- **不支持静默截断**：必须支持 ≥366 天 / 260 周 / 120 月；前端渲染按真实 timeline cell 边界计算 bar 位置。
- 返回值关键字段：
  - `timeline`：时间格（cell 标题 / 起点 / 长度）。
  - `rows[].bars[]`：每根条按真实格边界落位 `{ startOffset, length, lane, projectId, stepId }`。
  - `unscheduled`：分组 TBD 卡（每张含 projectId / projectTitle / owner / stage / stepId / stepName / 灰色虚线样式）。
- 业务触发时机：
  - 项目 `complete_project` 后，其所有步骤随项目一起不再出现在 Gantt 主体，但 `get_gantt` 不主动归档；前端可按 `project.archived` 过滤。
  - 归档项目 `get_gantt` 默认隐藏；如需包含，传 `includeArchived=true` 触发同一读取路径。

## 8. 审计（Audit）

- 每个写操作产生一条 `audit_events`：`(portfolio_id, actor, action, object_type, object_id, detail, created_at)`。
- `actor` 对所有 MCP 写入固定为 `mcp:shak-pmo-owner`。
- 读取：
  - `list_audit_events({ portfolioId, limit?, offset? })` — 组合维度。
  - `get_object_audit({ objectType, objectId, limit? })` — 单对象维度。
  - `objectType ∈ { portfolio, project, step, stage, archive, project_link }`。

## 9. 归档（Archive）

- `archive_project` 只作用于顶级项目；后代必须全部 completed。
- `list_archived_projects({ portfolioId })` 返回已归档项目（含 `archived_at` 字段）。
- 归档后：
  - 项目从 Gantt 主体隐藏；可显式通过 `includeArchived` 查看。
  - 项目保留全部审计。
  - 项目保留对 Stage 的引用；因此 Stage 仍处于引用保护下。

## 10. 错误恢复（标准操作手册）

| 错误模式 | 处理 |
|---|---|
| 401 | 重新从 `/api/agent/install` 复制；若是开发态，联系 PM 重置 Token。 |
| `isError` + 不存在 | 用 `list_*` / `get_*` 找到真实 ID 重试。 |
| `isError` + strict / unknown key | 移除多余字段，特别是任何疑似 `actor` / `scope` 字段。 |
| `isError` + 子项目 | 先处理未归档子项目。 |
| `isError` + 后代未完成 | 先 `complete_project` 每个后代再 archive。 |
| `isError` + URL | 改 http(s)。 |
| `isError` + 已被引用 (Stage) | 迁移项目 Stage 引用。 |
| 工具缺失 | 检查 MCP URL 是否 `https://pmo.pmoforms.com/mcp`；通过 `get_capabilities` 确认 `toolCount == 31`。 |

## 11. 隐私与安全边界

- Bundle、manifest、Git、网页静态资源不出现真实 Token、密码、Session、GitHub PAT。
- Token 仅通过登录后的 `/api/agent/install` 动态返回（`Cache-Control: no-store`）。
- 本地 `SHAK_PMO_MCP_TOKEN` 等存于 `.dev.vars`（不提交）或生产 Cloudflare Secret（由 Codex 注入）。
- Codex GitHub 私有权访问需当前机器具备仓库读取权限；否则 `install` 给出明确错误而非假成功。
