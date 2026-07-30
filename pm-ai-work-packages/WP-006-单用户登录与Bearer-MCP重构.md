# 工作包 WP-006｜单用户网页登录与 Bearer MCP 重构

## 基本信息

- 项目：Shak 项目组合治理系统
- 签发人：Codex（PM / QC）
- 接收人：Cursor
- 签发日期：2026-07-30
- 优先级：**P0**
- 状态：**已签发，待开发**
- 替代关系：本工作包取代 WP-003 的全部 OAuth/Access/手写 MCP 实现方向；WP-003 与其 QC/RESULT 仅保留审计记录。

## 必读文件（先读完再改）

1. `pm-ai-work-packages/WP-006-单用户登录与Bearer-MCP重构.md`（本文件，唯一实施口径）
2. `pm-ai-work-packages/WP-003-原生MCP与Agent接入中心.md`（仅了解历史；其中与 v3 相冲突内容无效）
3. `pm-ai-reviews/WP-003-原生MCP与Agent接入中心-QC.md`（理解已拒绝的手写协议问题）
4. `docs/生产架构.md`、`docs/需求登记册.md`、`README.md`
5. `src/index.ts`、`src/api/*.ts`、`src/lib/*.ts`（必须复用既有业务校验和审计服务）
6. `public/index.html`、`public/app.js`、`public/styles.css`
7. `agent-skills/shak-project-portfolio-governance/*`
8. `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/PM_SCOPE_BASELINE.md`
9. `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/PM_CURRENT_STATUS.md`

RESULT 必须逐项列出 Read Evidence 与关键结论。

## 唯一正式行为

### 1. 原生网页登录（仅 Human Owner）

