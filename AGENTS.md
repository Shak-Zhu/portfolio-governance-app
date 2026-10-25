# Agent 入口｜Shak 项目组合治理系统

本仓库包含正式前端、Worker 后端、31 个原生 MCP 工具、完整 Agent Skill Bundle、两份数据库迁移、备份恢复实现与回归脚本。系统正式名称固定为「Shak 项目组合治理系统」。

## 根据用户目标选择入口

- **在已有系统里维护项目**：先读 `agent-skills/shak-project-portfolio-governance/SKILL.md` 及其 references，通过官方 Bearer MCP 操作并回读。仓库本身不携带授权令牌。
- **从零重建独立系统**：完整阅读 `docs/REBUILD.md`，使用 `wrangler.reuse.example.toml` 创建独立配置；先在空目录验证，再创建新资源和部署。
- **开发或维护本程序**：阅读 `README.md`、`docs/生产架构.md` 和当前任务相关代码。历史工作包是过程记录；与当前代码冲突时，以已发布实现和最新重建手册为准。

## 文件导航

| 能力 | 权威路径 |
|---|---|
| 页面、项目树、日/周/月甘特、汇报筛选 | `public/`（含 `filter-core.js`） |
| Worker 路由、网页登录、Bearer MCP | `src/index.ts`、`src/auth.ts` |
| 强类型 MCP 工具与配置 | `src/mcp/server-sdk.ts`、`src/mcp/config.ts` |
| 业务校验、审计、甘特、备份恢复 | `src/api/`、`src/lib/` |
| 数据结构 | `migrations/`（按顺序应用全部文件） |
| Skill / Rule / 工具合同 / 治理规则 / 哈希清单 | `agent-skills/shak-project-portfolio-governance/` |
| 全新环境复用、部署和验收 | `docs/REBUILD.md` |
| 本次源码发布记录 | `docs/REUSE-RELEASE.md` |

## 执行规则

1. 查看 Git 状态，保留用户已有修改；依赖使用 `npm ci` 和已提交 lockfile。
2. 本地与新实例使用自己的凭据；真实密码、Bearer Token、Cookie、数据库导出和 R2 备份不进入 Git。
3. 现有 `wrangler.toml` 指向 Shak 生产实例。新实例所有 Wrangler 命令必须显式使用独立配置。
4. 普通项目维护走 MCP；部署时只有管理员操作 migrations、Secrets、D1/R2 资源。
5. `/mcp` 只接受 Bearer Token，不能被网页登录重定向；审计身份由服务端固定。
6. Skill Bundle 的 manifest 需与内容文件哈希一致，包含六个内容文件；安装另保存 manifest，共七个物理文件。修改 Bundle 后重新生成清单，并发布到可访问的固定 Git commit。
7. 基础验证：`npm run lint`、`npm test`、`node scripts/test-report-filter.mjs`、`node scripts/validate-skill-consistency.mjs`、`npm run test:e2e`、`npm run test:scheduled`、`npm run build`。E2E 使用隔离 Miniflare，先按手册准备本地 `.dev.vars`。
8. 部署新域名前，必须同时更改 MCP 主机白名单、Agent 配置和 Skill 中的端点；仅绑定 DNS 不足以迁移 MCP。

已安装的项目治理 Skill 约束的是业务数据维护，不妨碍用户明确授权的源码开发和基础设施部署。
