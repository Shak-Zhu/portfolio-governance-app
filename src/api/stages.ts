// Stage API handlers
import { D1Database } from '@cloudflare/workers-types';
import { generateId, now, createAuditEvent } from '../lib/db';
import type { Stage, CreateStageRequest } from '../types';

// 获取组合的所有 Stage
export async function listStages(db: D1Database, portfolioId: string): Promise<Stage[]> {
  const result = await db
    .prepare('SELECT * FROM stages WHERE portfolio_id = ? ORDER BY sort_order ASC')
    .bind(portfolioId)
    .all<Stage>();
  return result.results;
}

// 获取单个 Stage
export async function getStage(db: D1Database, id: string): Promise<Stage | null> {
  const result = await db
    .prepare('SELECT * FROM stages WHERE id = ?')
    .bind(id)
    .first<Stage>();
  return result || null;
}

// 创建 Stage
export async function createStage(
  db: D1Database,
  portfolioId: string,
  data: CreateStageRequest,
  actor: string = 'system'
): Promise<Stage> {
  const id = generateId();
  const timestamp = now();
  
  // 获取当前最大 sort_order
  const maxOrder = await db
    .prepare('SELECT MAX(sort_order) as max_order FROM stages WHERE portfolio_id = ?')
    .bind(portfolioId)
    .first<{ max_order: number | null }>();
  
  const sortOrder = (maxOrder?.max_order ?? 0) + 1;
  
  await db
    .prepare(`
      INSERT INTO stages (id, portfolio_id, name, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(id, portfolioId, data.name, sortOrder, timestamp)
    .run();
  
  await createAuditEvent(
    db,
    portfolioId,
    actor,
    'create',
    'stage',
    id,
    `创建 Stage：${data.name}`
  );
  
  return {
    id,
    portfolio_id: portfolioId,
    name: data.name,
    sort_order: sortOrder,
    created_at: timestamp,
  };
}

// 更新 Stage（受控迁移）
export async function updateStage(
  db: D1Database,
  id: string,
  name: string,
  actor: string = 'system'
): Promise<{ success: boolean; stage?: Stage | null; message?: string }> {
  const existing = await getStage(db, id);
  if (!existing) {
    return { success: false, message: 'Stage 不存在' };
  }
  
  // 检查是否有项目（活动或归档）正在使用此 Stage
  const usage = await db
    .prepare('SELECT COUNT(*) as count FROM projects WHERE stage = ?')
    .bind(existing.name)
    .first<{ count: number }>();
  
  if (usage && usage.count > 0) {
    return {
      success: false,
      message: `Stage "${existing.name}" 已被 ${usage.count} 个项目使用，禁止改名。请先修改项目或删除未使用的 Stage。`,
    };
  }
  
  await db
    .prepare('UPDATE stages SET name = ? WHERE id = ?')
    .bind(name, id)
    .run();
  
  await createAuditEvent(
    db,
    existing.portfolio_id,
    actor,
    'update',
    'stage',
    id,
    `更新 Stage：${existing.name} → ${name}`
  );
  
  const updated = await getStage(db, id);
  return { success: true, stage: updated };
}

// 删除 Stage（受控迁移）
export async function deleteStage(
  db: D1Database,
  id: string,
  actor: string = 'system'
): Promise<{ success: boolean; message: string }> {
  const existing = await getStage(db, id);
  if (!existing) {
    return { success: false, message: 'Stage 不存在' };
  }
  
  // 检查是否有项目（活动或归档）正在使用此 Stage
  const usage = await db
    .prepare('SELECT COUNT(*) as count FROM projects WHERE stage = ?')
    .bind(existing.name)
    .first<{ count: number }>();
  
  if (usage && usage.count > 0) {
    return {
      success: false,
      message: `Stage "${existing.name}" 已被 ${usage.count} 个项目使用，无法删除`,
    };
  }
  
  await db.prepare('DELETE FROM stages WHERE id = ?').bind(id).run();
  
  await createAuditEvent(
    db,
    existing.portfolio_id,
    actor,
    'delete',
    'stage',
    id,
    `删除 Stage：${existing.name}`
  );
  
  return { success: true, message: 'Stage 已删除' };
}

// 检查 Stage 是否被任何项目使用（活动或归档）
export async function isStageInUse(
  db: D1Database,
  stageName: string
): Promise<boolean> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM projects WHERE stage = ?')
    .bind(stageName)
    .first<{ count: number }>();
  
  return (result?.count || 0) > 0;
}
