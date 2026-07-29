// 审计事件 API handlers
import { D1Database } from '@cloudflare/workers-types';
import type { AuditEvent } from '../types';

// 获取组合的审计事件
export async function listAuditEvents(
  db: D1Database,
  portfolioId: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ events: AuditEvent[]; total: number }> {
  const countResult = await db
    .prepare('SELECT COUNT(*) as total FROM audit_events WHERE portfolio_id = ?')
    .bind(portfolioId)
    .first<{ total: number }>();
  
  const result = await db
    .prepare(`
      SELECT * FROM audit_events 
      WHERE portfolio_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)
    .bind(portfolioId, limit, offset)
    .all<AuditEvent>();
  
  return {
    events: result.results,
    total: countResult?.total || 0,
  };
}

// 获取对象的审计历史
export async function getAuditHistory(
  db: D1Database,
  objectType: string,
  objectId: string,
  limit: number = 20
): Promise<AuditEvent[]> {
  const result = await db
    .prepare(`
      SELECT * FROM audit_events 
      WHERE object_type = ? AND object_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .bind(objectType, objectId, limit)
    .all<AuditEvent>();
  
  return result.results;
}

// 获取最近的所有审计事件
export async function getRecentAuditEvents(
  db: D1Database,
  portfolioId: string,
  hours: number = 24
): Promise<AuditEvent[]> {
  const since = Date.now() - hours * 60 * 60 * 1000;
  
  const result = await db
    .prepare(`
      SELECT * FROM audit_events 
      WHERE portfolio_id = ? AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT 100
    `)
    .bind(portfolioId, since)
    .all<AuditEvent>();
  
  return result.results;
}
