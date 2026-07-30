# WP-003 结果报告｜原生认证 MCP、版本化 Agent Skill 与一键接入中心

- 项目：Shak 项目组合治理系统
- 接收人：Cursor
- 优先级：P0
- **最终状态：implemented, pending PM/QC review**

> 本报告不含任何 token / secret / cookie / client secret。生产 OAuth 由基础设施负责人（Codex）配置，本包未部署、未配置 Access。

---

## 0. Read Evidence（已完整阅读并记录关键结论）

| 文件 | 关键结论 |
|---|---|
| `pm-ai-work-packages/WP-003-原生MCP与Agent接入中心.md` | 权威工作包；MCP 必须官方 Streamable HTTP + OAuth 2.1、复用业务服务与审计、actor 来自认证身份、三卡接入中心、版本化 Skill、单一配置源、禁止部署与改 schema。 |
| `pm-ai-work-packages/WP-005-TBD规划包与时间轴可靠性-QC.md` | **该文件在仓库中不存在**（PM 尚未提交此 QC 文档）。作为边界记录，未据此文件做任何改动；TBD/时间轴逻辑以已合入的 WP-005 实现与 smoke 为准。 |
| `docs/生产架构.md` | 生产为单 Worker + D1（binding DB）+ R2（BACKUPS），域名 `pmo.pmoforms.com`；MCP 应作为 Worker 一部分，认证身份为审计 actor 唯一可信来源。 |
| `docs/需求登记册.md` | REQ-020（全量 MCP）、REQ-021（接入中心）、REQ-022（版本化 Skill）为已批准 P0。 |
| `src/index.ts` | Hono app；`/api/*` 进 API，非 `/api/*` 交 `env.ASSETS`；已在此挂载 `/mcp`、OAuth 发现与 dev 授权端点、`/api/agent/config`。 |
| `src/api/*.ts` | 业务服务签名与校验：`createPortfolio/…`、`archiveProject` 返回 `{success,message}`、`deleteProject` 抛「未归档子项目」、`updateStep` 内建 TBD↔Plan、`createProjectLink` 校验 http(s)、`updateStage/deleteStage` 返回 `{success,message}`。MCP 全部复用之。 |
| `src/lib/*.ts` | `db.ts` 提供 `generateId/now/createAuditEvent/isValidDate`；`gantt.ts` 的 `buildGanttData` 返回 timeline/rows/unscheduled/config，供 `get_gantt` 直接复用。 |
| `public/index.html`、`public/app.js`、`public/styles.css` | 标签+视图结构；已新增「Agent 接入」标签与视图、`loadAgentCenter()` 逻辑、`.agent-*` 样式。 |
| `PM_CURRENT_STATUS.md`、`PM_SCOPE_BASELINE.md`（`/Users/didi/Documents/Codex/2026-07-23/...`） | **路径不存在于本机**（属 PM 私有记忆目录，未随仓库分发）。作为边界记录，未修改任何 PM baseline。 |

---

## 1. 认证设计

### 角色与模式
- **生产（未启用）**：Worker 作为 OAuth 2.0 Resource Server（RFC 9728），校验外部授权服务器（Cloudflare Access）签发的 Bearer JWT（JWKS 验签、iss/aud/exp/nbf 校验）。由 `MCP_OAUTH_ISSUER` + `MCP_OAUTH_JWKS_URL`（可选 `MCP_OAUTH_AUDIENCE`）激活。**当前生产未配置这些变量，故 `/mcp` 返回 503 `pending_admin_enablement`。**
- **本地开发**：`MCP_DEV_AUTH=enabled` 时内嵌一个最小 OAuth 2.1 授权服务器（RFC 8414 元数据 + 动态注册 + authorize + token + JWKS），使用 **ephemeral ES256 密钥（仅内存、每实例一份、不落盘、不进 Git、不入日志）**，支持 PKCE S256。仅用于本地端到端验证。
- **未配置**：既非生产也非 dev → `configured:false / pending`，`/mcp` 返回 503，网页显示「待管理员启用」。

### 授权规则
- Scope 分级展开：`archive ⊃ write ⊃ read`。
- 工具级 scope 声明：读工具 `read`、写工具 `write`、`archive_project` 需 `archive`。
- **audit actor = `mcp:<email|sub>`**，取自 JWT claim，忽略客户端任何 `actor` 字段。
- 未认证 → 401（带 `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"`）。
- scope 不足 → tools/call 返回业务错误 + HTTP 403。

