# 工作包 WP-007A｜Agent Skill 与安装链路一致性修复

## 基本信息

- 项目：Shak 项目组合治理系统
- 工作包编号：WP-007A
- 签发人：Codex（PM / QC）
- 接收人：Cursor（Coder）
- 签发日期：2026-07-30
- 对应需求：REQ-020、REQ-021、REQ-022、REQ-024
- 对应 WBS：3.0、3.0A
- 复杂度：Medium
- 预计 PM-Coder 迭代次数：1–2
- 不确定性：Low
- 主要工作语言：中文

## Required Project Files to Read Before Editing

| 文件 | 阅读原因 | Required / Conditional |
|---|---|---|
| `pm-ai-work-packages/WP-007A-Agent-Skill与安装链路一致性修复.md` | 当前唯一权威工作包、范围与验收门 | Required |
| `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/PM_CURRENT_STATUS.md` | 确认生产已发布、当前仅修复 Agent P0 一致性 | Required |
| `agent-skills/shak-project-portfolio-governance/SKILL.md` | 当前 Agent 行为说明，存在已确认的错误 CLI 指令 | Required |
| `agent-skills/shak-project-portfolio-governance/agent.config.json` | 当前 Bundle 配置，存在已确认的失效 `/agent/...` URL | Required |
| `src/index.ts` | 动态安装文案、固定 GitHub Bundle 分发与 Bearer 边界 | Required |
| `src/mcp/config.ts` | 配置解析与单一来源边界 | Required |
| `scripts/real-mcp-test.mjs`、`scripts/mcp-test.mjs` | 现有真实 MCP 验证与 SSE 解析差异 | Required |
| `README.md`、`docs/生产架构.md` | 当前用户说明与生产架构说明 | Required |
| `pm-ai-reviews/WP-006-单用户登录与Bearer-MCP重构-QC.md` | 本工作包必须关闭的审计发现 | Required |

Coder 最终报告必须提供 **Read Evidence**，逐项列出实际读取的上述文件和获得的关键约束。

## 背景

生产 MCP、Bearer 鉴权与网页一键安装已通过运行时验证，但发布后审计发现 Agent 文档漂移：网页动态安装脚本使用 `--bearer-token-env-var`，而固定 GitHub Bundle 内 `SKILL.md`、`agent.config.json`、README 和部分测试仍含旧 `--bearer-token` 或已失效的 `/agent/...` URL。该漂移会让 Agent 或人工按错误指令安装，违反 REQ-020～REQ-024 的 P0 准确性要求。

## 本次目标

使仓库内的 Skill Bundle、使用文档、安装测试和运行时契约对单用户 Bearer 生产架构保持一致；任何 Agent 只能获得一条正确、可验证的 MCP 接入路径。

## scope_in（本次包含范围）

1. 修正 `SKILL.md`：明确 Codex 使用 `launchctl setenv` / `SHAK_PMO_MCP_TOKEN` 与 `codex mcp add ... --bearer-token-env-var SHAK_PMO_MCP_TOKEN`；不得再出现独立的旧 `--bearer-token` 用法。
2. 修正 Bundle 的 `agent.config.json` 及 `src/mcp/config.ts` 契约：不得把运行时或安装流程引向 `https://pmo.pmoforms.com/agent/...`；Bundle 内静态元数据只能使用相对路径或明确的“由生产 `get_capabilities` / 登录后一键文案提供固定 Git commit URL”的机制。
3. 修正 README、`docs/生产架构.md` 与仍面向执行者的当前说明，使其与生产 Bearer 架构和实际 Codex CLI 参数一致。历史工作包/历史 QC/历史 RESULT 保留历史事实，不要求改写。
4. 修复 `scripts/mcp-test.mjs` 对 Streamable HTTP SSE 响应的解析，使其能像 `scripts/real-mcp-test.mjs` 一样读取 JSON 或 SSE；不得只用 `JSON.parse(text)`。
5. 增加自动化校验，至少验证：
   - Bundle 内没有独立旧 `--bearer-token` 命令；
   - Bundle / README 当前指引没有 `pmo.pmoforms.com/agent/` 作为 Skill 下载源；
   - 安装文案含 `--bearer-token-env-var SHAK_PMO_MCP_TOKEN`、固定 Git commit Bundle 根路径和逐文件 SHA-256 校验；
   - `manifest.json` 六个受管文件哈希与实际文件一致。
6. 保持完整 Bundle：`SKILL.md`、`.mdc`、`agent.config.json`、两份 references、`agents/openai.yaml`、`manifest.json`。

## scope_out（本次不包含范围）

