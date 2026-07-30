# Shak 项目组合治理系统

系统唯一正式名称：**Shak 项目组合治理系统**。基于 Cloudflare Workers + D1 的多项目治理甘特图应用。

> 命名说明：用户可见的网页标题、H1、产品文档统一使用"Shak 项目组合治理系统"。技术资源标识（Worker `pmo-governance`、D1 `pmo-governance-prod`、域名 `pmo.pmoforms.com`、GitHub 仓库 slug）不随命名变更而改名。

## 技术栈

- **前端**: 原生 HTML/CSS/JavaScript（中文界面）
- **后端**: Cloudflare Workers (Hono 框架)
- **数据库**: Cloudflare D1
- **构建**: Wrangler CLI
- **MCP**: `agents/mcp` 的官方 `createMcpHandler` + `@modelcontextprotocol/server` 的 `McpServer` + Zod（运行时严格 schema）

## 功能特性

- 单用户邮箱+密码登录（`/login`、`/api/auth/*`），Session Cookie `HttpOnly; Secure; SameSite=Strict` 8 小时有效
- 组合（Portfolio）管理
- 项目层级（父子关系）
- 步骤计划与甘特图（日/周/月视图）；每一步可维护依赖类型、前置/关键输入与阻塞影响，甘特图不会把依赖说明误画成日期条
- 自定义 Stage 管理（含删除/改名保护）
- 项目关联资料（仅支持 http(s) URL）
- 整体归档规则（仅顶级项目 + 全部后代完成）
- 审计日志
- 官方原生 MCP：`https://pmo.pmoforms.com/mcp`，单用户 Bearer Token；网页 /api/agent/install 在登录会话内返回含真实 Token 的安装指令

## 快速开始

### 前置条件

- Node.js >= 18
- Wrangler CLI (`npm i -g wrangler`)
- Cloudflare 账号（已配置 Wrangler OAuth）

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 D1 数据库

**方式一：使用 Cloudflare Dashboard 创建**

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 Workers & Pages > D1
3. 创建新数据库，名称：`pmo-governance-prod`
4. 复制 Database ID

**方式二：本地创建测试数据库**

```bash
npm run db:create
```

### 3. 更新 wrangler.toml

将 `database_id` 替换为实际值：

```toml
[[d1_databases]]
binding = "DB"
database_name = "pmo-governance-prod"
database_id = "YOUR_ACTUAL_DATABASE_ID"
```

### 4. 配置 Worker Secrets（开发与生产都要）

复制 `.dev.vars.example` 为 `.dev.vars`（已 `.gitignore`）填入本地临时值；生产通过 `wrangler secret put` 注入：

- `SHAK_PMO_WEB_LOGIN_EMAIL` — 唯一合法账号邮箱
- `SHAK_PMO_WEB_LOGIN_PASSWORD` — 唯一合法账号密码
- `SHAK_PMO_SESSION_SECRET` — ≥ 32 字节随机串，用于 Session Cookie HMAC 签名
- `SHAK_PMO_MCP_TOKEN` — 单用户 MCP Bearer Token；本地任意 ≥ 32 字节随机串
- `SHAK_PMO_SKILL_SOURCE_COMMIT` — Codex 发布后写入的 40 位 Git commit；一键安装从该固定 commit 下载并校验完整 Skill Bundle

### 5. 运行 Migrations

```bash
# 本地 D1
npm run db:migrate
```

在空本地 D1 连续执行两次均应成功（幂等性）。

### 6. 初始化样例数据（可选）

```bash
npm run db:init
```

### 7. 启动本地开发服务器

```bash
npm run dev
```

默认监听 `http://localhost:8787`（可用 `npm run dev -- --port 8788` 指定端口）。

Worker 会把非 `/api/*` 与非 `/mcp` 请求转交给 `[assets]` 绑定（`public/` 目录），因此直接访问以下路径均返回 200：

- `/login`、`/index.html`、`/` → 网页（text/html）
- `/app.js`、`/styles.css`、`/login.js` → 前端静态资源
- `/api/health` → API 健康检查（application/json）

