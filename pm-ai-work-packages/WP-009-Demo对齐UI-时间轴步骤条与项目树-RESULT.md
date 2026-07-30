# WP-009 实施记录｜Demo 对齐 UI：时间轴、步骤条与项目树

- 记录日期：2026-07-30
- 实施人：Codex
- 状态：implemented, pending PM/QC review

## 实施内容

1. 正式甘特前端将日视图列宽调整为 48px、周视图为 88px、月视图为 100px；日格继续显示实际日期。
2. 周表头优先使用 Worker 已返回的 `rangeLabel`，由 `W29` 改为 `7/13–7/19` 这类真实起止日期；月表头保留实际年月。
3. 去除 `.step-bar` 的省略和隐藏溢出。真实日期条仍严格由 `grid-column: colStart / colEnd` 控制；文字使用独立可视标签完整展示，真实结束位置以条的白色细竖线标识，避免把文字宽度误读为计划长度。
4. 项目主数据表改为由 `parent_id` 构建的稳定深度优先树；总项目/子项目标签、树线、隶属父级提示和展开/收起交互均在前端完成，不写入任何数据。

## 范围审计

修改：

- `public/app.js`
- `public/styles.css`
- `pm-ai-work-packages/WP-009-Demo对齐UI-时间轴步骤条与项目树.md`
- 本实施记录

未修改：

- `/mcp`、`src/mcp/**`、`agent-skills/**`
- `src/auth.ts`、登录/会话、D1 schema/migration、R2、cron、Cloudflare 配置
- REST/MCP 请求响应合同、生产业务数据

## 本地验证

| 检查 | 结果 |
|---|---|
| `node --check public/app.js` | 通过 |
| `npm run lint` | 通过 |
| `npm test` | 12/12 通过 |
| `npm run test:e2e` | 59/59 通过；MCP tools/list = 31 |
| `npm run test:scheduled` | 9/9 通过 |
| `npm run skill:build` | 通过；生成时间戳差异已还原，Skill 文件无保留改动 |
| `node scripts/validate-skill-consistency.mjs` | 22/22 通过 |
| `npm run build` | dry-run 通过 |
| `git diff --check` | 通过 |

## 待 PM/QC

1. 在可登录的本地浏览器会话验证 day/week/month 三种视图的视觉呈现及长文字标签效果。
2. 验证主数据树的展开/收起与至少三级父子项目效果。
3. 通过后才可由 Codex 执行 Git 与 Cloudflare 生产发布。
