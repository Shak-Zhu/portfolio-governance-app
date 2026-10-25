# 从 GitHub 完整复用本系统

更新：2026-10-25。适用于 Codex、Cursor、SmartWork 或其它能操作 Git、Node.js 和 Cloudflare 的 Agent。

仓库：<https://github.com/Shak-Zhu/portfolio-governance-app>。

## 1. 先区分两种使用方式

**只想让另一个 Agent 维护现有系统**：无需部署网站。登录 <https://pmo.pmoforms.com> 的「Agent 接入」，复制对应客户端的安装或更新指令。它同时配置 MCP 和从固定 Git commit 下载完整 Skill。GitHub 中有使用规则和代码，授权来自系统管理员提供的 Bearer Token。

**想重新搭建一个独立系统**：按本文操作。新实例拥有自己的 Worker、主 D1、隔离恢复 D1、R2、网页登录凭据和 MCP Token。前端、后端、MCP 与备份由同一个 Worker 提供，无需额外 MCP 服务器。

源代码足以重建程序；Git 不保存线上业务数据、历史备份或真实凭据。新实例默认空库。`drizzle/seed.sql` 是旧开发样例，不能当作最新项目主数据导入。

## 2. 在全新目录安装和本地启动

需要 Git、Node.js 22 LTS（兼容性验证也使用本机 Node.js 26）、npm，以及生产部署所需的 Cloudflare 账号。保留仓库 lockfile，先不要升级 SDK/Wrangler 或更改 compatibility date。

```bash
git clone https://github.com/Shak-Zhu/portfolio-governance-app.git
cd portfolio-governance-app
npm ci
cp .dev.vars.example .dev.vars
```

`.dev.vars.example` 只含假值。填写自己的本地邮箱、密码，以及随机 Session Secret 和 MCP Token；可以在本地用 `openssl rand -hex 32` 生成随机值。不要在聊天或 Git 中输出真实值。若仅做隔离自动化验收，模板假值足够。

```bash
# 只操作本地模拟数据库；不连接生产 D1。
npx wrangler d1 migrations apply DB --local
npx wrangler d1 migrations apply RESTORE_DRILL_DB --local
npm run dev -- --port 8787
```

打开 `http://localhost:8787/login`，使用 `.dev.vars` 中的邮箱和密码登录。空库可在页面创建组合、Stage、父子项目、步骤和关联资料。前端静态资源由 Worker 的 ASSETS 绑定提供，不应直接打开 HTML 文件作为正式应用。

本地「Agent 接入」在没有固定 Skill 发布 SHA 时返回 503 是明确的配置状态；先完成第 5 节再验证该入口。`/mcp` 的 Bearer 验证和业务工具不依赖网页 Cookie。

## 3. 基础验证

```bash
npm run lint
npm test
node scripts/test-report-filter.mjs
node scripts/validate-skill-consistency.mjs
npm run test:e2e
npm run test:scheduled
npm run build
```

`test:e2e` 和 `test:scheduled` 从本地 `.dev.vars` 读取测试凭据，在独立 Miniflare/workerd 中创建隔离 D1/R2；不用先启动 dev server。`test:scheduled` 直接调用导出的 scheduled handler，并验证写入隔离 R2 的内容，不代表已验证 Cloudflare 线上调度。

`npm run build` 是 dry-run。检查现有 manifest 时运行一致性校验即可；仅在确实修改 Skill 内容/配置后运行 `npm run skill:build`，因为它会更新生成时间。

## 4. 为独立实例创建 Cloudflare 资源

先 Fork 到自己的 GitHub 账号，或确认仍使用公开原仓库的 Skill。新域名意味着 Skill 的端点也需要更改，因此建议部署新实例时使用自己的 Fork。

```bash
cp wrangler.reuse.example.toml wrangler.reuse.toml
npx wrangler login
npx wrangler whoami
npx wrangler d1 create shak-pmo-reuse-db --config wrangler.reuse.toml
npx wrangler d1 create shak-pmo-reuse-drill --config wrangler.reuse.toml
npx wrangler r2 bucket create shak-pmo-reuse-backups --config wrangler.reuse.toml
```

