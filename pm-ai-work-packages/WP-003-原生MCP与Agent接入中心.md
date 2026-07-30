# 工作包 WP-003｜原生认证 MCP、版本化 Agent Skill 与一键接入中心

## 基本信息

- 项目：Shak 项目组合治理系统
- 工作包编号：WP-003
- 签发人：Codex（PM / QC）
- 接收人：Cursor
- 签发日期：2026-07-29
- 对应需求：REQ-013、REQ-014、REQ-020、REQ-021、REQ-022
- 优先级：**P0**
- 状态：已签发，待开发

> **架构修订 v3（2026-07-30，Human Owner 决定）**  
> 本节覆盖本文中所有与 OAuth、scope、Cloudflare Access、复制文案不得含 token 相冲突的旧表述。正式方案改为单用户 Bearer Token + 系统原生邮箱/密码网页登录。此前 OAuth/Access 返工不再执行。

## v3 正式认证与登录方案（唯一有效）

1. `POST /mcp` 仅接受 `Authorization: Bearer <SHAK_PMO_MCP_TOKEN>`；缺失或不匹配一律返回 `401`。
2. Token 仅保存为 Cloudflare Worker Secret `SHAK_PMO_MCP_TOKEN`，服务端常量时间比对；不写入 D1、R2、Git、静态 `public/` 文件、Skill、manifest、测试输出或日志。
3. 生产网页实现系统原生登录页：仅允许预设的 Human Owner 邮箱与密码。邮箱、密码、会话签名密钥均为 Cloudflare Worker Secret；不写入 D1、R2、Git、网页、Skill、manifest、测试输出或日志。
   - Secret 名称固定为：`SHAK_PMO_MCP_TOKEN`、`SHAK_PMO_WEB_LOGIN_EMAIL`、`SHAK_PMO_WEB_LOGIN_PASSWORD`、`SHAK_PMO_SESSION_SECRET`。
4. `/mcp` 不依赖网页 Session，也不经过网页登录中间件；它的唯一认证边界是 Bearer Token。`/agent/skills/*` 可作为公开只读路径，仅提供不含 secret 的版本化 Skill。
5. 登录后的网页从受 Session 保护的动态接口 `GET /api/agent/install` 获取三段安装文案；该接口运行时读取 secret 并把真实 token 直接嵌入复制文案。不得把 token 预渲染进 HTML/JS/CSS，也不得通过 `GET /api/agent/config`、manifest 或其他公开接口返回。
6. 所有 MCP 工具均为全权限；审计 actor 由服务端固定为 `mcp:shak-pmo-owner`，忽略并拒绝任何客户端传入的 actor/权限字段。多人、细分权限和 OAuth 留待未来独立变更。
7. 页面须明确显示“登录后复制的指令含个人访问 Token，请仅在本人设备执行”。不增加额外的 token 粘贴、环境变量、OAuth 或 scope 步骤。
8. **上线阻断验收**：无浏览器 Cookie 的标准 MCP Client 向 `/mcp` 发 `initialize`：正确 Bearer 必须获得 MCP JSON 响应（非 `302`、非网页登录 HTML）；缺失/错误 Bearer 必须为 Worker 返回的 `401` JSON。网页根路径在未登录状态则必须返回系统登录页。
9. 登录实现必须使用 `HttpOnly`、`Secure`、`SameSite=Strict` 的签名 Session Cookie；登录失败只返回统一错误提示，不泄漏账号或密码匹配情况。提供退出登录；所有受保护网页与 `/api/agent/install` 在无效 Session 下为 `401` 或跳转登录页。

## Required Project Files to Read Before Editing

| 文件 | 为什么必须阅读 | 类型 |
|---|---|---|
| `pm-ai-work-packages/WP-003-原生MCP与Agent接入中心.md` | 本工作包的唯一范围、验收与禁止事项 | Required |
| `pm-ai-reviews/WP-005-TBD规划包与时间轴可靠性-QC.md` | 了解当前生产基线、既有 UI 与质量门 | Required |
| `docs/生产架构.md` | D1/R2/Worker 与安全边界 | Required |
| `docs/需求登记册.md` | REQ-013/014/020/021/022 的验收口径 | Required |
| `src/index.ts`、`src/api/*.ts`、`src/lib/*.ts` | 复用既有业务服务、校验与审计，避免另写一套规则 | Required |
| `public/index.html`、`public/app.js`、`public/styles.css` | 接入中心与现有页面风格、状态加载方式 | Required |
| `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/PM_CURRENT_STATUS.md` | 了解当前生产状态与角色边界 | Required |
| `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/PM_SCOPE_BASELINE.md` | 确认 P0 范围与未认证写入禁止项 | Required |

结果报告必须包含 Read Evidence，逐项说明已阅读文件及关键结论。

## 目标

将系统变成 Agent 可原生、准确、稳定维护的产品：网页提供一次复制的安装指令；Agent 安装正式 MCP 与匹配 Skill 后，能够通过有认证、有审计、受业务规则保护的工具完成全部当前治理功能。

