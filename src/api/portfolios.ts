// 组合（Portfolio）API handlers
import { D1Database } from '@cloudflare/workers-types';
import { generateId, now, createAuditEvent } from '../lib/db';
import type { Portfolio, CreatePortfolioRequest, UpdatePortfolioRequest } from '../types';

// 获取所有组合
export async function listPortfolios(db: D1Database): Promise<Portfolio[]> {
  const result = await db
    .prepare('SELECT * FROM portfolios ORDER BY created_at DESC')
    .all<Portfolio>();
  return result.results;
}

// 获取单个组合
export async function getPortfolio(db: D1Database, id: string): Promise<Portfolio | null> {
  const result = await db
    .prepare('SELECT * FROM portfolios WHERE id = ?')
    .bind(id)
    .first<Portfolio>();
  return result || null;
}

// 创建组合
export async function createPortfolio(
  db: D1Database,
  data: CreatePortfolioRequest,
  actor: string = 'system'
): Promise<Portfolio> {
  const id = generateId();
  const timestamp = now();
  
  await db
    .prepare(`
      INSERT INTO portfolios (id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(id, data.name, data.description || null, timestamp, timestamp)
    .run();
  
  await createAuditEvent(
    db,
    id,
    actor,
    'create',
    'portfolio',
    id,
    `创建组合：${data.name}`
  );
  
  return {
    id,
    name: data.name,
    description: data.description,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

// 更新组合
export async function updatePortfolio(
  db: D1Database,
  id: string,
  data: UpdatePortfolioRequest,
  actor: string = 'system'
): Promise<Portfolio | null> {
  const existing = await getPortfolio(db, id);
  if (!existing) return null;
  
  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  
  if (data.name !== undefined) {
    updates.push('name = ?');
    values.push(data.name);
  }
  if (data.description !== undefined) {
    updates.push('description = ?');
    values.push(data.description);
  }
  
  if (updates.length === 0) return existing;
  
  updates.push('updated_at = ?');
  values.push(now());
  values.push(id);
  
  await db
    .prepare(`UPDATE portfolios SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
  
  const summary = Object.keys(data).map(k => `${k}: ${data[k as keyof UpdatePortfolioRequest]}`).join(', ');
  await createAuditEvent(db, id, actor, 'update', 'portfolio', id, `更新组合：${summary}`);
  
  return getPortfolio(db, id);
}

// 删除组合
export async function deletePortfolio(
  db: D1Database,
  id: string,
  actor: string = 'system'
): Promise<boolean> {
  const existing = await getPortfolio(db, id);
  if (!existing) return false;
  
  await db.prepare('DELETE FROM portfolios WHERE id = ?').bind(id).run();
  
  await createAuditEvent(
    db,
    null,
    actor,
    'delete',
    'portfolio',
    id,
    `删除组合：${existing.name}`
  );
  
  return true;
}