## 开发命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动本地 Worker（带热重载） |
| `npm run lint` | ESLint 代码检查 |
| `npm test` | 运行单元测试 |
| `npm run build` | 构建预览（dry-run，不部署） |
| `npm run db:migrate` | 运行数据库迁移 |
| `npm run db:init` | 初始化样例数据 |
| `npm run db:smoke` | 运行 API 冒烟测试（需先启动 dev；带 Cookie 登录） |
| `npm run skill:build` | 生成本地 `agent-skills/.../manifest.json`（覆盖 bundle 全文件 + SHA-256；Git commit SHA 由 Codex 发布后注入） |
| `npm run test:e2e` | 真 Worker runtime 集成测试（Miniflare + bundle 内 `public/*` 与 MCP Server SDK） |
| `npm run mcp:test` | 运行 MCP Bearer 集成测试（需先启动 dev） |

### 运行 API 冒烟测试

冒烟测试需要登录态；先用 dev 启动 Worker，并准备 `.dev.vars` 后跑测试脚本：

```bash
# 终端 1
npm run dev -- --port 8788

# 终端 2
API_URL=http://127.0.0.1:8788/api LOGIN_EMAIL=<email> LOGIN_PASSWORD=<password> \
  npm run db:smoke
```

测试脚本内部会先 `POST /api/auth/login` 取 Cookie，然后跑既有业务回归。

### 运行 MCP Bearer 集成测试

```bash
# 终端 1
npm run dev -- --port 8788

# 终端 2
MCP_ORIGIN=http://127.0.0.1:8788 MCP_TOKEN=$(grep SHAK_PMO_MCP_TOKEN .dev.vars | cut -d= -f2) \
  npm run mcp:test
```

测试覆盖：Bearer 鉴权（无/错/对）、`initialize`、`tools/list`、全 31 工具运行时 schema 拒绝、写领域 actor 审计。

### 运行真 Worker runtime 集成测试（无需 dev server）

`npm run test:e2e` 用 Miniflare 启动真 Worker（不在沙箱外暴露端口），覆盖：

- 缺失/错误/正确 Bearer + initialize + tools/list + 31 工具 schema 严格校验
- 业务规则：Stage 删除保护被引用时拒绝、关联资料 URL 协议校验、create_step 缺日期视为未排期
- 网页登录与保护：未登录 `GET /` → 302 `/login`、登录成功带 Cookie 可访问、`/api/agent/install` 含 `launchctl setenv` + `--bearer-token-env-var`、logout 立即失效
- `/mcp` 永不返回 302/HTML（即使带 Cookie）

输出默认 25 项断言全过；任何失败都会打印根因（不静默）。

## API 端点

### 鉴权（公共）

- `GET /login` — 登录页
- `POST /api/auth/login` — 邮箱+密码登录，返回 `Set-Cookie`
- `POST /api/auth/logout` — 登出，Cookie 失效
- `GET /api/auth/session` — 查询当前会话状态
- `GET /api/health` — 健康检查
- `GET /api/agent/config` — Agent 接入配置（公共，不含 secret）

### MCP 端点

- `POST /mcp` — 官方 Streamable HTTP MCP，需 `Authorization: Bearer <token>`

### 组合（Portfolio）

- `GET /api/portfolios` - 列出所有组合
- `POST /api/portfolios` - 创建组合
- `GET /api/portfolios/:id` - 获取单个组合
- `PUT /api/portfolios/:id` - 更新组合
- `DELETE /api/portfolios/:id` - 删除组合

### 项目（Project）

- `GET /api/portfolios/:pid/projects` - 列出组合下的项目
- `POST /api/portfolios/:pid/projects` - 创建项目
- `GET /api/projects/:id` - 获取单个项目
- `PUT /api/projects/:id` - 更新项目
- `DELETE /api/projects/:id` - 删除项目
- `POST /api/projects/:id/complete` - 标记完成
- `POST /api/projects/:id/archive` - 整体归档
- `GET /api/portfolios/:pid/stats` - 获取统计

### 步骤（Step）