### 端点
| 路径 | 说明 |
|---|---|
| `POST /mcp` | Streamable HTTP JSON-RPC 2.0：initialize/ping/tools/list/tools/call |
| `GET /.well-known/oauth-protected-resource` | RFC 9728 受保护资源元数据（生产+dev 均有） |
| `GET /.well-known/oauth-authorization-server` | RFC 8414（仅 dev） |
| `GET /mcp-oauth/authorize`、`POST /token`、`POST /register`、`GET /jwks` | dev 授权服务器（仅 dev） |
| `GET /api/agent/config` | 单一配置源公开元数据（含 oauth 状态；无 secret） |

---

## 2. 完整工具矩阵（31 个工具，复用业务服务与审计）

| # | 工具 | scope | 业务副作用 / 规则 |
|---|---|---|---|
| 1 | list_portfolios | read | — |
| 2 | get_portfolio | read | 不存在→业务错误 |
| 3 | create_portfolio | write | 审计 create |
| 4 | update_portfolio | write | 审计 update |
| 5 | delete_portfolio | write | 审计 delete |
| 6 | list_projects | read | includeArchived 可选 |
| 7 | get_project | read | — |
| 8 | create_project | write | parent_id 建层级；health 枚举校验 |
| 9 | update_project | write | 可改 parent/status/gate 等 |
| 10 | delete_project | write | **有未归档子项目→拒绝** |
| 11 | complete_project | write | status=completed |
| 12 | archive_project | **archive** | 仅顶级；**后代须全完成**；否则拒绝 |
| 13 | get_project_stats | read | total/active/completed/archived |
| 14 | list_steps | read | — |
| 15 | list_portfolio_steps | read | — |
| 16 | create_step | write | 无合法日期或 tbd→未排期；status 枚举校验 |
| 17 | update_step | write | **TBD↔Plan**：补齐日期→planned；清空(`""`)→tbd |
| 18 | delete_step | write | — |
| 19 | list_stages | read | — |
| 20 | create_stage | write | — |
| 21 | update_stage | write | **被引用→禁止改名** |
| 22 | delete_stage | write | **被引用→禁止删除** |
| 23 | list_project_links | read | — |
| 24 | create_project_link | write | **url 仅 http(s)** |
| 25 | update_project_link | write | url 仅 http(s) |
| 26 | delete_project_link | write | — |
| 27 | get_gantt | read | 日/周/月；timeline/rows.bars/unscheduled |
| 28 | list_audit_events | read | 组合审计分页 |
| 29 | get_object_audit | read | 对象审计历史 |
| 30 | list_archived_projects | read | 已归档项目 |
| 31 | get_capabilities | read | 版本/manifest/协议/健康 |

每个工具具备：强类型 `inputSchema`（`additionalProperties:false`）、中文描述、`tools/list` 中 `annotations.requiredScope`、稳定 machine-readable 输出（structuredContent + text）。

---

## 3. 修改 / 新增文件清单

**新增**
- `agent-skills/shak-project-portfolio-governance/agent.config.json` — 单一配置源
- `agent-skills/shak-project-portfolio-governance/SKILL.md` — Skill 权威源
- `agent-skills/shak-project-portfolio-governance/shak-project-portfolio-governance.mdc` — Cursor Rule 权威源
- `agent-skills/shak-project-portfolio-governance/manifest.json` — 生成物（含 SHA-256）
- `src/mcp/config.ts` — 导入配置源，强类型 + 常量
- `src/mcp/auth.ts` — OAuth 2.1 认证/授权、JWKS 验签、RFC 9728 元数据、dev 授权服务器
- `src/mcp/tools.ts` — 31 工具矩阵，复用 `src/api/*`
- `src/mcp/server.ts` — JSON-RPC 2.0 / Streamable HTTP handler
- `scripts/generate-agent-manifest.mjs` — manifest 生成 + 静态资产同步
- `scripts/mcp-test.mjs` — MCP 端到端集成测试
- `public/agent/manifest.json`、`public/agent/skills/shak-project-portfolio-governance/{SKILL.md,*.mdc}` — 生产静态资产

