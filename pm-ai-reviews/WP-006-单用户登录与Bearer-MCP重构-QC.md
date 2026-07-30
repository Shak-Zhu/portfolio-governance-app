# PM/QC 报告｜WP-006 单用户网页登录与 Bearer MCP 重构

- 审查日期：2026-07-30
- Coder 报告状态：`implemented, pending PM/QC review`
- PM/QC 结论：**L3 / rework required（不接受，不得部署）**

## 五层验收状态

| 层级 | 状态 |
|---|---|
| Coder Implemented | 是（声明） |
| PM Reviewed | 是 |
| PM/QC Accepted | 否 |
| Human Accepted | 否 |
| Product Done | 否 |

## 独立实际验证

Codex 在本机以 `.dev.vars` 启动全新 Worker：`npm run dev -- --port 8901`，Worker 返回 Ready，非旧 OAuth 进程。随后以无 Cookie、正确 Bearer 调用 `POST /mcp` 的 `initialize`。

| 验证 | 实际结果 |
|---|---|
| `npm run lint` | 通过 |
| `npm test` | 12/12 通过（仅甘特核心） |
| `npm run build` | 通过 |
| `node scripts/offline-bearer-test.mjs` | 40/40 通过（离线替身，不等于真实 runtime） |
| `GET /` 无登录 Cookie | **200 返回主页面**，不应允许 |
| `GET /login` | **404**，登录页路由不存在 |
| 正确邮箱/密码 `POST /api/auth/login` | 200 并下发 Cookie |
| 带该 Cookie `GET /api/agent/install` | **401 未登录** |
| 正确 Bearer `POST /mcp` initialize | **500**，非 MCP 初始化成功 |

真实 Worker 日志的根因：`TypeError: server.tool is not a function`，位置为 `src/mcp/server-sdk.ts:180`，来自 `createMcpHandler` 调用的 `createMcpServerFactory`。这证明当前 `@modelcontextprotocol/server` 的导入/Server API 用法不正确，31 工具尚未实际注册。

## P0 不通过项

| # | 发现 | 证据 | 必须返工 |
|---:|---|---|---|
| 1 | MCP 不能 initialize，31 工具不可用 | 正确 Bearer 实测 `POST /mcp` 返回 500；Worker 日志为 `server.tool is not a function` | 使用与当前 `agents/mcp/server` 兼容的官方 MCP Server 导入/API；真实启动后通过 initialize、tools/list、全量工具测试。禁止用离线 mock 代替。 |
| 2 | 网页登录入口与页面保护失效 | `GET /login` 实测 404；`GET /` 无 Cookie 实测 200 主页面。`src/index.ts` 的静态资源 middleware 明确放行 `/`、`/index.html`、`.js/.css/.html`，没有 redirect。 | 正确提供 `/login`（可重写至 login.html）；将主页/业务静态页面保护放在 ASSETS fetch 前。未登录必须跳转 `/login`，仅 login 页面及允许的公开 Skill 静态资产可访问。 |
| 3 | 登录 Session 无法验证，动态 Agent 文案永远不可达 | 登录 200 且 Set-Cookie 后，带同一 Cookie 实测 `/api/agent/install` 为 401；`src/auth.ts` 的 `crypto.subtle.verify` 将 signature/data 参数顺序传反。 | 修正为官方 Web Crypto `verify(algorithm, key, signature, data)` 顺序；写真实 HTTP 登录→会话→安装接口→登出失效测试。 |
| 4 | Codex 一键安装命令不可执行 | 当前 `codex mcp add --help` 只支持 `--bearer-token-env-var`，不支持源代码生成的 `--bearer-token` 或 `--header`；`src/index.ts:308` 仍输出这两个错误参数。 | 安装文案直接带 Token，但先用 `launchctl setenv SHAK_PMO_MCP_TOKEN '<TOKEN>'` 和当前 CLI `--bearer-token-env-var SHAK_PMO_MCP_TOKEN`；完全退出/重开 Codex Desktop 后真机验证。 |

## P1 不通过项

| # | 发现 | 必须返工 |
|---:|---|---|
| 5 | 登录比较与 Bearer 比较均声称时序安全，但长度不一致分支提前返回；`timingSafeEqual` 的不等长分支还有零长度取模风险。 | 使用固定长度摘要/HMAC 后再常量时间比较，或明确使用可靠的固定时间等价实现；补充空串、不同长度、相同长度不同内容的真实测试。 |
| 6 | WP-006 所需 Codex Skill Bundle 未完成 | 当前仅有 `SKILL.md`、`.mdc`、`agent.config.json`、`manifest.json`；没有 `references/tool-contract.md`、`references/governance-rules.md`、`agents/openai.yaml`，manifest 也仅列两个文件。此项与 WP-006A 同时处理。 |

## WP-006A 触发结论

按 WP-006A 的强制顺序，WP-006 已被 PM/QC 返工，因此 **WP-006A 现在与本次 WP-006 返工合并执行**。Cursor 必须一并实现 GitHub 固定-commit Skill Bundle 分发，但不得自行发布 Git/tag；Git 发布与最终 raw URL 落位仍由 Codex 在 QC 通过后执行。

## 返工后的最低验收门

1. Codex 以新端口真实启动 Worker，完整通过网页登录、页面保护、Session、登出、业务 API 回归。
2. 无 Cookie 的正确 Bearer 在 `/mcp` 真实完成 initialize、tools/list，并暴露 31 工具；错误/缺失 Bearer 为 JSON 401。
3. 真实 Codex/Cursor 安装文案可执行且不含不存在的 CLI flag；安装后实际 tools/list、一读一写。
4. 完整 GitHub Skill Bundle 按 WP-006A 实现并在临时目录用固定 source reference 下载、hash 校验；最终 Git commit/raw URL 由 Codex QC 后发布。
5. lint、unit、build、migration、HTTP smoke、MCP 集成与 token 扫描全部重跑；RESULT 添加本轮返工事实证据，不能覆盖旧失败记录。