把创建结果中的两个 D1 ID 填入 `wrangler.reuse.toml` 对应位置。若修改资源名，同步更新模板里的名称。主库和演练库必须是不同 ID。需要在账号中开通 R2；是否免费取决于实际用量和当前 Cloudflare 定价，GitHub 不附带云资源额度。

初次可用 Cloudflare 的 `workers.dev` 域名，或在 Worker Dashboard → Settings → Domains & Routes 添加自己的 Custom Domain。先确定最终 HTTPS Origin，再继续下一节。原 `wrangler.toml` 包含现有生产 ID，不能作为新实例远程部署配置。

## 5. 同步新实例的 MCP、Skill 和发布源

当前版本保留了原实例的明确域名配置。Agent 必须逐项修改下表；无需改 MCP 工具的 schema、数据结构或鉴权方式。

| 文件 | 新实例需修改的值 |
|---|---|
| `src/index.ts` | `SKILL_GITHUB_REPO` 改为自己的 `OWNER/REPO`；`allowedHostnames`、`allowedOriginHostnames` 加入新域名（只写 hostname，不带协议或路径），保留 localhost / 127.0.0.1 |
| `agent-skills/shak-project-portfolio-governance/agent.config.json` | `productionBaseUrl`、`mcpUrl` 分别为新 HTTPS Origin 和其 `/mcp` |
| `agent-skills/shak-project-portfolio-governance/SKILL.md` | frontmatter 及正文中的 MCP URL |
| `agent-skills/shak-project-portfolio-governance/shak-project-portfolio-governance.mdc` | MCP URL |
| `agent-skills/shak-project-portfolio-governance/references/governance-rules.md` | 排障段的 MCP URL |
| `agent-skills/shak-project-portfolio-governance/agents/openai.yaml` | `mcp.url` |
| `scripts/generate-agent-manifest.mjs` | `productionBaseUrl` 和 `installNotes.general` 中的原实例端点 |
| `public/index.html` | Agent 接入页面初始 MCP URL 文案（运行时仍以配置接口为准） |
| `scripts/real-mcp-test.mjs` | `E2E_BUNDLE_ROOT` 中的 GitHub owner/repo 与新 `SKILL_GITHUB_REPO` 一致；fixture SHA 是本地测试数据，无需下载 |

```bash
npm run skill:build
node scripts/validate-skill-consistency.mjs
npm run test:e2e
npm run build
```

提交和推送自己的源码（包括重新生成的 manifest），取得**已经存在于远端的 40 位 commit SHA**。网页安装器使用 `https://raw.githubusercontent.com/OWNER/REPO/<固定SHA>/agent-skills/shak-project-portfolio-governance/manifest.json`。仓库需要允许安装客户端读取：当前无 GitHub PAT 的安装器要求该 Bundle 在公开仓库可访问；私有 Fork 不能直接沿用公开 raw 下载流程。

manifest 含六个内容文件的 SHA-256 和字节数，不对自身计算哈希；完整安装包是这六项再加 manifest，共七项。安装前逐文件验证哈希与字节数，不能以仓库首页代替 Skill 目录。

## 6. 初始化新库、配置 Secrets、部署

以下命令必须始终带新实例配置。Wrangler 的 migration 记录负责顺序和幂等，不能手工反复执行 `0002` 的 ALTER TABLE。

```bash
npx wrangler d1 migrations apply DB --remote --config wrangler.reuse.toml
npx wrangler d1 migrations apply RESTORE_DRILL_DB --remote --config wrangler.reuse.toml
npx wrangler deploy --dry-run --config wrangler.reuse.toml
npx wrangler deploy --keep-vars --config wrangler.reuse.toml

# 每条交互输入该新实例自己的值。此时不要把应用分享给其他人。
npx wrangler secret put SHAK_PMO_WEB_LOGIN_EMAIL --config wrangler.reuse.toml
npx wrangler secret put SHAK_PMO_WEB_LOGIN_PASSWORD --config wrangler.reuse.toml
npx wrangler secret put SHAK_PMO_SESSION_SECRET --config wrangler.reuse.toml
npx wrangler secret put SHAK_PMO_MCP_TOKEN --config wrangler.reuse.toml
npx wrangler secret put SHAK_PMO_SKILL_SOURCE_COMMIT --config wrangler.reuse.toml
```