**修改**
- `src/index.ts` — 挂载 `/mcp`、OAuth 发现、dev 授权端点、`/api/agent/config`
- `public/index.html` — 新增「Agent 接入」标签与视图
- `public/app.js` — `loadAgentCenter()`、三卡一键复制、单一配置源
- `public/styles.css` — `.agent-*` 样式
- `package.json` — 新增 `agent:manifest`、`mcp:test` 脚本
- `tsconfig.json` — `resolveJsonModule: true`
- `README.md` — Agent 接入中心 / OAuth / Skill / 故障排查 / 安全边界

---

## 4. 逐项验收证据（真实命令与响应）

### 4.1 lint / unit / build
```
$ npm run lint         → 0 errors（clean）
$ npm test             → 12 通过, 0 失败（gantt-core 真实实现）
$ npm run build        → wrangler dry-run，Total Upload 157.84 KiB，--dry-run exiting now（编译通过）
```

### 4.2 migration（连续两次退出码 0）
```
$ npm run db:migrate   → ✅ No migrations to apply!   EXIT1=0
$ npm run db:migrate   → ✅ No migrations to apply!   EXIT2=0
```
（schema 未改动，迁移集与 WP-002A/005 一致，幂等。）

### 4.3 dev 启动 + HTTP 静态资源（含新增 /agent/*）
```
200  /
200  /index.html
200  /app.js
200  /styles.css
200  /agent/manifest.json
200  /agent/skills/shak-project-portfolio-governance/SKILL.md
200  /agent/skills/shak-project-portfolio-governance/shak-project-portfolio-governance.mdc
```

### 4.4 生产 Access 未配置的边界（真实响应）
未传 `MCP_DEV_AUTH` 的实例：
```
GET /api/agent/config → oauth = {"configured": false, "mode": "pending", "status": "pending_admin_enablement"}
GET /.well-known/oauth-authorization-server → 404（dev 未启用）
GET /.well-known/oauth-protected-resource → {"status":"pending_admin_enablement", "authorization_servers":[]}
```
→ 网页显示「待管理员启用」，`/mcp` 返回 503，不伪造安装成功。**符合 C.6 要求。**

### 4.5 MCP 集成测试（dev OAuth，端到端 30/30 通过）
`npm run dev -- --port 8789 --var MCP_DEV_AUTH:enabled` 后：
```
$ MCP_ORIGIN=http://127.0.0.1:8789 npm run mcp:test
✅ OAuth 授权服务器元数据可发现（RFC 8414）
✅ 受保护资源元数据可发现（RFC 9728）
✅ JWKS 可获取（含 ES256 公钥）
✅ initialize 返回协议版本与 serverInfo
✅ 未认证 tools/list 返回 401 且带 WWW-Authenticate
✅ 未认证 tools/call 返回 401
✅ tools/list 覆盖全工具矩阵，且每个工具有 schema 与 scope 注解
✅ get_capabilities 返回版本 / manifest / 健康
✅ read scope 拒绝写（create_portfolio → 403）
✅ write scope 成功创建组合（写入生效）
✅ 组合审计 actor 来自认证身份（非客户端伪造）
✅ 组合 schema 拒绝（create_portfolio 缺 name → 业务错误）
✅ 创建 Stage（写入生效）
✅ 创建父项目 + 子项目（parent_id 建层级）
✅ project schema 拒绝（health 非法 → 业务错误）
✅ delete_project 业务规则：存在未完成子项目时拒绝
✅ 创建 TBD 步骤（无日期 → 未排期）
✅ update_step 补齐日期：TBD→Plan 自动 planned
✅ update_step 清空日期：Plan→TBD 自动回退
✅ step schema 拒绝（status 非法 → 业务错误）
✅ 创建关联资料（http(s) 通过）
✅ 关联资料业务规则：非 http(s) 被拒
✅ Stage 删除保护：被项目引用时禁止删除
✅ get_gantt 日视图返回 timeline/rows/unscheduled
✅ get_gantt 月视图 120 月无截断
✅ write scope 拒绝 archive（archive_project → 403）
✅ archive scope 仍受后代完成规则限制（未完成 → 拒绝）
✅ archive scope：完成全部后代后可归档
✅ list_archived_projects 能查到已归档项目
✅ get_object_audit 返回对象审计历史
📊 MCP 集成测试结果: 30 通过, 0 失败
```

