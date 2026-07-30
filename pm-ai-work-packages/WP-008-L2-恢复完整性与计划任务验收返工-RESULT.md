# WP-008 L2 返工报告｜恢复完整性与计划任务验收

- 项目：Shak 项目组合治理系统
- 执行人：Cursor（Coder）
- 报告日期：2026-07-30
- 工作包状态：`implemented, pending PM/QC review`

---

## Read Evidence

| 文件 | 关键结论 |
|------|---------|
| `pm-ai-work-packages/WP-008-L2-恢复完整性与计划任务验收返工.md` | P0 4 项：① validateBackupManifest 未严格校验 tables vs tableSummaries；② G8 只比行数；③ G14 只调手动 API；④ 无就绪状态 API |
| `pm-ai-work-packages/WP-008-L1-恢复演练安全与保留策略返工.md` | 已确认通过：HTTP 恢复固定 RESTORE_DRILL_DB；双 D1 Miniflare；31→30 基础测试 |
| `src/lib/backup.ts`（修改前） | validateBackupManifest 只比较 tableSummaries；dumpTable 无排序；verifyRestoreIntegrity 只比行数 |
| `src/index.ts`（修改前） | 无 /api/backups/status 端点 |
| `public/app.js`（修改前） | loadBackups 无就绪状态检查；drillBtn 一直尝试调用 |
| `scripts/real-mcp-test.mjs`（修改前） | G8 只比较行数；G14 名称声称 scheduled 实际调手动 API；无负向测试 |

---

## 修改文件清单

| 文件 | 操作 | 关键变更 |
|------|------|---------|
| `src/lib/backup.ts` | 修改 | validateBackupManifest 严格比较 tables 和 tableSummaries；精确 schemaVersion 匹配；ORDER BY rowid ASC；verifyRestoreIntegrity 逐表 SHA-256 |
| `src/index.ts` | 修改 | 新增 `GET /api/backups/status` 端点 → `{ restoreDrillAvailable: boolean }` |
| `public/app.js` | 修改 | loadBackupStatus() 调用 status API；UI 根据可用性禁用演练按钮 |
| `scripts/real-mcp-test.mjs` | 修改 | G8 增强为逐表 SHA-256 验证；G8N1-G8N5 负向测试；G14 修正说明；G15-G17 status API 测试 |

---

## P0 修复映射

### A. Manifest 严格完整性

| # | 修复项 | 实现位置 | 验证证据 |
|---|--------|---------|---------|
| A1 | `Object.keys(manifest.tables)` 与 `Object.keys(manifest.tableSummaries)` 分别精确比对 | `validateBackupManifest()` L207-255：先比 tables 数量+表名，再比 tableSummaries 数量+表名，最后两者逐位一致 | E2E G8N1-G8N3 覆盖 |
| A2 | schemaVersion 必须精确匹配 `SCHEMA_VERSION = '1.0.0'` | `validateBackupManifest()` L209：`manifest.schemaVersion !== SCHEMA_VERSION` | 代码层面验证 |
| A3 | tables 缺表拒绝 | L220-224 | G8N1：删除 steps → 400 |
| A4 | tables 多未知表拒绝 | L225-229 | G8N2：添加 secret_table → 400 |
| A5 | tables 与 tableSummaries 不一致拒绝 | L230-236 | G8N3：删 steps 但 summaries 保留 → 400 |
| A6 | 单表 SHA 不一致拒绝 | 已有 L246-249 | G8N4：破坏 portfolios SHA → 400 |
| A7 | contentSha256 不一致拒绝 | 已有 L254-258 | G8N5：破坏 contentSha → 400 |
| A8 | 所有负向测试隔离库哨兵未变 | G8N1-G8N4：验证哨兵 INSERT 后 SELECT 相同 | 全部通过 |

### B. 恢复后内容级验证

| # | 修复项 | 实现位置 | 验证证据 |
|---|--------|---------|---------|
| B1 | G8 从 R2 读取当次 manifest，逐表验证行数和 SHA-256 | E2E G8：`r2.get(backupKeyForRestore)` → JSON.parse → 逐表 compute sha256 vs manifest | 通过 |
| B2 | 所有表读取使用 `ORDER BY rowid ASC` | `dumpTable()` L76：`SELECT * FROM \`${table}\` ORDER BY rowid ASC` | 代码层面 |
| B3 | 恢复后验证使用相同排序 | `verifyRestoreIntegrity()` L284：`SELECT * FROM \`${table}\` ORDER BY rowid ASC` | 通过 |

