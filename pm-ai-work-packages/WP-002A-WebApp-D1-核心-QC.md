# WP-002A｜PM/QC 验收记录

## 基本信息

| 字段 | 内容 |
|---|---|
| 工作包 | WP-002A｜Web App 与 D1 核心 |
| 验收人 | Codex（PM / QC） |
| 验收日期 | 2026-07-29 |
| 结论 | **L3：返工 required，未接受** |

## 独立验证结果

| 验证项 | 结果 | 证据 |
|---|---|---|
| 静态检查 | 通过 | `npm run lint` 退出码 0。 |
| 单元测试 | 通过但覆盖不足 | `npm test` 为 9/9；测试文件复制了部分逻辑，未覆盖真实 HTTP 路由、关联资料、Stage 改名迁移或前端步骤编辑。 |
| 生产 dry-run | 通过，未构成部署验收 | `npm run build` 退出码 0；D1 binding 仍显示 `${D1_DATABASE_ID}`。 |
| 标准 migration | **失败** | `npm run db:migrate` 退出码非 0：Wrangler 默认查找 `./migrations`，而 migration 被放在 `drizzle/migrations/` 且未配置 `migrations_dir`。 |
| 手工 SQL schema 验证 | 仅验证五张基础表 | 手工执行 `drizzle/migrations/0001_initial_schema.sql` 后出现 `portfolios`、`projects`、`steps`、`stages`、`audit_events`；没有 `project_links`。这不能替代可复现的 migration 命令。 |
| 本地 Worker/API smoke | **14/15 通过，1 项失败** | Worker 在本地端口运行；`API_URL=... npm run db:smoke` 的 Stage 删除保护返回 200，而验收预期为 400。 |
| 归档阻断/放行、审计查询、TBD、甘特 API | 通过 | smoke 已实际覆盖。 |

## 不通过项（必须返工）

1. **REQ-016 / 关联资料整项未实现（P0）**
   - `drizzle/migrations/0001_initial_schema.sql` 无 `project_links` 或等价一对多表。
   - `src/api/` 无关联资料 API；`public/index.html` 和 `public/app.js` 无资料维护、数量、标题或新窗口入口。
   - 因此不满足三条资料持久化、`http(s)` 校验、增改删审计、主数据展示及新窗口打开的验收标准 10。

2. **标准 migration 命令不可复现（P0）**
   - `npm run db:migrate` 无法找到 migration；README 同样给出会失败的命令。
   - 必须将 migration 配置为 Wrangler 可直接发现，或改脚本和 README 为真实可执行命令；在空本地 D1 连续执行两次均应成功。

3. **Stage 删除保护与受控迁移不成立（P0）**
   - smoke 证明：项目完成并整体归档后，删除它仍引用的 Stage 返回 200。
   - 独立 API 验证证明：将 Stage `Discovery` 改名为 `QA` 后，引用该 Stage 的项目仍保存 `stage: "Discovery"`。
   - 这违反“已被项目使用的 Stage 不可删除；如需变更，必须受控迁移”的架构规则。应选择并实现一致策略：禁止存在任意项目引用时删除/改名，或在事务中迁移全部引用项目并写审计。

4. **前端不具备步骤编辑/删除的正确实现（P0 scope-in）**
   - `public/app.js` 的 `saveProject()` 对编辑中的每条既有步骤均调用 `POST /steps`；读取到的 `existingSteps` 未使用，也没有 UI 调用步骤 `PUT` / `DELETE`。
   - 每次保存项目会重复新增步骤，无法满足“步骤新增/编辑/删除”的可维护要求。

5. **README 与实际环境不一致**
   - README 要求用户手工创建 D1 并手改 `wrangler.toml`，与已创建的受管资源和“干净 checkout 可复现”验收标准不一致。
   - 需改为实际 binding 配置、真实迁移命令、可复现本地 smoke 命令；不得要求手改源码。

## 返工后的最低验收包

- 为关联资料补齐 schema、服务器 API、UI、URL 服务端校验、审计与 HTTP smoke；同一项目三条链接刷新后仍在，主数据展示正确数量/标题并以新窗口打开。
- 修复 migration 目录配置/脚本与 README；在新本地 D1 连续运行两次 `npm run db:migrate` 成功。
- 修复 Stage 改名/删除的完整约束，并添加真实 API 测试。
- 修复前端步骤保存：保留步骤 ID，正确调用 create/update/delete，且编辑保存不会产生重复步骤。
- 重跑 lint、测试、build、migration、本地 Worker 与 smoke；执行报告仅报告真实、可复现的输出。

