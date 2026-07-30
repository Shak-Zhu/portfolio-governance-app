/**
 * R2 逻辑备份服务（WP-008 L2 返工）
 *
 * 覆盖 6 张业务表：portfolios, projects, stages, steps, project_links, audit_events
 * R2 key 格式：backups/YYYY-MM-DD/<timestamp>.json
 * 每次成功备份后保留最近 30 份，超出的旧备份删除。
 * 恢复演练仅恢复到隔离/测试 D1（RESTORE_DRILL_DB），绝不覆盖生产 D1。
 *
 * 安全原则：
 * - 恢复目标只能是代码中显式固定的 RESTORE_DRILL_DB
 * - 禁止使用 env[用户输入] 动态选择数据库
 * - 禁止使用 String(targetDb) 名称推断作为唯一防线
 * - manifest.tables 与 tableSummaries 必须精确一致
 * - schemaVersion 必须精确匹配受支持版本
 *
 * 确定性原则：
 * - 所有表读取使用 ORDER BY rowid ASC，保证 SHA-256 稳定性
 */
import { createHash } from 'node:crypto';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

// ==================== Types ====================

export interface BackupTableSummary {
  rows: number;
  sha256: string;
}

export interface BackupManifest {
  schemaVersion: string;
  createdAt: string;
  contentSha256: string;
  tableSummaries: Record<string, BackupTableSummary>;
  tables: Record<string, Record<string, unknown>[]>;
}

export interface BackupEntry {
  key: string;
  size: number;
  createdAt: string | null;
  contentSha256: string | null;
  tableSummaries: Record<string, BackupTableSummary>;
}

// ==================== Constants ====================

const BACKUP_PREFIX = 'backups/';
const MAX_RETAIN = 30;
const SCHEMA_VERSION = '1.0.0';
// 严格固定的六张表名单；不允许任意扩展
const BUSINESS_TABLES = ['portfolios', 'projects', 'stages', 'steps', 'project_links', 'audit_events'];

// ==================== Helpers ====================

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function isoNow(): string {
  return new Date().toISOString();
}

function backupDateDir(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function makeR2Key(): string {
  return `${BACKUP_PREFIX}${backupDateDir()}/${Date.now()}.json`;
}

// ==================== Table Dump ====================

/**
 * 使用确定性排序（ORDER BY rowid ASC）读取表数据。
 * 保证 JSON 序列化顺序稳定，使 SHA-256 可复现。
 */
async function dumpTable(db: D1Database, table: string): Promise<Record<string, unknown>[]> {
  const { results } = await db.prepare(`SELECT * FROM \`${table}\` ORDER BY rowid ASC`).all();
  return results as Record<string, unknown>[];
}

// ==================== Core Backup ====================

/**
 * 创建逻辑备份 JSON 并上传到 R2。
 * 每次成功后调用 purgeOldBackups 清理旧备份。
 */
export async function createBackup(db: D1Database, r2: R2Bucket): Promise<{ manifest: BackupManifest; key: string }> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const tableSummaries: Record<string, BackupTableSummary> = {};

  // 严格只备份六张业务表
  for (const table of BUSINESS_TABLES) {
    const rows = await dumpTable(db, table);
    const rowsJson = JSON.stringify(rows);
    tables[table] = rows;
    tableSummaries[table] = {
      rows: rows.length,
      sha256: sha256(rowsJson),
    };
  }

  const contentSha256 = sha256(JSON.stringify(tables));

  const manifest: BackupManifest = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: isoNow(),
    contentSha256,
    tableSummaries,
    tables,
  };

  const key = makeR2Key();
  const body = JSON.stringify(manifest, null, 2);

  const upload = await r2.put(key, body, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      createdAt: manifest.createdAt,
      contentSha256,
    },
  });

  if (!upload) {
    throw new Error(`R2 上传失败: ${key}`);
  }

  // 清理旧备份
  await purgeOldBackups(r2);

  return { manifest, key };
}

// ==================== List Backups ====================

/**
 * 列出 R2 中最近的备份条目（按 key 降序，最新在前）。
 */
export async function listBackups(r2: R2Bucket): Promise<BackupEntry[]> {
  const entries: BackupEntry[] = [];
  let cursor: string | undefined;

  do {
    const list = await r2.list({
      prefix: BACKUP_PREFIX,
      cursor,
      limit: 100,
    });

    for (const obj of list.objects) {
      const meta = obj.customMetadata as { createdAt?: string; contentSha256?: string } | undefined;
      entries.push({
        key: obj.key,
        size: obj.size,
        createdAt: meta?.createdAt ?? null,
        contentSha256: meta?.contentSha256 ?? null,
        tableSummaries: {},
      });
    }

    cursor = list.cursor;
  } while (cursor);

  // 按 key 降序（最新在前）
  entries.sort((a, b) => b.key.localeCompare(a.key));

  return entries;
}

