# PM/QC 报告｜WP-003 原生 MCP 与 Agent 接入中心

- 审查日期：2026-07-29
- Coder 报告状态：`implemented, pending PM/QC review`
- PM/QC 结论：**L3 / rework required**

## 2026-07-30 架构修订

Human Owner 已将生产认证明确改为：单用户 Bearer Token + Cloudflare Access 网页登录。故上表第 2 项关于 OAuth provider、scope 与 OAuth 客户端验证的返工要求**作废**。

新的 P0 验收替代项：

1. `/mcp` 仅校验 Worker Secret `SHAK_PMO_MCP_TOKEN` 的 Bearer 值；缺失/错误为 `401`。
2. 生产网页受 Cloudflare Access 保护；登录后的动态安装接口才返回含真实 token 的复制文案。不得让 token 进入静态资产、Git、Skill、manifest、日志或公开 API。
3. `/mcp` 设为 Access Bypass 路径，仍由 Bearer 完成认证；Skill 静态读取路径不含 secret。
4. 保留第 1、3、4、5 项质量要求，但把 OAuth 真机测试替换为 Bearer Token 的 Codex/Cursor 真机安装、`tools/list`、一读一写验证。

## 五层验收状态

| 层级 | 状态 |
|---|---|
| Coder Implemented | 是（声明） |
| PM Reviewed | 是 |
| PM/QC Accepted | 否 |
| Human Accepted | 否 |
| Product Done | 否 |

## 核心不通过项

| # | 级别 | 发现 | 独立证据 | 必须返工 |
|---:|---|---|---|---|
| 1 | P0 | 未使用官方 MCP Server handler / SDK | `npm ls @modelcontextprotocol/server @modelcontextprotocol/sdk agents @cloudflare/workers-oauth-provider` 返回 empty；`src/mcp/server.ts` 手写 JSON-RPC、协议分发与 Streamable HTTP 行为。 | 使用当前官方 `agents/mcp/server` 的 `createMcpHandler` 与官方 MCP Server 包替代手写协议层；不得自行维护 MCP session/transport 兼容逻辑。 |
| 2 | P0 | OAuth 生产路径不是可部署的标准 OAuth provider | `src/mcp/auth.ts` 仅以 `MCP_OAUTH_ISSUER`/`MCP_OAUTH_JWKS_URL`验 JWT；未实现受支持的生产 authorize/token/client registration provider，也未接入 Cloudflare Access OAuth Provider。 | 按 Cloudflare Access OAuth 或 `@cloudflare/workers-oauth-provider` 的标准模式实现生产授权链路与 resource metadata；保留本地测试能力但不得把自研 dev OAuth 当作生产架构。 |
| 3 | P0 | 强 schema 仅声明、未统一执行 | `TOOLS` 的 `inputSchema` 是普通对象；`dispatchToolCall` 未运行 JSON Schema/Zod validator，未识别字段会被多数 handler 忽略。 | 以官方 SDK + Zod/等价运行时 schema 实际拒绝缺字段、未知字段、错误类型和非法枚举；每个工具验证输入后才进入业务服务。 |
| 4 | P0 | 客户端“一键安装”未完成真机端到端验证 | Coder 报告明确承认 Codex/Cursor 的干净临时配置和交互式 OAuth 未实测。 | 使用干净临时配置真实执行 Codex 安装指令，并在 Cursor 验证安全合并配置、Rule 安装、OAuth 后 tools/list/get_capabilities；记录不含 secret 的证据。 |
| 5 | P1 | 工作包 Read Evidence 路径记录错误 | WP 原路径应为 `pm-ai-reviews/WP-005-TBD规划包与时间轴可靠性-QC.md`，而非 `pm-ai-work-packages/...-QC.md`；此项为 PM 签发路径错误，已更正，不作为 Coder 过失。 | 重读已修正路径，在 RESULT 中更新 Read Evidence。 |

## 范围审计

- 已检查未提交变更：文件位于 WP-003 允许的前端、MCP、Skill/manifest、测试、README、产品文档和工作包范围内；未发现 D1 migration、wrangler、DNS、R2、Git remote 或 PM baseline 被 Coder 修改。
- 未执行生产 deploy；这一点符合工作包要求。
- 当前未进行 lint/build/smoke 的通过判定：P0 协议与认证架构已不满足，必须先返工后再跑完整回归。

## 返工后最低验收门

1. 依赖与源码可证明调用官方 current MCP handler / Server SDK，不保留手写 `src/mcp/server.ts` 作为正式 transport。
2. 生产 OAuth 流与 Cloudflare Access/官方 Provider 的授权端点、token、metadata、scope 有可复现实证。
3. 全工具 schema 运行时强校验；未知参数也必须被拒绝。
4. Codex 与 Cursor 各至少一次干净配置真实安装、OAuth、tools/list、`get_capabilities`、一读一写成功。
5. 修正 Read Evidence 后，lint、unit、build、MCP 集成、既有 API smoke 全部独立回归。
