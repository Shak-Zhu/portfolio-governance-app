// 数据库工具函数
import { D1Database } from '@cloudflare/workers-types';

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export function now(): number {
  return Date.now();
}

// 审计记录辅助函数
export async function createAuditEvent(
  db: D1Database,
  portfolioId: string | null,
  actor: string,
  action: string,
  objectType: string,
  objectId: string,
  summary?: string,
  details?: string
): Promise<void> {
  const id = generateId();
  const createdAt = now();
  
  await db
    .prepare(`
      INSERT INTO audit_events (id, portfolio_id, actor, action, object_type, object_id, summary, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(id, portfolioId, actor, action, objectType, objectId, summary || null, details || null, createdAt)
    .run();
}

// 验证步骤状态
export function validateStepStatus(status: string): boolean {
  return ['done', 'planned', 'risk', 'blocked', 'tbd'].includes(status);
}

// 验证项目健康状态
export function validateHealth(health: string): boolean {
  return ['green', 'blue', 'amber', 'red', 'unknown'].includes(health);
}

// 验证日期格式
export function isValidDate(dateStr: string): boolean {
  if (!dateStr) return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date.getTime());
}

// 日期比较
export function compareDates(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime();
}
