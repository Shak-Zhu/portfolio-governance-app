# GitHub 完整复用发布记录

日期：2026-10-25。

## 用户授权与交付范围

Human Owner 要求将当前系统的前端、后端、原生 MCP、配套 Skill 和相关内容完整发布到 GitHub，使其它 Agent 能据仓库重新搭建。已有程序基线为 `d43b48e`（WP-011 已发布）。本次以当前程序建立可复用的源码快照，增加独立重建文档、配置模板与 Agent 入口；未修改业务程序、MCP 工具或 Skill 内容。

## 完整资产

| 资产 | 仓库内路径 |
|---|---|
| 正式前端，包括项目树、日周月甘特、TBD 与汇报筛选 | `public/` |
| Worker 路由、网页登录、原生 Bearer MCP | `src/index.ts`、`src/auth.ts`、`src/mcp/` |
| 业务服务、审计、甘特计算、备份恢复 | `src/api/`、`src/lib/` |
| 完整 Skill 与 Cursor Rule、工具合同、治理规则、Agent 元数据和 manifest | `agent-skills/shak-project-portfolio-governance/`（7 个物理文件） |
| D1 迁移、旧开发样例 | `migrations/`、`drizzle/seed.sql`（样例非生产数据） |
| 固定依赖与构建配置 | `package.json`、`package-lock.json`、`tsconfig.json`、`wrangler.toml` |
| 全新实例模板与本地假凭据 | `wrangler.reuse.example.toml`、`.dev.vars.example` |
| Agent 统一入口与重建手册 | `AGENTS.md`、`docs/REBUILD.md` |
| 项目章程、架构、需求、工作包和审查历史 | `docs/`、`pm-ai-work-packages/`、`pm-ai-reviews/` |

生产项目数据、R2 备份、密码、Token、Cookie 和本机缓存不属于源码包。项目数据库复制需单独执行数据迁移。

## 独立复用验证

从 Git 暂存树导出至全新临时目录 `/tmp/shak-pmo-rebuild-j1MkCc`，重新执行 `npm ci`，仅从随仓库提交的 `.dev.vars.example` 复制假凭据。未复用原目录的 node_modules、真实 `.dev.vars`、数据库或 Wrangler 状态。

环境：Node.js `26.5.0`、npm `11.17.0`、lockfile 中 Wrangler `3.114.17`。

| 验证 | 实测结果 |
|---|---|
| `npm ci --no-audit --no-fund` | 389 个依赖安装成功 |
| `npm run lint` | exit 0 |
| `npm test` | 13/13 |
| `node scripts/test-report-filter.mjs` | 54/54 |
| `node scripts/validate-skill-consistency.mjs` | 24/24 |
| `npm run test:e2e` | 60/60，包含 31 工具与六表隔离恢复验证 |
| `npm run test:scheduled` | 9/9，直接调用 scheduled handler 并验证隔离 R2 产物 |
| `npm run build` | dry-run exit 0 |
| 主 D1 与隔离 D1 本地 migrations 各连续执行两次 | 首次两份迁移成功，二次均无待执行迁移 |
| 待发布文本凭据扫描 | 未匹配本机真实凭据或 GitHub Token / private key 特征 |

说明：npm/Wrangler 输出了既有依赖弃用与版本更新提示；本次为保留已验证程序，未升级依赖。此记录不宣称已完成依赖安全升级或新 Cloudflare 账号的线上部署。

## 发布约定

- 仓库：`https://github.com/Shak-Zhu/portfolio-governance-app`（当前为公开仓库）。
- 本次固定源码快照使用 Git tag `reuse-2026-10-25`。Skill 安装时以该 tag 对应的 40 位 commit SHA 生成精确 raw 文件链接，仍按 manifest 校验。
- 线上安装接口当前的固定 Skill 指针是较早的 `d1b253dea36b7c1736597ed0bf4e4b4c3ec4f3d0`。当前源码的 Skill 更新了 Codex 按需注册/更新说明，对应 manifest 已同步。本次源码发布不改线上 Worker 或 Secret；从本次仓库重建时固定到新发布 commit。
- 所有新实例必须使用自己的云资源、域名和凭据，并按手册同步主机白名单与 Skill 端点。