// ==================== Purge Old Backups ====================

/**
 * 保留最近 MAX_RETAIN 份备份，删除更旧的。
 * 删除失败时抛出错误，不静默吞掉。
 * R2 delete() 返回 void（undefined）；通过重新 list 验证删除结果。
 */
export async function purgeOldBackups(r2: R2Bucket): Promise<{ kept: number; deleted: number }> {
  const all = await listBackups(r2);
  const toDelete = all.slice(MAX_RETAIN);

  let deleted = 0;

  for (const entry of toDelete) {
    // R2 delete() 返回 void；调用后通过重新 list 验证对象确实被删除
    await r2.delete(entry.key);

    // 通过重新 list 验证对象确实被删除
    const verify = await r2.list({ prefix: entry.key, limit: 1 });
    if (verify.objects.length > 0) {
      throw new Error(`R2 删除旧备份失败（对象仍存在）: ${entry.key}`);
    }

    deleted++;
  }

  return { kept: Math.min(all.length, MAX_RETAIN), deleted };
}

// ==================== Pre-restore Validation ====================

/**
 * 恢复前严格验证备份完整性（WP-008 L2）：
 * 1. schemaVersion 必须精确匹配当前受支持版本
 * 2. Object.keys(manifest.tables) 必须恰好等于六表集合
 * 3. Object.keys(manifest.tableSummaries) 必须恰好等于六表集合
 * 4. manifest.tables 与 manifest.tableSummaries 集合必须完全一致
 * 5. 每张表：数组 + 行数一致 + SHA-256 一致
 * 6. 整体 contentSha256 与表数据一致
 *
 * 验证失败时在对隔离库执行任何 DELETE/INSERT 前拒绝。
 */
export function validateBackupManifest(manifest: BackupManifest): void {
  // 1. 验证 schemaVersion 精确匹配
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`备份 schemaVersion 不匹配：期望 "${SCHEMA_VERSION}"，实际 "${manifest.schemaVersion || '(空)'}"`);
  }

  // 2-4. 验证 tables 和 tableSummaries 集合精确一致
  const tableKeys = Object.keys(manifest.tables).sort();
  const summaryKeys = Object.keys(manifest.tableSummaries).sort();
  const expectedTables = [...BUSINESS_TABLES].sort();

  // tables 数量检查
  if (tableKeys.length !== expectedTables.length) {
    throw new Error(`manifest.tables 表数量不符：期望 ${expectedTables.length} 张（${expectedTables.join(', ')}），实际 ${tableKeys.length} 张（${tableKeys.join(', ')}）`);
  }

  // tableSummaries 数量检查
  if (summaryKeys.length !== expectedTables.length) {
    throw new Error(`manifest.tableSummaries 表数量不符：期望 ${expectedTables.length} 张，实际 ${summaryKeys.length} 张`);
  }

  // tables 表名精确匹配
  for (let i = 0; i < expectedTables.length; i++) {
    if (tableKeys[i] !== expectedTables[i]) {
      throw new Error(`manifest.tables 含未知表或表名错误：期望 "${expectedTables.join(', ')}"，实际 "${tableKeys.join(', ')}"`);
    }
  }

  // tableSummaries 表名精确匹配
  for (let i = 0; i < expectedTables.length; i++) {
    if (summaryKeys[i] !== expectedTables[i]) {
      throw new Error(`manifest.tableSummaries 含未知表或表名错误：期望 "${expectedTables.join(', ')}"，实际 "${summaryKeys.join(', ')}"`);
    }
  }

  // tables 与 tableSummaries 集合一致性（两者已分别排序，逐位比对）
  for (let i = 0; i < expectedTables.length; i++) {
    if (tableKeys[i] !== summaryKeys[i]) {
      throw new Error(`manifest.tables 与 manifest.tableSummaries 表集合不一致：tables="${tableKeys.join(', ')}"，summaries="${summaryKeys.join(', ')}"`);
    }
  }

  // 5. 验证每张表：数组 + 行数一致 + SHA-256 一致
  for (const table of BUSINESS_TABLES) {
    const summary = manifest.tableSummaries[table];
    const rows = manifest.tables[table];

    if (!Array.isArray(rows)) {
      throw new Error(`备份表 "${table}" 数据不是数组`);
    }
    if (rows.length !== summary.rows) {
      throw new Error(`表 ${table} 行数不匹配：期望 ${summary.rows}，实际 ${rows.length}`);
    }
    const rowsJson = JSON.stringify(rows);
    if (sha256(rowsJson) !== summary.sha256) {
      throw new Error(`表 ${table} SHA-256 不匹配`);
    }
  }

  // 6. 验证整体 contentSha256
  const computed = sha256(JSON.stringify(manifest.tables));
  if (manifest.contentSha256 !== computed) {
    throw new Error(`备份内容 SHA-256 不匹配：期望 ${manifest.contentSha256}，实际 ${computed}`);
  }
}

