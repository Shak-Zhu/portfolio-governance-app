# 工作包 WP-009｜Demo 对齐 UI：时间轴、步骤条与项目树

## 基本信息

- 项目：Shak 项目组合治理系统
- 工作包编号：WP-009
- 签发人：Codex（PM）
- 接收人：Codex（直接实施；Cursor 不参与本工作包）
- 签发日期：2026-07-30
- 对应需求：REQ-026 / CR-005
- 对应 WBS：6.0
- 复杂度：High
- 预计 PM-Coder 迭代次数：2–3
- 不确定性：Medium
- 主要工作语言：中文

## Required Project Files to Read Before Editing

| File | Why read it | Required / Conditional |
|---|---|---|
| `pm-ai-work-packages/WP-009-Demo对齐UI-时间轴步骤条与项目树.md` | 当前权威工作包、范围和验收边界 | Required |
| `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/PM_CURRENT_STATUS.md` | 当前发布状态、数据重建和不可触碰边界 | Required |
| `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/PM_SCOPE_BASELINE.md` | REQ-026 的正式范围、验收和排除项 | Required |
| `governance-demo/index.html`、`governance-demo/app.js`、`governance-demo/styles.css` | 已获 Human Owner 接受的视觉信息密度与时间表头参考 | Required |
| `public/index.html`、`public/app.js`、`public/styles.css` | 正式版当前渲染实现和 UI 修改目标 | Required |
| `src/lib/gantt.ts` | Conditional：仅为理解 timeline label / period 数据；如可仅靠前端格式化则不得修改 | Conditional |
| `scripts/real-mcp-test.mjs`、`scripts/validate-skill-consistency.mjs` | 仅用于执行 MCP/Skill 回归，禁止修改 | Required |

**Read Evidence 要求**：最终报告必须单列 `Read Evidence`，逐项列出以上 Required 文件和从中采用的关键约束。不得默认重读其他历史文档。

## 背景

生产环境的项目数据已经按最新业务大盘通过官方 MCP 校正。当前 UI 与已接受 Demo 存在三项核心偏差：日视图的时间格信息密度不足；周表头显示 `W23/W24`，管理者无法知道具体日期；步骤条使用省略号、折行或压缩导致步骤名称不完整。项目主数据表也没有清晰表达父子项目关系。

本工作包只解决以上正式 UI 差异。它**不是** MCP、Skill、认证、数据库、数据迁移或 API 重构工作包。

## 本次目标

在不改变任何业务数据、服务端 MCP/REST 合同、Skill 与鉴权能力的前提下，使正式版的组合甘特图和项目主数据页面达到已接受 Demo 的可读性：时间可辨、步骤名完整、层级可辨，并保持日期几何真实。

## scope_in

1. **时间表头与网格**
   - `day`：每个真实日生成可见、等宽、可滚动的独立时间格；表头显示实际日期（如 `7/28`），不得聚合或静默截断。
   - `week`：每格显示真实起止日期（如 `7/28–8/3`）；`Wxx` 可以作为辅助 tooltip/metadata，但不得是唯一可见内容。
   - `month`：显示实际年月信息；继续支持长时间范围，无空白尾部或截断。
   - UI 应沿用 Demo 的清晰线框和信息密度，不改变后端 `get_gantt` 对日期格、`colStart`、`colEnd` 的数据语义。

2. **步骤条可读性与真实落位**
   - 日、周、月三种视图下，步骤名称都必须可完整读取：禁止 `text-overflow: ellipsis`、隐藏溢出、文字截断和折行压缩。
   - 允许为文字使用不改变日期语义的视觉扩展、轨道/lane 或其它可靠实现；**不得**让标签扩展被当作计划结束日期。
   - 每条真实计划的左/右落位仍严格以服务端返回的 `colStart / colEnd` 为准；相同日期范围的条不得被渲染为不同几何范围，重叠条仍须各自可读。
   - `title` / 可访问名称保留完整步骤名与起止日期。

3. **项目主数据树形关系**
   - 使用 `parent_id` 现有关系生成稳定的深度优先树形顺序，而非 API 返回顺序。
   - 根项目、一级子项目、二级子项目至少三级均应具有明确树线、缩进、层级标签或等价视觉表达；不得只用不易辨认的空白缩进。
   - 提供父项目展开/折叠控制；收起只影响其后代的显示，不更新项目、步骤、统计或审计。
   - 加入 `aria-level`、`aria-expanded` 等适当语义，并让键盘/鼠标都能操作展开控制。

4. **UI 回归与文档**
   - 为上述呈现规则增加针对性的自动化测试或可重复的验证脚本；更新 README 中与实际 UI 不一致的说明（如有）。
   - 现有测试和现有 UI 流程必须保持可用。

## scope_out