- 页面提供 `GET /login`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/session`。
- 邮箱、密码、会话签名密钥只从以下 Cloudflare Worker Secret 读取：
  `SHAK_PMO_WEB_LOGIN_EMAIL`、`SHAK_PMO_WEB_LOGIN_PASSWORD`、`SHAK_PMO_SESSION_SECRET`。
- 不得把凭据或其派生值写入 D1、R2、Git、`public/`、Skill、manifest、测试夹具、日志或 RESULT。
- 登录成功设置签名 `HttpOnly; Secure; SameSite=Strict; Path=/` Session Cookie；有效期 8 小时；退出必须使当前 Cookie 立即失效。密码/邮箱校验须使用时序安全比较或等价 Web Crypto 实现。
- 除 `/login`、`/api/auth/*`、`/api/health`、`/mcp`、`/agent/skills/*`、`/agent/manifest.json` 外，网页路由和既有业务 `/api/*` 都必须有有效 Session 才可访问。未登录网页跳转 `/login`；未登录 API 返回 JSON 401。
- 登录页面和业务页面不得把密码、MCP Token 或 Session 值写入 DOM、URL、浏览器 localStorage/sessionStorage 或 console。

### 2. 正式 MCP：官方 handler + 单用户 Bearer

- 保留标准 Streamable HTTP `POST https://pmo.pmoforms.com/mcp`。
- 必须使用当前官方 `agents/mcp/server` 的 `createMcpHandler` 和官方 MCP Server SDK/Zod；**禁止手写 JSON-RPC、session/transport 分发，禁止回退到旧 `src/mcp/server.ts`。**
- MCP 前置 middleware 只接受 `Authorization: Bearer <token>`，与 Worker Secret `SHAK_PMO_MCP_TOKEN` 进行时序安全比较：缺失/不匹配为 JSON `401`；正确则放行官方 handler。
- `/mcp` 完全独立于网页登录：无 Cookie 的标准 MCP Client 带正确 Bearer 必须成功；不得返回 302、登录 HTML、OAuth metadata 或 OAuth challenge。
- 不实现 OAuth、scope、动态注册、KV token/grant、Access OAuth、`.well-known/oauth-*` 或开发 OAuth mock。所有正确 Bearer 调用拥有全部工具权限。
- 所有 MCP 写工具复用既有业务服务与审计，服务端固定 `actor = mcp:shak-pmo-owner`；不接受、不过信任调用方传入的 actor、email、scope 或权限字段。
- 工具矩阵仍完整覆盖：组合；项目/层级/完成/归档；步骤（含 TBD↔Plan）；Stage；关联资料；日周月甘特及未排期包；审计/归档查询；`get_capabilities`。输入必须由 Zod 在运行时严格校验（缺失、未知字段、类型/枚举错误均拒绝）。

### 3. 登录后的一键 Agent 安装

- 新增 `GET /api/agent/install`：仅有效网页登录 Session 可调；`Cache-Control: no-store`；运行时读取 `SHAK_PMO_MCP_TOKEN`，生成 Codex、Cursor、通用 MCP Client 三种完整可复制文案。
- 复制文案**直接带真实 Bearer Token**。这是 Human Owner 明确批准的单用户体验；但 token 不得出现于任何静态文件、Git、Skill、manifest、公开 API、日志或 RESULT。
- Codex CLI 当前没有 `--bearer-token` 参数。Codex 文案必须以登录后返回的真实 token 执行：先 `launchctl setenv SHAK_PMO_MCP_TOKEN '<TOKEN>'`（同时 export 供当前终端验证），再使用
  `codex mcp add shak-project-portfolio-governance --url https://pmo.pmoforms.com/mcp --bearer-token-env-var SHAK_PMO_MCP_TOKEN`。
  文案须提示完全退出并重开 Codex Desktop 后验证，不能伪称已热加载。
- Cursor 文案必须安全合并 `~/.cursor/mcp.json`，保留已有 server；为本服务器写入 `Authorization: Bearer <TOKEN>` header；下载正式 `.cursor/rules/shak-project-portfolio-governance.mdc` 并校验 manifest SHA-256。
- 通用文案给出 Streamable HTTP URL 与 Authorization header，包含 manifest/Skill 校验和 tools/list 验证步骤。
- 前端接入中心在未登录时不显示安装文案；登录后请求此动态接口显示并复制。不得在 `public/app.js` 内硬编码 token、OAuth 字样或旧配置模式。

### 4. 原生 Skill Bundle 与文档

- Git 内的 Codex Skill 必须是可安装的完整目录，而非单一孤立 Markdown：
  `SKILL.md`（入口与强制工作流）、`references/tool-contract.md`（完整工具矩阵、字段与稳定输出）、`references/governance-rules.md`（层级/归档/Stage/TBD/URL/审计规则）、`agents/openai.yaml`（Skill UI 元数据）。不创建 README、安装指南等冗余文件。
- `SKILL.md` 必须有准确的 YAML frontmatter（`name`、`description`）；description 明确触发范围：使用 MCP 维护 Shak 项目组合、项目、步骤、Stage、资料链接、甘特、审计与归档。
- Skill/Rule 准确说明：Bearer 由登录页复制的安装文案配置；所有治理修改只走 MCP；写前读取、禁止猜 ID、归档/Stage/TBD/URL 规则、错误恢复和全量工具矩阵。工具具体 schema 的最终事实来源为 MCP `tools/list`，Skill 不得虚构参数。
- `manifest.json` 必须列出 bundle 全部公开文件及各自 SHA-256；安装脚本逐一下载并校验，而不是只下载 `SKILL.md`。
- Codex 安装完成后，必须确认 bundle 位于 `~/.codex/skills/shak-project-portfolio-governance/`，完全重启 Codex Desktop，在新会话中通过用户任务触发 Skill，并调用 MCP `get_capabilities` 与 `tools/list` 验证。Cursor 同样安装 `.mdc` 和对应 reference 文件。
- 更新 README、`docs/生产架构.md`、`docs/需求登记册.md`：删除 OAuth/Access/KV/scope 说法，改为本工作包正式模型。

## 清理清单（必须执行）

下列是错误方向或调试残留，必须从正式代码、依赖、配置、文档与测试中清除；删除前确认不影响已生产的 D1/REST/甘特功能：

1. `@cloudflare/workers-oauth-provider`、OAuthProvider 包装、`OAUTH_KV` 绑定、OAuth KV `wrangler.toml` 段。
2. `src/mcp/auth.ts`、`auth-sdk.ts`、`auth-handler.ts`、`authorization.ts`、手写 `server.ts`，以及其 OAuth/scope/.well-known 路由。
3. `src/index-old.ts`、`src/crypto-test.ts`、`src/minimal-test.ts`、`src/minimal-oauth-test.ts`、`wrangler.minimal.toml`、`wrangler.minimal-oauth.toml` 等临时/备份调试文件。
4. 前端、Skill、manifest、README、生产架构、需求登记册中所有 OAuth、Access、scope、pending_admin_enablement、dev OAuth 的过期说明。

可复用但须复核：`src/mcp/server-sdk.ts` 的业务工具注册、Zod schema、Skill/manifest 生成脚本和接入中心 UI 外壳。若其不满足本包“官方 handler、运行时严格校验、无 OAuth 残留”任一条件，重写而不是兼容旧逻辑。

## 禁止事项

- 不部署、不执行 `wrangler secret put`、不修改 D1/R2/DNS/Git remote；这些由 Codex 在 QC 通过后完成。
- 不创建新 KV/DO/外部认证服务，不增加 schema/migration；若认为必须新增，停止并报告理由。
- 不删除已接受的 REST、D1、甘特、TBD、关联资料、Stage、归档功能。
- 不把 `SHAK_PMO_*` 的真实值写入任意文件、命令输出、截图或 RESULT。
- 不声称生产已登录、已配置 Secret、已上线或已获 Human Owner 验收。

## 必须提供的真实验证

1. `npm run lint`、`npm test`、`npm run build`、migration 幂等、既有 HTTP smoke 全通过。
2. MCP 集成：官方 handler 的 `initialize`、`tools/list`、全量工具 schema 拒绝与至少每个写领域一个成功/审计案例。
3. 无 Cookie：`POST /mcp` + 正确 Bearer 返回 MCP JSON；缺失/错误 Bearer 返回 `401` JSON；响应均不是 302/HTML。
4. Web 登录：错误凭据拒绝；正确凭据得到 Secure HttpOnly Cookie；未登录无法读取既有业务 API 与 `/api/agent/install`；登录后可访问；退出后立即失效。
5. 动态安装接口：返回三段指令且含 token；扫描所有 Git 跟踪文件、`public/` 和 RESULT，证明没有真实 token；响应有 `Cache-Control: no-store`。
6. 干净临时 Codex 与 Cursor 配置验证：安全合并、MCP 可见、`tools/list`、`get_capabilities`、一读一写成功。测试 token 只能来自本地临时环境，不得输出。

## 完成后提交

新增 `pm-ai-work-packages/WP-006-单用户登录与Bearer-MCP重构-RESULT.md`，最终状态只能是：`implemented, pending PM/QC review`。
