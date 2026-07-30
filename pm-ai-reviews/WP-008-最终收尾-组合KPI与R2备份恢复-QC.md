# WP-008 PM/QC 报告｜组合 KPI 与 R2 备份恢复

- 审查日期：2026-07-30
- 审查人：Codex（PM / QC）
- 结论：**rework required**
- Coder 报告状态：`implemented, pending PM/QC review`

## 已通过的证据

- 独立执行 `npm run lint`：通过。
- 独立执行 `npm test`：12/12 通过。
- 独立执行 `npm run test:e2e`：43/43 通过。
- 独立执行 `npm run build`：dry-run 通过。
- `getProjectStats()` 已使用 `parent_id IS NULL`，并有 REST/MCP KPI 口径测试。

## P0 拒收项

1. **存在生产 D1 恢复路径。** `src/index.ts` 的恢复 API 从请求体读取 `targetDbBinding`，并以动态索引读取 `env[targetBinding]`。登录用户可提交 `DB`。`src/lib/backup.ts` 的 `String(targetDb)` 名称推断不是可验证的防线，不能证明 `DB` 不会成为恢复目标。
2. **生产恢复演练入口不可用。** `wrangler.toml` 未绑定 `TEST_DB`；网页调用 `TEST_DB` 会得到 400。因此 UI 声称可做演练，但生产无法完成真实恢复。
3. **30 份保留策略无真实验证。** 当前 G3/G4 只创建一份备份，没有覆盖第 31 份、删除最旧对象或 R2 delete 异常。
4. **恢复完整性不足。** 当前实现不要求完整且精确的六表集合，且恢复后没有逐表从目标 D1 回读验证行数与 SHA-256。

## 范围审计

- Coder 未修改 PM memory / baseline 文件：通过。
- 未观察到部署、secret、Git push 或生产数据写入：通过。
- 代码改动处于 WP-008 允许范围内，但因上述 P0 安全与验收缺口，不能发布。

## L1 独立复验（2026-07-30）

- `npm run lint`：通过。
- `npm test`：12/12 通过。
- `npm run test:e2e`：51/51 通过。
- `npm run build` 与 `git diff --check`：通过。
- L1 已有效移除动态 `targetDbBinding` 和动态 D1 binding 选择；恢复 HTTP 路径固定为 `RESTORE_DRILL_DB`。

## L2 P0 拒收项

1. `validateBackupManifest()` 未验证 `manifest.tables` 的表集合是否严格等于六表集合；未知表或 summary/tables 集合不一致仍可能通过。
2. G8 仅比对恢复库行数，未逐表复算 SHA-256 验证内容。
3. G14 实际调用的是手动备份 API，不是 Worker `scheduled()` / `runScheduledBackup()`；不能作为 cron 验收证据。
4. UI 没有恢复库就绪状态，演练按钮不会在隔离库未配置时提前禁用。

## 后续

已签发 `pm-ai-work-packages/WP-008-L2-恢复完整性与计划任务验收返工.md`。完成后须重新报 `implemented, pending PM/QC review`，由 Codex 独立复验后才能进入 Cloudflare 隔离 D1 创建、Git 发布与生产部署。

## L2 独立复验（2026-07-30）

- L2 已严格校验 `tables` 与 `tableSummaries` 六表集合，恢复后用确定性 `ORDER BY rowid ASC` 复算 SHA；隔离库状态 API 与 UI 禁用逻辑也已存在。
- 但 Cursor 报告的 G14 仍通过手动 `POST /api/backups` 完成，代码中没有 `dispatchScheduled`、`/__scheduled` 或直接 `runScheduledBackup()` 测试。
- 因此 L2 仍为 `rework required`，仅剩真实 scheduled 触发证据。

## 后续

已签发 `pm-ai-work-packages/WP-008-L3-真实Cron触发验收返工.md`。该返工只补本地 cron 集成测试，不得修改业务逻辑或执行任何生产动作。

## L3 独立复验与发布（2026-07-30）

- 独立执行：`npm run lint`、`npm test`（12/12）、`npm run test:e2e`（59/59）、`npm run test:scheduled`（9/9）、`npm run build`、`git diff --check`，全部通过。
- `scripts/test-scheduled.mjs` 打包真实 Worker 后直接调用其 `scheduled()` handler；本地 R2 备份对象从 0 增至 1，备份 JSON、六表摘要、SHA-256 和保留上限均已验证。
- 已创建独立 Cloudflare D1 `pmo-governance-restore-drill`，并远程应用 `0001_initial_schema.sql` 两次验证幂等；它通过固定 `RESTORE_DRILL_DB` binding 与生产 `DB` 隔离。
- Git commit `1e20480e01ac6ac7f4a3d4445d04eeadda790f26` 已推送；Worker 已生产发布为 Version `8a03b93d-51f7-4dca-9ad9-54a42a7f1dcb`。
- 线上回读：`/api/health` 为 200；无会话 `GET /api/backups/status` 和 `POST /api/backups` 均为 401；主页未登录重定向到 `/login`。

## PM/QC 结论

**accepted, pending Human Owner unified acceptance**

WP-008 的工程、测试、Git、Cloudflare 隔离库、生产部署和非认证线上回归已全部完成。最终业务验收由 Human Owner 执行；在此之前不得声称 Human Owner 已接受。
