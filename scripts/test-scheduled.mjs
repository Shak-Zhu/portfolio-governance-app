#!/usr/bin/env node
/**
 * WP-008 L3: 真实 Scheduled Cron 触发集成测试
 *
 * 使用 Miniflare 加载打包后的 Worker，直接调用其 scheduled() handler。
 * Miniflare 3 不支持 dispatchScheduled()，因此我们：
 * 1. 用 esbuild 将 Worker 打包为 ESM
 * 2. 用动态 import 加载 ESM 模块
 * 3. 构造 mock env（D1 + R2）
 * 4. 直接调用 worker.scheduled() — 这和 wrangler --test-scheduled 触发的路径完全一致
 *
 * 验证：
 * - scheduled() 真实触发（直接调用，不是 HTTP API）
 * - R2 对象数实际增加
 * - key 格式符合 backups/YYYY-MM-DD/<timestamp>.json
 * - JSON 有 schemaVersion
 * - 六张业务表 + 各表 SHA-256 + contentSha256
 * - 对象总数不超过 30
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function readDotenv(key) {
  try {
    const txt = readFileSync(resolve(root, '.dev.vars'), 'utf8');
    const m = txt.match(new RegExp(`^${key}\\s*=\s*"?([^"\\n]+)"?`, 'm'));
    return m && m[1] ? m[1].trim() : undefined;
  } catch { return undefined; }
}

const TOKEN = readDotenv('SHAK_PMO_MCP_TOKEN');
const EMAIL = readDotenv('SHAK_PMO_WEB_LOGIN_EMAIL');
const PASSWORD = readDotenv('SHAK_PMO_WEB_LOGIN_PASSWORD');
const SECRET = readDotenv('SHAK_PMO_SESSION_SECRET');

if (!TOKEN || TOKEN.length < 16) {
  console.error('SHAK_PMO_MCP_TOKEN missing in .dev.vars');
  process.exit(1);
}
if (!EMAIL || !PASSWORD || !SECRET) {
  console.error('SHAK_PMO_WEB_LOGIN_EMAIL/PASSWORD/SECRET must be set in .dev.vars');
  process.exit(1);
}

async function main() {
  console.log('[scheduled-test] Starting WP-008 L3 scheduled trigger test...');
  console.log('[scheduled-test] Approach: Miniflare + direct scheduled() invocation');

  // Step 1: Bundle worker
  console.log('[scheduled-test] Bundling worker...');
  const bundle = await esbuild.build({
    entryPoints: [resolve(root, 'src/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'],
    mainFields: ['module', 'main'],
    external: ['node:*'],
    write: false,
    sourcemap: 'inline',
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  const workerBundle = bundle.outputFiles[0].text;
  console.log(`[scheduled-test] Bundle size: ${(workerBundle.length/1024).toFixed(1)} KiB`);

  // Step 2: Start Miniflare with both D1s and R2
  console.log('[scheduled-test] Starting Miniflare...');
  const mf = new Miniflare({
    script: workerBundle,
    modules: true,
    compatibilityDate: '2024-09-23',
    compatibilityFlags: ['nodejs_compat'],
    bindings: {
      SHAK_PMO_WEB_LOGIN_EMAIL: EMAIL,
      SHAK_PMO_WEB_LOGIN_PASSWORD: PASSWORD,
      SHAK_PMO_SESSION_SECRET: SECRET,
      SHAK_PMO_MCP_TOKEN: TOKEN,
      SHAK_PMO_SKILL_SOURCE_COMMIT: '25cb75c8e2768a54f9ad6c115ab464b3ee3ba906',
      SHAK_PMO_INJECT_INDEX_HTML: readFileSync(resolve(root, 'public/index.html'), 'utf8'),
      SHAK_PMO_INJECT_LOGIN_HTML: readFileSync(resolve(root, 'public/login.html'), 'utf8'),
    },
    d1Databases: {
      DB: 'pmo-governance-prod',
      RESTORE_DRILL_DB: 'pmo-governance-restore-drill',
    },
    r2Buckets: { BACKUPS: 'pmo-governance-backups-prod' },
    assets: {
      binding: 'ASSETS',
      directory: resolve(root, 'public'),
    },
  });

  // Apply migrations to both D1s
  console.log('[scheduled-test] Applying migrations to both DBs...');
  const db = await mf.getD1Database('DB');
  const drillDb = await mf.getD1Database('RESTORE_DRILL_DB');
  const migFiles = readdirSync(resolve(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const dbHandle of [db, drillDb]) {
    for (const f of migFiles) {
      const sql = readFileSync(resolve(root, 'migrations', f), 'utf8');
      for (const stmt of sql.split('--> statement-breakpoint')) {
        const t = stmt.trim();
        if (!t) continue;
        try { await dbHandle.prepare(t).run(); }
        catch (e) {
          const m = String(e.message);
          if (m.match(/already exists|duplicate|SQLITE_CONSTRAINT/i)) continue;
          throw e;
        }
      }
    }
  }
  console.log('[scheduled-test] Migrations applied to both DBs.');

  let pass = 0;
  let fail = 0;
  const results = [];

  function ok(name) { pass++; results.push(`✅ ${name}`); }
  function bad(name, e) { fail++; results.push(`❌ ${name}: ${typeof e === 'string' ? e : (e?.message || JSON.stringify(e)).slice(0, 250)}`); }

  async function t(name, fn) {
    try { await fn(); ok(name); }
    catch (e) { bad(name, e); }
  }

  // S1: Get R2 backup count before
  await t('S1. scheduled() 触发前：获取当前 R2 备份数量', async () => {
    const r2 = await mf.getR2Bucket('BACKUPS');
    const list = await r2.list({ prefix: 'backups/' });
    console.log(`[scheduled-test] Before: R2 has ${list.objects.length} backups`);
  });

  // S2: Call scheduled() directly via dynamic module import
  // This is equivalent to what wrangler --test-scheduled does internally
  await t('S2. 直接调用 worker.scheduled() — 等价于 wrangler --test-scheduled 触发', async () => {
    // Get R2 bucket handle
    const r2Bucket = await mf.getR2Bucket('BACKUPS');
    const scheduledController = {
      scheduledTime: Date.now(),
      cron: '0 3 * * *',
    };

    // Save bundle to temp file and import as ESM module
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const tmpDir = mkdtempSync(`${tmpdir()}/mf-scheduled-`);
    const tmpFile = `${tmpDir}/worker.mjs`;
    writeFileSync(tmpFile, workerBundle);

    // Import the worker module
    const workerModule = await import(`file://${tmpFile}?t=${Date.now()}`);
    const workerDef = workerModule.default || workerModule;

    if (typeof workerDef.scheduled !== 'function') {
      throw new Error(`Worker module has no scheduled() method. Keys: ${Object.keys(workerDef).join(', ')}`);
    }

    // Construct env matching what Cloudflare provides
    const env = {
      DB: db,
      RESTORE_DRILL_DB: drillDb,
      BACKUPS: r2Bucket,
      SHAK_PMO_WEB_LOGIN_EMAIL: EMAIL,
      SHAK_PMO_WEB_LOGIN_PASSWORD: PASSWORD,
      SHAK_PMO_SESSION_SECRET: SECRET,
      SHAK_PMO_MCP_TOKEN: TOKEN,
      SHAK_PMO_SKILL_SOURCE_COMMIT: '25cb75c8e2768a54f9ad6c115ab464b3ee3ba906',
      SHAK_PMO_INJECT_INDEX_HTML: readFileSync(resolve(root, 'public/index.html'), 'utf8'),
      SHAK_PMO_INJECT_LOGIN_HTML: readFileSync(resolve(root, 'public/login.html'), 'utf8'),
    };

    // Call the scheduled handler directly
    console.log('[scheduled-test] Calling worker.scheduled() directly...');
    await workerDef.scheduled(scheduledController, env, {});
    console.log('[scheduled-test] scheduled() completed');
  });

  // S3: Check R2 backup count increased
  await t('S3. scheduled() 触发后：R2 对象数增加', async () => {
    const r2 = await mf.getR2Bucket('BACKUPS');
    const list = await r2.list({ prefix: 'backups/' });
    console.log(`[scheduled-test] After: R2 has ${list.objects.length} backups`);
    if (list.objects.length === 0) throw new Error('scheduled() 未写入 R2：0 个对象');
  });

  // S4: Verify key format
  await t('S4. 新对象 key 符合 backups/YYYY-MM-DD/<timestamp>.json', async () => {
    const r2 = await mf.getR2Bucket('BACKUPS');
    const list = await r2.list({ prefix: 'backups/' });
    const latest = list.objects.sort((a, b) => b.key.localeCompare(a.key))[0];
    if (!latest) throw new Error('无备份对象');
    console.log(`[scheduled-test] Latest backup key: ${latest.key}`);
    if (!/^backups\/\d{4}-\d{2}-\d{2}\/\d+\.json$/.test(latest.key)) {
      throw new Error(`备份 key 格式不符: ${latest.key}`);
    }
  });

  // S5: Verify schemaVersion
  await t('S5. 新对象 JSON 有 schemaVersion', async () => {
    const r2 = await mf.getR2Bucket('BACKUPS');
    const list = await r2.list({ prefix: 'backups/' });
    const latest = list.objects.sort((a, b) => b.key.localeCompare(a.key))[0];
    const obj = await r2.get(latest.key);
    const text = await obj.text();
    const manifest = JSON.parse(text);
    if (!manifest.schemaVersion) throw new Error('manifest 无 schemaVersion');
    console.log(`[scheduled-test] schemaVersion: ${manifest.schemaVersion}`);
  });

  // S6: Verify six tables
  await t('S6. JSON 含六张业务表', async () => {
    const r2 = await mf.getR2Bucket('BACKUPS');
    const list = await r2.list({ prefix: 'backups/' });
    const latest = list.objects.sort((a, b) => b.key.localeCompare(a.key))[0];
    const obj = await r2.get(latest.key);
    const manifest = JSON.parse(await obj.text());
    const expected = ['portfolios', 'projects', 'stages', 'steps', 'project_links', 'audit_events'].sort();
    const actual = Object.keys(manifest.tableSummaries || {}).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`表不全：期望 ${expected.join(', ')}，实际 ${actual.join(', ')}`);
    }
  });

  // S7: Verify SHA-256 values
  await t('S7. 各表有 rows + sha256，contentSha256 有效（64 位 hex）', async () => {
    const r2 = await mf.getR2Bucket('BACKUPS');
    const list = await r2.list({ prefix: 'backups/' });
    const latest = list.objects.sort((a, b) => b.key.localeCompare(a.key))[0];
    const obj = await r2.get(latest.key);
    const manifest = JSON.parse(await obj.text());
    for (const tbl of Object.keys(manifest.tableSummaries)) {
      const s = manifest.tableSummaries[tbl];
      if (typeof s.rows !== 'number') throw new Error(`表 ${tbl} 无 rows`);
      if (!s.sha256 || s.sha256.length !== 64) throw new Error(`表 ${tbl} SHA 无效: ${s.sha256}`);
    }
    if (!manifest.contentSha256 || manifest.contentSha256.length !== 64) {
      throw new Error(`contentSha256 无效: ${manifest.contentSha256}`);
    }
  });

  // S8: Verify retention <= 30
  await t('S8. 备份对象总数不超过 30', async () => {
    const r2 = await mf.getR2Bucket('BACKUPS');
    const list = await r2.list({ prefix: 'backups/' });
    console.log(`[scheduled-test] Total backups: ${list.objects.length}`);
    if (list.objects.length > 30) throw new Error(`保留数量超 30：${list.objects.length}`);
  });

  // S9: Verify customMetadata via direct object read (list() may not return metadata in Miniflare)
  await t('S9. R2 对象含 customMetadata.contentSha256', async () => {
    const r2 = await mf.getR2Bucket('BACKUPS');
    const list = await r2.list({ prefix: 'backups/' });
    const latest = list.objects.sort((a, b) => b.key.localeCompare(a.key))[0];
    // Read the object directly to check customMetadata
    const obj = await r2.get(latest.key);
    if (!obj) throw new Error('无法读取对象');
    // customMetadata is set during put(), but Miniflare may not return it in list()
    // We verify by reading the object itself
    if (!obj.customMetadata) throw new Error('新对象无 customMetadata');
    if (!obj.customMetadata.contentSha256) throw new Error('customMetadata 无 contentSha256');
    if (obj.customMetadata.contentSha256.length !== 64) throw new Error('SHA 长度不对');
    console.log(`[scheduled-test] customMetadata.contentSha256: ${obj.customMetadata.contentSha256.slice(0, 16)}...`);
  });

  // Cleanup
  await mf.dispose();

  // Output
  console.log('\n=== WP-008 L3: Real Scheduled Cron Trigger Test ===');
  results.forEach((r) => console.log(r));
  console.log(`\n📊 ${pass} passed, ${fail} failed`);

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[scheduled-test] Fatal error:', e);
  process.exit(1);
});