- `GET /api/projects/:pid/steps` - 获取项目的步骤
- `POST /api/projects/:pid/steps` - 创建步骤
- `PUT /api/steps/:id` - 更新步骤
- `DELETE /api/steps/:id` - 删除步骤

### 关联资料（Project Link）

- `GET /api/projects/:pid/links` - 获取项目的关联资料
- `POST /api/projects/:pid/links` - 创建关联资料（URL 必须以 http:// 或 https:// 开头）
- `PUT /api/links/:id` - 更新关联资料
- `DELETE /api/links/:id` - 删除关联资料

### Stage

- `GET /api/portfolios/:pid/stages` - 获取 Stage 列表
- `POST /api/portfolios/:pid/stages` - 创建 Stage
- `PUT /api/stages/:id` - 更新 Stage（被项目使用时禁止）
- `DELETE /api/stages/:id` - 删除 Stage（被项目使用时禁止）

### 甘特图

- `GET /api/portfolios/:pid/gantt` - 获取甘特图数据
  - Query: `start`, `end`, `scale` (day/week/month)

### 审计

- `GET /api/portfolios/:pid/audit` - 获取审计事件
- `GET /api/audit/:type/:id` - 获取对象审计历史

### Agent 接入中心（需登录）

- `GET /api/agent/install` - 返回 Codex / Cursor / 通用 MCP Client 三段含真实 Bearer Token 的安装文案；`Cache-Control: no-store`

## 数据库 Schema

### portfolios（组合）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| name | TEXT | 名称 |
| description | TEXT | 描述 |
| created_at | INTEGER | 创建时间戳 |
| updated_at | INTEGER | 更新时间戳 |

### projects（项目）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| portfolio_id | TEXT | 所属组合 |
| parent_id | TEXT | 父项目（NULL 为顶级） |
| title | TEXT | 项目名称 |
| owner | TEXT | 负责人 |
| stage | TEXT | 当前阶段 |
| health | TEXT | 健康状态 |
| expectation | TEXT | 业务预期 |
| risk | TEXT | 风险说明 |
| gate | TEXT | 门控状态 |
| status | TEXT | 状态 |
| is_archived | INTEGER | 是否归档 |
| archived_at | INTEGER | 归档时间 |

### steps（步骤）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| project_id | TEXT | 所属项目 |
| name | TEXT | 步骤名称 |
| start_date | TEXT | 开始日期 |
| end_date | TEXT | 结束日期 |
| status | TEXT | 状态 |
| sort_order | INTEGER | 排序 |

### stages（Stage 定义）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| portfolio_id | TEXT | 所属组合 |
| name | TEXT | Stage 名称 |
| sort_order | INTEGER | 排序 |

### project_links（关联资料）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| project_id | TEXT | 所属项目 |
| title | TEXT | 资料标题 |
| url | TEXT | 链接地址（必须 http(s):// 开头） |
| created_at | INTEGER | 创建时间戳 |
| updated_at | INTEGER | 更新时间戳 |

### audit_events（审计事件）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| portfolio_id | TEXT | 所属组合 |
| actor | TEXT | 操作者 |
| action | TEXT | 操作类型 |
| object_type | TEXT | 对象类型 |
| object_id | TEXT | 对象 ID |
| summary | TEXT | 变更摘要 |
| details | TEXT | 详细变更 |
| created_at | INTEGER | 创建时间戳 |

## 归档规则

1. **仅顶级项目可归档**：子项目不可单独归档
2. **后代完成检查**：归档前必须验证所有后代项目均已完成
3. **整体归档**：父项目归档时，所有后代项目一并归档

## 备份管理（WP-008）

系统提供每日自动逻辑备份与恢复演练能力，**绝不覆盖生产 D1**。

### 自动备份

- Worker `scheduled()` 每天 UTC 03:00 自动触发，由 `wrangler.toml` cron 配置。
- 备份覆盖 6 张业务表：`portfolios`、`projects`、`stages`、`steps`、`project_links`、`audit_events`。
- 备份格式为 JSON，含：`schemaVersion`、`createdAt`、逐表行数摘要、逐表 SHA-256、整体内容 SHA-256。
- R2 key 格式：`backups/YYYY-MM-DD/<timestamp>.json`。
- 每次成功后保留最近 30 份，超出后自动删除最旧备份。