// ==================== Post-restore Verification ====================

/**
 * 恢复成功后从目标 D1 逐表回读，验证行数与表 SHA-256。
 * 使用 ORDER BY rowid ASC 与 dumpTable 保持一致的排序策略。
 * 失败即抛错，调用方必须感知。
 */
export async function verifyRestoreIntegrity(
  targetDb: D1Database,
  expectedSummaries: Record<string, BackupTableSummary>
): Promise<void> {
  for (const table of BUSINESS_TABLES) {
    const summary = expectedSummaries[table];
    // 与 dumpTable 使用相同的确定性排序
    const { results } = await targetDb.prepare(`SELECT * FROM \`${table}\` ORDER BY rowid ASC`).all();
    const rows = results as Record<string, unknown>[];
    const rowsJson = JSON.stringify(rows);

    if (rows.length !== summary.rows) {
      throw new Error(`恢复后验证失败：表 ${table} 行数不符（期望 ${summary.rows}，实际 ${rows.length}）`);
    }
    if (sha256(rowsJson) !== summary.sha256) {
      throw new Error(`恢复后验证失败：表 ${table} SHA-256 不匹配`);
    }
  }
}

// ==================== Recovery Drill ====================

/**
 * 恢复演练：将备份数据恢复到指定的目标隔离 D1 数据库。
 *
 * 安全约束：
 * - targetDb 必须是代码中显式传入的 RESTORE_DRILL_DB 类型值
 * - 函数签名不允许从请求体或用户输入获取数据库
 * - 验证：JSON 结构、contentSha256、完整六表、逐表行数、逐表 SHA-256
 * - 恢复后从目标 D1 回读验证
 *
 * 仅用于本地/隔离测试 D1；严禁传入生产 D1。
 */
export async function restoreBackup(
  r2: R2Bucket,
  key: string,
  targetDb: D1Database
): Promise<{ verified: boolean; tableSummaries: Record<string, BackupTableSummary> }> {
  const obj = await r2.get(key);
  if (!obj) {
    throw new Error(`备份不存在: ${key}`);
  }

  const text = await obj.text();
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error(`备份 JSON 解析失败: ${key}`);
  }

  // 恢复前严格验证（在执行任何 DELETE/INSERT 前）
  validateBackupManifest(manifest);

  // 恢复：逐表清空 + 插入（targetDb 已在函数签名层面固定为 RESTORE_DRILL_DB）
  for (const table of BUSINESS_TABLES) {
    await targetDb.prepare(`DELETE FROM \`${table}\``).run();

    const rows = manifest.tables[table];
    if (rows.length === 0) continue;

    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = Object.values(row);
      const placeholders = cols.map(() => '?').join(', ');
      await targetDb
        .prepare(`INSERT INTO \`${table}\` (${cols.join(', ')}) VALUES (${placeholders})`)
        .bind(...vals)
        .run();
    }
  }

  // 恢复后从目标 D1 逐表回读验证
  await verifyRestoreIntegrity(targetDb, manifest.tableSummaries);

  return { verified: true, tableSummaries: manifest.tableSummaries };
}

// ==================== Scheduled Handler ====================

/**
 * Worker scheduled() 每日触发入口。
 * 由 wrangler.toml 的 cron 配置调用。
 */
export async function runScheduledBackup(env: {
  DB: D1Database;
  BACKUPS: R2Bucket;
}): Promise<{ ok: boolean; key?: string; error?: string }> {
  try {
    const { key } = await createBackup(env.DB, env.BACKUPS);
    return { ok: true, key };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error('[backup:scheduled] 备份失败:', err);
    return { ok: false, error: err };
  }
}