验收条件对照：
- **initialize / tools/list / 全工具矩阵**：✅（工具数=31 与 get_capabilities.toolCount 一致）
- **每个写领域：成功写入 + schema/业务拒绝 + 审计 actor 来自认证上下文**：✅（组合/项目/步骤/Stage/链接均覆盖；审计断言 `actor.startsWith('mcp:')` 且为 dev 身份）
- **未认证拒绝 / read 拒绝写 / write 拒绝 archive / archive 仍受后代完成规则**：✅（四条独立断言）
- **一读一写端到端**：✅（读 get_gantt/list_*，写 create_*/update_*/archive）

### 4.6 REST / 甘特 / 关联资料 / 归档 / 审计全量回归（无回归）
```
$ API_URL=http://127.0.0.1:8789/api node scripts/smoke-test.js
📊 测试结果: 36/36 通过
```

### 4.7 版本化 Skill + SHA-256 完整性
```
$ npm run agent:manifest
skillVersion=1.0.0 toolProtocol=2025-06-18
SKILL.md sha256=341afdf0bb0392ff7646f162fee2b80d57d0dc8ac958b8e36ca54ad93595d7a6 (8069 bytes)
*.mdc   sha256=b52c1acef41666b9c1d9ed1dc2c3880157555ee9fc5e181922f936ce894be69b (3727 bytes)

# 生产静态资产与哈希一致性校验：
$ curl -s .../agent/skills/.../SKILL.md | shasum -a 256
341afdf0bb0392ff7646f162fee2b80d57d0dc8ac958b8e36ca54ad93595d7a6  -   ← 与 manifest 完全一致
```

### 4.8 网页接入中心（单一配置源，三卡一键复制）
- 新增「Agent 接入」标签；三张卡 Codex / Cursor / 通用 MCP Client，各一个「一键复制安装指令」按钮。
- 复制内容：使用 `https://pmo.pmoforms.com/mcp` 与固定名称 `shak-project-portfolio-governance`；Cursor 用 Python 脚本**安全合并** `~/.cursor/mcp.json` 且不覆盖其它 MCP、安装 `.cursor/rules/*.mdc`；Codex 用 `codex mcp add ... --url ...` + 下载 SKILL.md + `codex mcp list` 验证；通用卡走 MCP Inspector。
- 均含 OAuth 授权提示、连接/工具发现/`get_capabilities` 版本校验、失败诊断（401/403/503）；URL/manifest/版本来自 `/api/agent/config`，不硬编码派生。
- 未启用时状态条显示「待管理员启用」，不伪造成功。

### 4.9 Codex / Cursor 指令说明（离线校验）
- Codex 指令严格采用工作包要求的 `codex mcp add shak-project-portfolio-governance --url https://pmo.pmoforms.com/mcp`，随后 OAuth 登录并 `codex mcp list` / `get_capabilities` 验证。
- Cursor 指令合并 `~/.cursor/mcp.json`（保留既有）并安装 `.mdc` Rule；明确注明「Cursor 使用 `.cursor/rules/*.mdc`，不会原生读取 Codex 的 SKILL.md」。
- `.mdc` 采用标准 frontmatter（`description` / `globs` / `alwaysApply`）+ 正文，格式合法。

> 说明：`codex mcp add` / Cursor 客户端在**干净临时配置中的真机交互式 OAuth**需要外部客户端与人工登录，属人工验收环节；本地已用等价的 MCP Inspector 同款 OAuth 2.1（discovery→register→authorize→token(PKCE S256)→tools/list→读/写）在 `scripts/mcp-test.mjs` 完成端到端自动化验证（4.5）。

---

## 5. 未配置生产 Access 的明确边界

- 生产 `pmo.pmoforms.com/mcp` 在管理员配置 Cloudflare Access（设置 `MCP_OAUTH_ISSUER` + `MCP_OAUTH_JWKS_URL`）**之前**：返回 `503 pending_admin_enablement`，网页显示「待管理员启用」。
- 本包**未**执行 `wrangler deploy`，**未**创建/修改 Cloudflare Access / Zero Trust / OAuth App / KV / D1 / R2 / DNS / 域名 / secret / Git remote，**未**修改既有数据库 schema。
- dev 授权服务器仅在 `MCP_DEV_AUTH:enabled` 时激活，密钥 ephemeral、仅内存；生产不得开启该 var。
- 未真机执行 Codex/Cursor 客户端的交互式 OAuth 登录（需人工与外部客户端），亦未声称已部署、已配置 Access、已完成 OAuth 授权或已被 Human Owner 接受。

---

## 6. 最终状态

**implemented, pending PM/QC review**