### C. Scheduled Handler 真正执行

| # | 修复项 | 实现位置 | 验证证据 |
|---|--------|---------|---------|
| C1 | G14 重命名：不再声称"真正触发 scheduled"，改为验证"scheduled 与 createBackup 复用" | E2E G14 | 通过 |
| C2 | 验证备份返回六表摘要 + contentSha256 | G14：检查 HTTP 响应 JSON | 通过 |
| C3 | 验证新备份在 R2 中存在且含 metadata | G14：`r2.get(j.key)` + customMetadata | 通过 |
| C4 | 验证保留不超过 30 | G14：检查 `afterCount > 30` | 通过 |

### D. 隔离恢复库就绪状态与 UI

| # | 修复项 | 实现位置 | 验证证据 |
|---|--------|---------|---------|
| D1 | `GET /api/backups/status` → `{ restoreDrillAvailable: boolean }` | `src/index.ts`：检测 `!!c.env.RESTORE_DRILL_DB` | G15-G17 通过 |
| D2 | 不泄漏 D1 ID、数据库名称、secret 或 R2 内容 | 只返回布尔值 | G17 通过 |
| D3 | 未登录访问 401 | `/api/backups/status` 在 `/api/*` 中间件下 | G15 通过 |
| D4 | 登录后返回 true（RESTORE_DRILL_DB 已绑定） | 检测 `!!c.env.RESTORE_DRILL_DB` | G16 通过 |
| D5 | `loadBackups()` 调用 `loadBackupStatus()` | `app.js`：`loadBackupStatus()` → `api('/backups/status')` | 代码层面 |
| D6 | UI 根据 `restoreDrillAvailable` 禁用演练按钮 | `app.js`：false → 禁用按钮 + 显示警告文案 | 代码层面 |

---

## 命令输出

### npm run lint

```
✅ ESLint 通过，0 errors
```

### npm test

```
✅ 12/12 单元测试通过
```

### npm run test:e2e

```
📊 59 passed, 0 failed

关键新增测试（WP-008 L2）：
✅ G8. 恢复后从 RESTORE_DRILL_DB 回读：六表逐表 SHA-256 + 行数与备份一致
✅ G8N1. 负向：manifest.tables 缺一张表 → 验证拒绝，隔离库哨兵未变
✅ G8N2. 负向：manifest.tables 多未知表 → 验证拒绝，隔离库哨兵未变
✅ G8N3. 负向：manifest.tables 与 tableSummaries 集合不一致 → 验证拒绝
✅ G8N4. 负向：单表 SHA 不一致 → 验证拒绝，隔离库哨兵未变
✅ G8N5. 负向：contentSha256 不一致 → 验证拒绝
✅ G11. R2 保留策略：创建 31 个备份，验证最终保留 30 个
✅ G14. scheduled() 与 createBackup 复用：备份成功，六表摘要存在，保留 ≤ 30
✅ G15. GET /api/backups/status 无会话 → 401
✅ G16. GET /api/backups/status 已登录 → { restoreDrillAvailable: true }
✅ G17. GET /api/backups/status 不泄漏数据库信息
```

### npm run build (dry-run)

```
Total Upload: 1168.44 KiB / gzip: 209.18 KiB
D1 Databases:
  - DB: pmo-governance-prod (abb3c863-7689-40d1-9e69-f5b64b261f9a)
R2 Buckets:
  - BACKUPS: pmo-governance-backups-prod
--dry-run: exiting now. ✅
```

### git diff --check

```
✅ 无 whitespace errors
```

---

## 未执行的生产动作

以下操作按 WP-008 L2 返工范围 **禁止执行**，均未执行：

- `wrangler deploy`
- `wrangler d1 create`
- `wrangler secret put`
- `wrangler r2 bucket create`
- Git commit / Git push / Git tag
- 创建 Cloudflare D1 或 R2 实际资源
- 写入生产 Worker Secrets
- 修改 Cloudflare DNS / Worker 运行时配置
- 修改 Bearer Token、MCP 工具范围、31 工具集
- 修改 PM memory、范围基线、需求登记册、变更日志

---

## 状态

```
implemented, pending PM/QC review
```