### 恢复演练

- 登录后访问顶部「备份管理」标签，可查看备份列表、手动触发备份、执行恢复演练。
- 恢复演练仅恢复到隔离/测试 D1（如 `TEST_DB`），**严禁覆盖生产 D1**。
- 演练验证：JSON 结构、`contentSha256`、表存在、逐表行数、逐表 SHA-256。
- 生产数据恢复需由管理员手动操作。

### 备份 API（需登录）

- `GET /api/backups` — 列出最近备份（key、size、createdAt、contentSha256）
- `POST /api/backups` — 手动触发一次备份
- `POST /api/backups/restore` — 执行恢复演练（仅隔离 D1）

## Stage 规则

1. **被项目使用的 Stage 禁止删除**：包括活动项目和归档项目
2. **被项目使用的 Stage 禁止改名**：必须先修改项目引用

## 甘特图规则

- 步骤是甘特条的唯一数据来源
- 只有同时具备合法 `start_date`、`end_date` 且状态非 `tbd` 的步骤才进入日期轴，显示为彩色条
- 支持日/周/月三种视图；时间轴按真实日历单元格（日/周一对齐/月首对齐）生成，条形起止根据实际 cell 边界计算，不做静默截断，可支持长区间（例如 366 天 / 260 周 / 120 月）

## 未排期工作包（TBD）

"未排期工作包"是甘特图下方的独立区域，承载所有尚未确定排期的步骤，与日期轴完全分离。

- **判定为未排期的条件**：缺少 `start_date` 或 `end_date`、日期非法、开始晚于结束，或状态为 `tbd`。
- **展示形式**：按项目分组，每组显示项目名称、Owner、Stage；组内每张工作包为固定尺寸的灰色虚线卡，卡内再次标注所属项目与工作包名称。
- **不占日期轴**：未排期卡不出现在日期轴内部、右侧列、浮层或角标，也不遮挡任何甘特条，不暗示排期。
- **转为已排期（进入日期轴）**：为步骤补齐合法开始/结束日期，并把状态改为 `planned`/`done`/`risk`/`blocked` 后，刷新即从未排期区消失，按对应颜色落入正确日期格。服务端在更新步骤时，若补齐了完整日期且原状态为 `tbd`，会自动将状态置为 `planned`。
- **退回未排期**：清空任一日期或将状态改回 `tbd`，步骤自动回到未排期区。服务端在更新步骤时，若任一日期被清空，会自动将状态置为 `tbd`。
- **整体隐藏**：当没有任何未排期步骤时，整个区域隐藏。

## 关联资料规则

- URL 必须以 `http://` 或 `https://` 开头
- 每次创建、修改、删除均写入审计记录
- 点击链接在新窗口打开

## 网页登录与 MCP 鉴权（WP-006）

### 网页登录

- `GET /login` 提供原生邮箱+密码登录页。
- 凭据来源：Worker Secrets `SHAK_PMO_WEB_LOGIN_EMAIL` / `SHAK_PMO_WEB_LOGIN_PASSWORD`。
- 登录成功：`Set-Cookie: shak_pmo_session=<HMAC token>`；属性 `HttpOnly; Secure; SameSite=Strict; Path=/`；8 小时有效。
- 凭据校验：时序安全字节比较（`timingSafeEqual`），长度不同时仍消耗时间避免侧信道。
- 登出：`POST /api/auth/logout`，Cookie 立即失效。
- 未登录访问网页：跳转 `/login`；未登录调用 API：JSON 401。

### MCP Bearer Token

- 唯一鉴权：`Authorization: Bearer <token>`，与 Worker Secret `SHAK_PMO_MCP_TOKEN` 时序安全比较。
- 缺失/错误 → JSON 401（带 `WWW-Authenticate: Bearer realm="shak-pmo-mcp"`）；绝不返回 302、HTML、OAuth 元数据。
- `/mcp` 与网页登录完全独立：标准 MCP Client 无 Cookie 带正确 Bearer 即可成功。
- 不实现 OAuth / scope / 动态注册 / KV token / Access OAuth / `.well-known/oauth-*`。
- 所有 MCP 写工具的审计 actor 固定为 `mcp:shak-pmo-owner`，由服务端注入，客户端不可覆盖。

