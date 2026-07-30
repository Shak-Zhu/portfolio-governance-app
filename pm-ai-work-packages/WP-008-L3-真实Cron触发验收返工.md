# 工作包 WP-008 L3 返工｜真实 Cron 触发验收

## 基本信息

- 项目：Shak 项目组合治理系统
- 接收人：Cursor（Coder）
- 签发人：Codex（PM / QC）
- 对应需求：REQ-012
- 工作语言：中文
- 交付状态限制：最终只能写 `implemented, pending PM/QC review`

## 唯一返工项

L2 已完成 manifest 严格校验、恢复内容 SHA 校验和隔离库就绪状态；**唯一未通过项**是 scheduled 验收。

当前 G14 仍调用 `POST /api/backups`，这只能验证手动备份，不能证明 Worker 的 `scheduled()` 路径真实执行。`node_modules/wrangler` 已明确指出：Miniflare 不自动触发 scheduled，须使用 `--test-scheduled` 并访问 `/__scheduled`。

## Required Project Files to Read Before Editing

| 文件 | 原因 | Required |
|---|---|---|
| `pm-ai-work-packages/WP-008-L3-真实Cron触发验收返工.md` | 当前权威工作包 | Required |
| `pm-ai-work-packages/WP-008-L2-恢复完整性与计划任务验收返工.md` | L2 已通过边界，不得回退 | Required |
| `pm-ai-reviews/WP-008-最终收尾-组合KPI与R2备份恢复-QC.md` | 独立 QC 拒收证据 | Required |
| `src/index.ts`、`src/lib/backup.ts`、`wrangler.toml` | scheduled handler、共享服务和 cron 配置 | Required |
| `scripts/real-mcp-test.mjs`、`package.json` | 现有验证命令与测试整合点 | Required |

## scope_in

1. 增加一个可重复、无生产访问的真实 cron 集成测试。允许使用：

```text
wrangler dev --local --test-scheduled
GET /__scheduled?cron=0+3+*+*+*
```

或等价的、能实际 dispatch Worker `scheduled()` 的公开 Wrangler/Miniflare 机制。

2. 测试必须使用本地 D1 与本地 R2；不得绑定远程生产 DB/R2。
3. 测试前记录 R2 `backups/` 对象数；触发 scheduled 后轮询到对象数增加；读取新增对象，断言：
   - key 符合 `backups/YYYY-MM-DD/<timestamp>.json`；
   - JSON 有受支持 schemaVersion；
   - 六张业务表、逐表摘要与 contentSha256 完整；
   - 备份对象总数不超过 30。
4. scheduled 测试必须能捕捉 handler 未调用、R2 未写入、备份结构错误；不得以源代码搜索、手动 API、或“共享 createBackup”声明代替。
5. 将原 G14 改名为准确的“真实 scheduled 触发”或拆为手动备份与真实 scheduled 两条；不得再把手动 API 称为 scheduled 测试。
6. 如需添加 npm script，可仅添加本地测试脚本。必须确保 `npm run test:e2e` 或清晰新增的 `npm run test:scheduled` 在干净本机可直接运行，并在 RESULT 中给出完整真实输出。
7. README / `docs/生产架构.md` 中不要虚构已通过生产 cron；可以说明“本地真实 scheduled 验收已通过，生产 cron 由 Codex 发布后复验”。

## scope_out

- 不修改备份/恢复业务逻辑、manifest 合同、登录、MCP、Skill 或 UI（除非仅修正测试相关文案）。
- 不执行 deploy、D1/R2 创建、secret 写入、Git commit/push 或生产数据操作。
- 不修改 PM memory、范围基线和原工作包。

## 验收标准

1. 真实执行 Worker scheduled，而非手动 HTTP 备份 API；命令输出能证明 `/__scheduled` 或等价 dispatch 被触发。
2. 触发前后 R2 对象数实际增加，新增对象的 JSON 经解析验证六表、表 SHA 和总 SHA。
3. 全程仅本地 D1 / R2，输出中不得出现远程生产数据操作。
4. `npm run lint`、`npm test`、`npm run test:e2e`、真实 scheduled 测试、`npm run build`、`git diff --check` 均通过。
5. 结果报告为中文，含 Read Evidence、命令完整输出、使用的本地端口/清理机制、未执行生产动作。最终状态只能为 `implemented, pending PM/QC review`。

## 允许修改文件

- `scripts/**`、`package.json`
- `README.md`、`docs/生产架构.md`
- `pm-ai-work-packages/WP-008-L3-真实Cron触发验收返工-RESULT.md`