1. 不修改 `/mcp`、`src/mcp/**`、31 个 MCP 工具、Skill Bundle、manifest、`agent-skills/**`、一键安装文案或 Bearer Token 机制。
2. 不修改 `src/auth.ts`、登录/会话保护、Cloudflare Worker 鉴权、`wrangler.toml`、D1 schema/migration、R2 备份恢复、cron、Cloudflare 资源、域名或 secrets。
3. 不新增、删除、迁移或重排生产业务数据；不调用 Cooper，不写 D1，不通过私有 `/api/*` 写入数据。
4. 不改变既有 `/api/*` 和官方 MCP 的请求/响应合同；如发现确实无法满足 UI 而需服务端变更，停止并报告具体缺口，不得自行扩大范围。
5. 不重做页面品牌、登录页、Agent 接入中心、备份管理或其他无关页面。

## 允许修改的文件

- `public/app.js`
- `public/styles.css`
- `public/index.html`（仅当树形控件的必要语义/容器确实需要）
- 仅必要的前端 UI 测试/验证脚本及 README 说明
- `pm-ai-work-packages/WP-009-Demo对齐UI-时间轴步骤条与项目树-RESULT.md`

如需要修改以上以外文件，必须先停下并报告 PM；尤其不得修改 `src/index.ts`、`src/mcp/**`、`src/auth.ts`、`agent-skills/**`、`wrangler.toml`、migrations 或 PM baseline 文件。

## 数据库 / 环境 / 部署限制

- 数据库：禁止 D1 schema、migration、seed 和生产数据变更。
- 环境：仅本地开发与本地验证。
- 部署：禁止 `wrangler deploy`、禁止 Worker secret、D1、R2、DNS、Cloudflare 配置操作；禁止 Git commit/push。发布、Git 和生产回归由 Codex 完成。

## 验收标准

1. **日视图网格**：在 `2026-07-28` 至 `2026-08-19` 区间，页面可见连续 23 个逐日表头，首尾分别为 `7/28` 和 `8/19`；每格有独立分隔线，横向滚动可查看所有格。
2. **周视图可读性**：同一区间的每个可见周表头包含真实起止日期文本（例如 `7/27–8/2` 或等价的跨月明确格式）；不得出现仅 `Wxx` 的表头。
3. **月视图可读性**：月表头显示真实年月，且 120 个月长区间仍不截断、不产生时间轴末端空白。
4. **条名不截断**：给定含长名称的测试步骤，在 day/week/month 三个视图中 DOM 的可见文本都包含完整步骤名；CSS 与渲染结果中不得使用 `text-overflow: ellipsis`、`overflow: hidden` 或折行压缩来截断 `.step-bar` 名称。
5. **日期几何不失真**：针对至少 3 条短/长/重叠步骤，条的真实日期起止继续由 `colStart / colEnd` 对齐；若为容纳文字存在视觉标签延伸，必须有可验证的真实结束边界，不得让管理者误读为更晚日期。
6. **主数据树**：含根→一级→二级关系的测试数据按深度优先排列；每一层有可区分视觉树线/缩进及 `aria-level`；收起根项目后其所有后代隐藏，展开恢复；该操作不触发任何写 API/MCP 调用。
7. **非回归**：`npm run lint`、`npm test`、`npm run test:e2e`、`npm run test:scheduled`、`npm run skill:build`、`node scripts/validate-skill-consistency.mjs`、`npm run build` 和 `git diff --check` 均通过；MCP tools/list 仍为 31 个，Skill 一致性校验不下降。
8. **范围审计**：`git diff --name-only` 只含允许修改文件；无 production deploy、secret、D1/R2/DNS/Git remote 操作；无 token/password 写入源码、报告或日志。

## 必须运行的验证命令

```bash
npm run lint
npm test
npm run test:e2e
npm run test:scheduled
npm run skill:build
node scripts/validate-skill-consistency.mjs
npm run build
git diff --check
git diff --name-only
```

并提供：

- day / week / month 三种视图的本地截图或可重复渲染证据；
- 主数据树展开与收起的证据；
- MCP tools/list=31 的回归证据；
- 逐项对照验收标准的结果。

## 依赖

- 前置：WP-008 已生产发布；生产数据已由 Codex 通过官方 MCP 校正。
- 外部：无。

## 完成后操作

1. 在当前对话中用中文报告结果，并写入 `pm-ai-work-packages/WP-009-Demo对齐UI-时间轴步骤条与项目树-RESULT.md`。
2. 报告必须包含 `Read Evidence`、改动文件清单、每项验收证据、回归命令真实输出、未完成项（如有）和范围审计。
3. 最终状态只能写：**implemented, pending PM/QC review**。
4. 不得宣布 accepted / complete / MVP done / finished / ready，也不得修改 PM baseline 文档或提升完成度。