这不是浏览器自动化、REST 文档、临时 token 或只读 Demo。必须是正式远程 MCP。

## scope_in

### A. 正式认证 MCP

1. 在现有 Worker 中实现标准 Streamable HTTP `https://pmo.pmoforms.com/mcp`。
2. 使用官方当前 MCP handler / SDK；禁止过时的 `McpAgent` 新实现与任何手写 MCP JSON-RPC transport。
3. 认证与授权必须在 MCP 请求前完成。所有未认证请求与写操作必须拒绝；不得接受客户端 `actor` 字段伪造审计身份。
4. 工具按强 schema 校验、明确中文描述和稳定 machine-readable 结果；禁止“任意 SQL”“任意 API 请求”或其他万能绕过工具。
5. 所有写工具必须调用当前同一业务服务/校验逻辑，并写入 `audit_events`；服务端固定 actor 为 `mcp:shak-pmo-owner`。

### B. 全量工具覆盖矩阵

必须覆盖下列现有业务能力。可按语义合并少量工具，但不能遗漏能力，也不能以自由文本或 SQL 替代强类型参数。

| 领域 | 必须能力 |
|---|---|
| 组合 | list / get / create / update / delete |
| 项目与层级 | list / get / create / update / delete；维护 parent；complete；顶级项目整体 archive |
| 步骤与 TBD | list / create / update / delete；支持日期、状态、TBD ↔ Plan；必须保留既有日期校验与甘特语义 |
| Stage | list / create / update / delete；仍阻止删除被任何项目（含已归档）使用的 Stage |
| 关联资料 | list / create / update / delete；仅允许 `http(s)` URL |
| 甘特 | 读取日 / 周 / 月视图；返回 timeline、bars 与未排期工作包分组 |
| 审计与归档 | 读取组合审计、对象审计与归档项目；归档仍受后代完成规则约束 |
| 发现与健康 | `get_capabilities`（版本、Skill manifest URL、工具版本、服务健康） |

每个工具的输入参数、输出示例、权限 scope、业务副作用必须在 Skill 中明确。写工具不得通过“确认一下？”等不可机器化的对话替代校验；使用 MCP 客户端标准 tool approval 即可。

### C. Bearer Token 与系统网页登录

1. 使用官方 MCP handler / SDK 提供 Streamable HTTP MCP；在该 handler 之前进行 Bearer 校验，不得手写 MCP JSON-RPC transport。
2. Bearer 值只从 Worker Secret `SHAK_PMO_MCP_TOKEN` 读取；所有认证通过的调用拥有全量工具权限，不实现 OAuth、scope、token 刷新或动态注册。
3. 原生登录中间件只保护网页及受保护的动态安装接口；`/mcp` 必须明确绕过该中间件，仍只由 Bearer 检查认证。
4. `GET /api/agent/install` 只可在系统登录后调用；它运行时生成含 token 的三段复制文案。任何静态/公开资产不得包含 token。
5. 前端未配置安装接口或未登录时，应显示“请先登录后获取 Agent 安装指令”。

### D. Agent 接入中心（网页）

1. 在现有网页新增「Agent 接入中心」入口，至少提供 Codex、Cursor、通用 MCP Client 三个卡片。
2. 每张卡必须只有一个清晰的“一键复制安装指令”按钮。复制内容为完整、可执行、中文说明的指令，不是半截 JSON。
3. 指令必须：
   - 使用正式 `https://pmo.pmoforms.com/mcp`，不使用 localhost、workers.dev 临时 URL、D1 或私有 REST endpoint；
   - 安装对应 Skill / Rule，下载前读取 manifest 并校验 SHA-256；
   - 合并而非覆盖已有 Codex/Cursor MCP 配置；
   - 配置 MCP 名称固定为 `shak-project-portfolio-governance`；
   - 直接包含登录后由服务端返回的 Bearer Token，不要求用户额外设置环境变量或完成 OAuth；
   - 明确该文案仅供当前 Human Owner 的个人设备使用；
   - 包含安装后工具发现与 Skill 版本核验步骤；
   - 失败时输出可诊断错误，不静默成功。
4. Codex 安装指令必须使用当前可验证 CLI 形式，并直接传入 Bearer 值：`codex mcp add shak-project-portfolio-governance --url https://pmo.pmoforms.com/mcp --bearer-token <TOKEN>`；随后验证 tools/list。
5. Cursor 安装指令必须安全合并 `~/.cursor/mcp.json`，并安装正式 `.cursor/rules/shak-project-portfolio-governance.mdc`；不得假称 Cursor 原生读取 Codex `SKILL.md`。
6. 所有复制内容、MCP URL、manifest URL、版本号只能来自单一配置源，防止网页、Skill、服务漂移。

### E. 版本化 Agent Skill