最后一项输入前面推送的固定 commit SHA；其余为自己的凭据。新实例首次设置 Token 后长期使用，源码重部署无需重新签发 Token。不要为复制系统而轮换原实例 Token。首次部署后 Secrets 未齐时，网页登录不可用、MCP 返回 401；全部配置完成再开放使用。

## 7. 发布后的验收与 Agent 安装

| 检查 | 预期结果 |
|---|---|
| `GET /api/health` | HTTP 200 JSON |
| 无 Cookie `GET /`、`GET /index.html` | 302 到登录页 |
| 无 Cookie 访问业务 API | 401 JSON |
| 缺失/错误 Bearer 调用 `/mcp` | 401，不跳网页登录 |
| 正确 Bearer `initialize`、`tools/list` | 200；响应支持 SSE/JSON；恰好 31 个工具 |
| `get_capabilities` | Bearer 模式；7 项 Bundle 文件；固定 SHA 下的正确 repo/manifest URL |
| 登录后「Agent 接入」 | Codex / Cursor / 通用安装文案使用新域名与相同固定 Bundle 根路径 |
| 安装 Skill | 下载 manifest + 六个内容文件，SHA-256/bytes 全部一致 |
| 创建组合/父子项目/步骤后刷新 | 数据仍存在，日/周/月和 TBD 可显示 |
| 汇报筛选 | 只显示选中顶级分支；全部显示可恢复；只影响当前浏览器 |
| 备份/恢复演练 | 手动备份写 R2；恢复目标固定隔离库；主库不被覆盖 |
| Cloudflare cron | Dashboard 中存在 `0 3 * * *`，后续确认 Scheduled Events 与 R2 产物 |

在网页「Agent 接入」复制安装指令给目标 Agent。Codex 按环境变量引用 Bearer，Cursor 按生成配置接入；保留其它 MCP 配置。新 Agent 先调用 `get_capabilities`、`list_portfolios`，成功后才维护业务数据。

## 8. 数据迁移与后续维护

- GitHub 保存程序、迁移、规则和部署方法，不保存当前生产项目行；迁移业务数据是单独任务。
- 复制已有数据时，由管理员导出并导入**自己的新主库**，或通过两个系统各自 MCP 读取后逐项创建并记录 ID 映射。不要把数据库导出提交到公开 GitHub。
- 网页恢复功能固定写入 `RESTORE_DRILL_DB`，不能用它直接覆盖主库。演练库验证后，实际灾难恢复另由管理员按明确目标执行。
- 重部署使用 `--keep-vars`，保留现有 Secrets；升级数据库只应用尚未记录的 migrations。
- 开发新 MCP 功能时同步工具合同、Skill/Rule、manifest 和回归；发布后固定到新的远端 SHA，再更新实例的 `SHAK_PMO_SKILL_SOURCE_COMMIT`。

## 可直接交给其它 Agent 的指令

```text
请从 https://github.com/Shak-Zhu/portfolio-governance-app 复用「Shak 项目组合治理系统」。
先读取根目录 AGENTS.md 和 docs/REBUILD.md，再克隆全部源码。
目标是完整的前端 + Worker 后端 + D1 + R2 + 原生 Bearer MCP（31 工具）+ 完整 Skill Bundle。
先在隔离本地环境 npm ci、应用两份 migration 并完成回归；然后按重建手册创建独立资源，使用 wrangler.reuse.toml 部署到我的账号和域名。
同步新实例域名、MCP 主机白名单、GitHub Skill 发布仓库与 manifest；必须使用公开可读取的固定 commit 链接。
最后验证网页登录、MCP 401/200、31 工具发现、Skill 全包哈希、项目持久化、甘特日周月/TBD/汇报筛选和隔离备份恢复。
我会通过本地凭据配置或登录授权提供部署权限；不要使用原实例的资源或凭据。
请实际完成搭建并给出访问地址和验证结果；缺少必要账号授权时明确列出具体缺项。
```