## 范围与安全边界

- 未部署、未写任何生产 Worker Secret、未修改 D1/R2/DNS/Git remote。
- 当前未接受的代码保持未提交状态；Codex 不会从中挑选或部署任何片段。

## 2026-07-30 第二轮返工复审

### 已复验通过

- `npm run lint`、`npm test`（12/12）、`npm run build`、`npm run skill:build`、`npm run test:e2e`（25/25）、离线行为测试及本地 migration 幂等均由 Codex 独立重跑通过。
- 全新 `wrangler dev` 实测：无 Cookie 的 `/` 为 302、`/login` 为 200、登录后的 `/api/agent/install` 为 200；Codex 安装文案已使用 `launchctl setenv` 与 `--bearer-token-env-var`，不再出现无效的 `--bearer-token` / `--header` 参数。
- 标准 MCP 客户端 Accept 头 `application/json, text/event-stream` 下，正确 Bearer 的 `initialize` 成功返回 Streamable HTTP SSE；此前 `server.tool is not a function` 已消除。
- 完整 Skill Bundle 文件夹及 6 项 manifest hash 已存在。

### 仍未通过：WP-006A GitHub 分发 P0

当前 `agent.config.json` 与 `/api/agent/install` 仍使用：

- `https://pmo.pmoforms.com/agent/...` 静态文件 URL；
- `manifestUrl: https://pmo.pmoforms.com/agent/manifest.json`；
- 仅 `curl` 下载文件，**没有**读取 manifest 后逐文件 SHA-256 校验。

这与 WP-006A 已触发后的明确要求冲突：一键文案必须使用 Codex 发布的**固定 Git commit** 下 `agent-skills/shak-project-portfolio-governance/` 精确 raw GitHub URL，不能使用网站静态文件、整个仓库或 `main`；必须逐文件 hash 校验。

### 第二轮结论（角色纠正）

**WP-006 + Cursor 负责部分的 WP-006A 通过 PM/QC。** 当前静态 `pmo.pmoforms.com/agent/...` URL 是发布前的构建占位来源，不是 Cursor 的返工项。

此前把下列“最终固定 GitHub 链接落位”错误归给 Cursor，现明确撤回：

1. 创建/取得最终不可变 Git commit SHA；
2. 将精确 GitHub raw Bundle URL 写进正式一键安装文案；
3. 把 `skillSourceCommit` 填入最终发布 manifest/生产配置；
4. 实现并验证 release 版安装文案对 manifest 的逐文件 SHA-256 校验；
5. 用最终发布链接重新下载、重启 Codex/Cursor、调用 MCP 做最终验收。

以上全部是 **Codex 的 Git/发布/基础设施职责**，仅在 Git 发布阶段执行；Cursor 不再返工、不发布 Git、不猜测最终 SHA。Cursor 已交付的完整 Bundle、MCP/Skill 适配、manifest 文件列表与本地 hash 是这一发布步骤的输入。

### Codex 发布前置清单（不得遗漏）

1. 先审计和提交通过 QC 的应用代码，得到 Bundle 所在的不可变 commit SHA。
2. 使用该 SHA 构造唯一 Bundle 根路径：
   `https://raw.githubusercontent.com/Shak-Zhu/portfolio-governance-app/<SHA>/agent-skills/shak-project-portfolio-governance/`。
3. 由 Codex 更新发布版安装配置/文案，使其只引用上述精确 Bundle 路径，绝不引用整个仓库、`main` 或 pmo 静态 Skill URL。
4. 由 Codex 加入 manifest 六文件的逐项 SHA-256 下载校验与失败清理；完成后再提交/发布最终配置版本。
5. 由 Codex 写入生产 Worker Secret、部署、回读 GitHub raw 链接，并完成真机 Codex/Cursor 安装、Skill 触发和 MCP 一读一写验收。

## 2026-07-30｜Codex 发布验收结论

### 结论

**WP-006 与 WP-006A：PM/QC 通过，已生产发布；待 Human Owner 业务验收。**

### Codex 发布证据

| 项目 | 实际结果 |
|---|---|
| GitHub Bundle 固定来源 | `25cb75c8e2768a54f9ad6c115ab464b3ee3ba906` 下的精确 `agent-skills/shak-project-portfolio-governance/`，不使用 `main`、仓库首页或站点静态副本 |
| 发布集成修复 | `d70caf1 fix: preserve Cursor skill manifest` 已推送；Cursor 安装器保留已校验 manifest |
| Worker 生产版本 | `4150d607-f454-4eec-ad47-f1c39a867d4a`，域名 `https://pmo.pmoforms.com` |
| 网页与安装接口 | 登录成功后 `/api/agent/install` HTTP 200，含 Codex/Cursor/Generic 文案；接口为 `no-store` |
| MCP 生产验证 | 有效 Bearer + 标准 Streamable HTTP Accept：`initialize` HTTP 200；缺失 Bearer：HTTP 401；无网页登录跳转 |
| Codex 一键安装 | 已实际执行；全局 MCP 注册为 enabled/Bearer；6 文件 Bundle 安装并按 manifest 校验 |
| Cursor 一键安装 | 已实际执行；MCP 安全合并、Rule 已安装；manifest 与全部 6 文件 SHA-256 校验通过 |

### 发布后边界

- Bearer Token、登录密码、Session 与 GitHub 凭据均未写入 Git、Skill、manifest、静态文件或本报告。
- Codex Desktop / Cursor 已有进程需要完全重开，才会由各自客户端载入新 MCP 配置；这不是服务端阻塞。