## 说明

- 本结论是 PM/QC 结论，**不是 Human Owner 验收**。
- 本轮没有 production deploy，也没有修改生产 Worker、D1、R2 或域名。
- WP-002A 在上述问题关闭前保持 `implemented, pending rework / PM-QC review`，不可签发为 accepted 或 complete。

---

## 第二轮复验｜2026-07-29

### 已关闭项

- REQ-016 的 `project_links` schema、API、前端维护、`http(s)` 校验及关联资料审计已实现。
- `npm run db:migrate` 连续执行两次成功；第二次正确提示无 migration。
- 本地 HTTP smoke 28/28 通过，覆盖关联资料三条创建/读取/非法 URL/修改/删除/审计、步骤更新/删除、甘特、归档和 Stage 删除保护。
- Stage 被任何活动或归档项目引用时，删除和改名均会被服务端阻断。

### 新发现的阻断项（未关闭）

1. **Web UI 未被 Worker 提供（P0）**
   - 已启动本地 `npm run dev`，真实请求 `GET /` 返回 `404`，`GET /index.html` 也返回 `404`。
   - `src/index.ts` 没有静态资源服务或 Assets binding；仅有 API 路由。因而 `public/index.html`、`public/app.js` 和样式无法作为用户网页访问。
   - 必须采用与 Cloudflare Workers 兼容的静态资源方案（例如 `[assets]` 绑定 + `env.ASSETS.fetch(request)`，或正确配置并实现 Workers Sites 静态资源处理），同时确保 `/api/*` 仍进入 Hono API。
   - 返工后必须验证：`GET /` 返回 200 且 `text/html`；`GET /app.js` 与 `GET /styles.css` 返回 200；浏览器可完成新建/编辑项目、步骤与关联资料的完整流程。

2. **生产 D1 binding 仍为全零占位符（部署前阻断）**
   - `wrangler.toml` 目前写入 `00000000-0000-0000-0000-000000000000`，不能部署到已创建的生产 D1。
   - 该项由 Codex PM/基础设施负责人在代码功能验收后使用已验证的生产资源 ID 配置；Cursor 不得自行部署或修改 Cloudflare 资源。

3. **前端遗留重复函数声明（质量清理）**
   - `public/app.js` 同时声明了两个 `renderProjectTable`；后者覆盖前者。应移除旧实现，避免不可维护代码和工具链解析差异。

### 第二轮结论

**L3：返工 required，未接受。** API 与数据层返工已基本通过，但由于用户实际入口返回 404，WP-002A 尚未交付可用 Web App。

---

## 第三轮复验｜2026-07-29

### 独立验证

| 验证项 | 结果 |
|---|---|
| `npm run lint` | 通过，退出码 0。 |
| `npm test` | 通过，9/9。 |
| `npm run build` | 通过，Cloudflare dry-run 成功。 |
| `npm run db:migrate` | 连续执行成功，无待执行 migration。 |
| 前端脚本解析 | `node --check < public/app.js` 通过；重复 `renderProjectTable` 已清理。 |
| Worker 静态入口 | 本地 `GET /`、`/index.html`、`/app.js`、`/styles.css` 全部返回 200，类型分别为 HTML、JavaScript、CSS。 |
| API 健康检查 | `GET /api/health` 返回 200 JSON。 |
| 本地 HTTP smoke | 28/28 通过，含关联资料、URL 校验、审计、步骤 CRUD、TBD、日/周/月甘特、Stage 和归档规则。 |

### 第三轮结论

**L1：WP-002A PM/QC 通过。**

WP-002A 的应用功能与本地可复现验收条件均已满足。该结论仅代表 Codex 的 PM/QC 通过，**不是 Human Owner 的最终产品验收**。下一阶段由 Codex 负责：填入已验证的生产 D1 binding、执行远程 migration、Git/GitHub 提交推送、部署到 `pmo.pmoforms.com` 并进行线上回归。Cursor 不接触生产 Cloudflare 资源。