1. Git 内保存权威源：
   - `agent-skills/shak-project-portfolio-governance/SKILL.md`（Codex）
   - `agent-skills/shak-project-portfolio-governance/shak-project-portfolio-governance.mdc`（Cursor Rule）
   - `agent-skills/shak-project-portfolio-governance/manifest.json`
2. 构建/发布时作为公开只读静态资产提供：
   - `/agent/skills/shak-project-portfolio-governance/SKILL.md`
   - `/agent/skills/shak-project-portfolio-governance/shak-project-portfolio-governance.mdc`
   - `/agent/manifest.json`
3. manifest 至少包含 `skillVersion`、`mcpUrl`、每份文件 URL、SHA-256、工具协议版本、生成时间；不得包含 token。
4. Skill 必须写明：系统对象模型、全量工具矩阵、写入前读取与确认规则、父子归档、Stage 删除、URL、TBD/日期、审计、错误恢复、日/周/月甘特查询，以及可复制的安全工作流。
5. Skill 必须禁止 Agent 绕过 MCP 直接写 D1、调用私有 REST 写接口、猜测 ID、编造业务时间或宣称未验证的完成状态。

### F. 测试、文档与可验证性

1. 单元与集成测试直接驱动真实 MCP handler；验证 initialize、tools/list 以及全量工具矩阵。
2. 每个写领域至少验证一次成功写入、一次 schema/业务规则拒绝、审计 actor 来自认证上下文而非调用参数。
3. 验证缺失/错误 Bearer 为 401，正确 Bearer 可调用全量工具，archive 仍受后代完成规则限制。
3a. 通过 `curl`/MCP Inspector 的无 Cookie 请求分别验证：`/` 返回系统登录页，`/mcp` 不被网页登录拦截且不会返回 302 或 HTML；仅由 Bearer 决定 401/成功。
4. 使用 MCP Inspector 或等价标准客户端完成 Bearer + tools/list + 至少一读一写的端到端证据。
5. 对 Codex 指令进行干净临时配置测试：不覆盖已有配置，`codex mcp list` 可见服务器，Bearer 后 `get_capabilities` 和一个只读工具成功。
6. 对 Cursor 配置做 JSON 合并与 `.mdc` 格式测试；不得将 token 写入 Git、静态资源、日志或结果报告。
7. README 新增“Agent 接入中心”、Bearer Token、系统登录、Skill 更新、故障排查和安全边界说明。

## scope_out

- 不执行 `wrangler deploy`，不创建或修改 Cloudflare Access、Zero Trust、KV、D1、R2、DNS、域名、secret、Git remote。
- 不执行真实生产 Worker Secret 写入；这些由 Codex 在 PM/QC 通过后单独完成。
- 不改变现有数据 schema，除非系统 Session 的官方实现强制要求；如必须新增 schema/migration，先停止并给 PM 具体影响说明。
- 不实现 R2 备份、Cooper 同步、成本管理或无关 UI 重构。
- 不删除或弱化既有 REST API 与网页功能。

## 验收标准

1. 生产代码可在 `/mcp` 以 Streamable HTTP 提供 MCP；缺失或错误 Bearer 为 401，绝不返回成功。
2. tools/list 能发现覆盖矩阵中所有能力；每项参数强类型、中文描述、无自由 SQL/万能执行工具。
3. Agent 通过授权后的 MCP 调用，对项目、步骤、Stage、链接、归档的校验行为与网页相同，且审计 actor 为认证身份。
4. Access 登录后，网站「Agent 接入中心」可一键复制 Codex、Cursor、通用三段完整指令；指令直接含 Bearer Token，指向唯一生产 MCP 与 manifest，且安全合并本地配置。
5. Codex Skill 与 Cursor Rule 均由 Git 权威源和公开静态文件提供，manifest SHA-256 可验证；内容准确覆盖工具矩阵与业务规则。
6. 通过 lint、unit、MCP 集成、Bearer 拒绝/授权、MCP Inspector、静态资源、既有 API smoke 回归；提供逐项真实证据。

## 禁止事项

- 不得把 token 写入代码、静态网页、Git、Skill、manifest、测试输出或结果报告；仅允许 Access 保护的动态安装接口将 token 放入复制文案。
- 不得使用浏览器 DOM 自动化、D1 直写或私有 REST endpoint 作为 Agent 的正式维护路径。
- 不得只做只读 MCP、半截安装片段或手工复制 JSON 的伪“一键安装”。
- 不得声称已部署、已配置生产 Worker Secret、已完成生产登录验证、已被 Human Owner 接受。

## 完成后提交

1. 新增 `pm-ai-work-packages/WP-003-原生MCP与Agent接入中心-RESULT.md`。
2. 结果必须包含 Read Evidence、完整工具矩阵、认证设计、修改文件清单、每条验收条件的真实命令/响应证据、未配置生产 Access 的明确边界。
3. 最终状态只能写：`implemented, pending PM/QC review`。