## Agent 接入中心（原生 MCP）

系统内置一个**官方、认证、可审计**的 MCP（Model Context Protocol）端点，让 Codex、Cursor 或任何兼容 MCP Inspector 的客户端，
通过统一业务服务准确维护本系统的全部能力。所有写操作复用既有校验与审计，绝不绕过规则直写数据库。

- **MCP 名称（固定）**：`shak-project-portfolio-governance`
- **MCP URL（生产）**：`https://pmo.pmoforms.com/mcp`（标准 Streamable HTTP）
- **鉴权**：`Authorization: Bearer <token>`（Token 由 Codex 注入 Worker Secret `SHAK_PMO_MCP_TOKEN`）
- **协议方法**：`initialize` / `ping` / `tools/list` / `tools/call`
- **单一配置源**：`agent-skills/shak-project-portfolio-governance/agent.config.json`
  → 由 `src/mcp/config.ts` 导入，网页接入中心、manifest、server 版本号全部从此派生，防止漂移。

### 工具矩阵（全量能力）

| 领域 | 工具 | 业务副作用 |
|---|---|---|
| 组合 | list_portfolios / get_portfolio / create_portfolio / update_portfolio / delete_portfolio | 写操作产生审计事件（actor=mcp:shak-pmo-owner） |
| 项目与层级 | list_projects / get_project / create_project / update_project / delete_project / complete_project / archive_project / get_project_stats | parent_id 建立层级；delete 受子项目保护；archive 受后代完成规则 |
| 步骤与 TBD | list_steps / list_portfolio_steps / create_step / update_step / delete_step | 日期/status 决定是否进入时间轴或未排期区 |
| Stage | list_stages / create_stage / update_stage / delete_stage | 被引用 Stage 禁改名、禁删除 |
| 关联资料 | list_project_links / create_project_link / update_project_link / delete_project_link | url 仅 http(s) |
| 甘特 | get_gantt（日/周/月，返回 timeline / rows.bars / unscheduled） | 只读 |
| 审计与归档 | list_audit_events / get_object_audit / list_archived_projects | 只读 |
| 发现与健康 | get_capabilities（版本 / manifest URL / 工具协议 / 鉴权模式 / 健康） | 只读 |

### 网页「Agent 接入中心」

登录后访问顶部「Agent 接入」标签，提供 Codex、Cursor、通用 MCP Client 三张卡，每张一个「一键复制安装或更新指令」按钮：

- 复制内容含真实 Bearer Token；通过 `GET /api/agent/install`（带 Cookie）动态生成，响应头 `Cache-Control: no-store`。
- Codex 指令：写入 `SHAK_PMO_MCP_TOKEN` 后先读取同名 MCP；目标 URL、Bearer 环境变量和启用状态均一致时跳过，不一致时仅替换 `shak-project-portfolio-governance` 这一个条目，不影响其它 MCP；必须完全退出并重开 Codex Desktop；不得使用独立 `--bearer-token` 或 `--header`。
- Cursor 指令：Python 脚本安全合并 `~/.cursor/mcp.json`（保留其它 MCP），写入 `headers.Authorization`；下载 `.mdc` Rule。
- 通用 MCP Client：标准 Streamable HTTP + Authorization Header + Manifest/Skill 校验步骤。
- URL、manifest、版本号全部来自 `/api/agent/config`（公共）；Token 仅在登录会话内由 `/api/agent/install` 注入。

### 版本化 Agent Skill