- 不导入、删除或修改 D1 中任何业务 Portfolio / 项目 / 步骤数据。
- 不修改数据库 schema、D1 migration、R2 Bucket、备份恢复功能或甘特图业务功能。
- 不修改 Bearer Token、网页登录密码、Session secret、任何 Cloudflare secret、DNS、域名、Cloudflare Access 或 OAuth 配置。
- 不执行 Git commit / push / tag、`wrangler deploy` 或生产安装；这些由 Codex 在 PM/QC 通过后完成。
- 不修改历史工作包、历史 RESULT、历史 QC 中作为事实记录的旧 OAuth / CLI 描述。

## 允许修改的文件

- `agent-skills/shak-project-portfolio-governance/**`
- `src/mcp/config.ts`
- `src/index.ts`（仅在确有必要消除配置漂移或补充可验证安装契约时）
- `scripts/mcp-test.mjs`
- `scripts/real-mcp-test.mjs`
- `scripts/build-skill-manifest.mjs`、`scripts/generate-agent-manifest.mjs`（仅必要时）
- `README.md`
- `docs/生产架构.md`
- `package.json`（仅为新增确定性校验脚本而增加 script 时）
- 新增与本工作包直接相关的测试/校验脚本
- `pm-ai-work-packages/WP-007A-Agent-Skill与安装链路一致性修复-RESULT.md`

## 禁止修改事项

- 不得修改 `pm-ai-memory/`、`PM_CHANGE_LOG.md`、`PM_SCOPE_BASELINE.md`、`PM_REQUIREMENTS_REGISTER.md` 或任何 PM/QC baseline。
- 不得把真实 Token、密码、Cookie、Session、GitHub PAT 写入 Git、测试输出、README、Skill、manifest、脚本或 RESULT。
- 不得退回 OAuth、Access、KV grant、scope 或手写 MCP 协议；正式 MCP 仍为官方 `createMcpHandler` + `McpServer` + Bearer middleware。
- 不得删除、缩减或绕过 31 个 MCP 工具、严格 schema、固定审计 actor 或归档/Stage 保护。
- 不得将 `main`、GitHub 仓库首页、clone URL 或 `pmo.pmoforms.com/agent/...` 作为生产 Skill 安装来源。

## 数据库 / 环境 / 部署限制

- 数据库：禁止写 D1 / R2，禁止执行 remote migration。
- 环境：仅本地验证。
- 部署：禁止执行 `wrangler deploy`、`wrangler secret put`、Git push；由 Codex 负责。

## 验收标准（必须可验证）

1. `SKILL.md` 与 README 中的 Codex 安装指令包含 `--bearer-token-env-var SHAK_PMO_MCP_TOKEN`，且不存在可执行的 `--bearer-token <token>` / `--header` 旧指令。
2. 当前 Bundle 的 `agent.config.json`、Skill、README 和自动化测试中不再把 `/agent/...` 作为生产下载端点；固定 Git commit URL 由生产动态安装文案或 `get_capabilities` 明确提供。
3. `scripts/mcp-test.mjs` 对 `application/json` 和 `text/event-stream` 响应均可解析；其 `tools/list`、`get_capabilities` 断言能读取解析后的 JSON-RPC body。
4. 新增或更新的确定性检查在本地失败时能指出“旧 CLI 参数”“失效 /agent URL”“哈希不匹配”中的具体原因。
5. `npm run lint`、`npm test`、`npm run skill:build`、`npm run test:e2e`、`npm run build` 全部通过；新增检查命令通过。
6. `git diff --check` 无输出；`git diff` 仅涉及本工作包允许修改的文件。
7. `RESULT.md` 使用中文，包含 Read Evidence、修改清单、每条验收标准的命令/输出摘要、未执行的生产动作与原因。最终状态只能为 `implemented, pending PM/QC review`。

## 必须运行的验证命令

```bash
npm run lint
npm test
npm run skill:build
npm run test:e2e
npm run build
git diff --check
```

如新增校验命令，必须一并运行并在 RESULT 中提供结果。

## 依赖

- 前置：WP-006 / WP-006A 已生产发布。
- 后续：Codex PM/QC 通过后，Codex 负责生成最终不可变 Bundle source commit、固定发布指针、重新部署生产安装文案并执行 Codex/Cursor 真机安装验收。

## 工作语言要求与完成后操作

- 工作包主体、代码注释以外的报告、RESULT 主要使用中文。
- Coder 不得宣称 accepted / complete / MVP done / ready；最终状态只能为 **implemented, pending PM/QC review**。
- 完成后在当前对话提交完整报告，并写入 `pm-ai-work-packages/WP-007A-Agent-Skill与安装链路一致性修复-RESULT.md`。