- **Git 权威源**：`agent-skills/shak-project-portfolio-governance/`（Bundle 根目录）
- **生产安装**：登录后访问 `/api/agent/install`（需 Cookie），自动从固定 Git commit 下的 GitHub raw URL 下载并 SHA-256 校验全部 6 个 Bundle 文件
- Codex 在 PM/QC 通过后，将不可变 40 位 Git commit SHA 写入 Worker 发布配置 `SHAK_PMO_SKILL_SOURCE_COMMIT`；`/api/agent/install` 从该固定 commit 下载
- `manifest.json` 含 `skillVersion`、`mcpUrl`、**SHA-256**、工具协议版本、生成时间
- 安装器校验每文件 SHA-256 后才写入本地 Skill 目录

### 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `/mcp` 返回 401 | 缺失/错误 Bearer | 检查 `Authorization: Bearer <token>` 是否完整；本地对照 `.dev.vars` 中的 `SHAK_PMO_MCP_TOKEN` |
| `tools/call` 返回 `isError: true` + "strict" / "unknown key" | 入参含未声明字段 | Zod `.strict()` 拒绝未知字段；移除多余字段（如 `actor`、`scope`）后重试 |
| `tools/call` 返回 "不存在" | ID 猜测或对象已删 | 先 `list_*`/`get_*` 确认 ID |
| `tools/call` 返回 "http" | 关联资料 URL 非法 | URL 必须以 `http(s)://` 开头 |
| `tools/call` 返回 "子项目/后代/完成" | 归档/删除受层级规则限制 | 先完成或处理子项目再操作 |
| `get_capabilities` 的 `skillVersion` 与本地 manifest 不一致 | Skill 版本漂移 | 重新运行 `npm run skill:build` 并重新从 `/api/agent/install` 获取安装指令 |
| 网页访问跳转 `/login` | 未登录或 Session 失效 | 用邮箱+密码登录；登出按钮位于顶部右侧 |
| `/api/agent/install` 返回 401 | 未登录 | 登录后再访问 Agent 接入中心 |

### 安全边界

- 无任意 SQL、任意 HTTP 转发或自由文本万能执行工具；仅强类型工具。
- 代码、网页、Skill、manifest、测试与报告中**不含任何 token/secret/cookie/client secret**。
- 本工作包**不执行** `wrangler deploy`，不创建或修改 Cloudflare Access / Zero Trust / OAuth App / KV / D1 / R2 / DNS / 域名 / secret / Git remote，不修改既有数据库 schema。

## 部署前检查

1. ✅ `npm run lint` 无错误
2. ✅ `npm test` 全部通过
3. ✅ `npm run build` 构建成功
4. ✅ `npm run db:migrate` Migration 正常（连续两次幂等）
5. ✅ `npm run db:smoke` API 测试通过（带 Cookie）
6. ✅ `npm run mcp:test` MCP Bearer 集成测试通过
7. ✅ `npm run skill:build` 重新生成 manifest，SHA-256 校验通过

## 目录结构

```
portfolio-governance-app/
├── migrations/
│   └── 0001_initial_schema.sql
├── drizzle/
│   └── seed.sql
├── public/
│   ├── index.html
│   ├── login.html
│   ├── login.js
│   ├── styles.css
│   └── app.js
├── scripts/
│   ├── smoke-test.js
│   ├── unit-test.mjs
│   ├── mcp-test.mjs
│   └── generate-agent-manifest.mjs
├── src/
│   ├── api/
│   │   ├── portfolios.ts
│   │   ├── projects.ts
│   │   ├── steps.ts
│   │   ├── stages.ts
│   │   ├── projectLinks.ts
│   │   └── audit.ts
│   ├── lib/
│   │   ├── db.ts
│   │   ├── gantt-core.js   # 甘特时间轴/条形/未排期核心逻辑（纯 ESM，供 Worker 与单测共用）
│   │   └── gantt.ts        # gantt-core 的 TypeScript 封装
│   ├── mcp/
│   │   ├── config.ts
│   │   └── server-sdk.ts   # 官方 MCP Server + Zod；actor=mcp:shak-pmo-owner
│   ├── types/
│   │   └── index.ts
│   ├── auth.ts             # 网页登录 + HMAC Session Cookie
│   └── index.ts            # Worker 顶层（Bearer /mcp + Hono 默认处理器）
├── package.json
├── tsconfig.json
├── wrangler.toml
└── README.md
```

## 许可证

Internal Use Only
