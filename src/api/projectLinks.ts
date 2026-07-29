// 项目关联资料 API handlers
import { D1Database } from '@cloudflare/workers-types';
import { generateId, now, createAuditEvent } from '../lib/db';
import type { ProjectLink } from '../types';

// URL 验证正则
const URL_REGEX = /^https?:\/\/.+/i;

export function isValidUrl(url: string): boolean {
  return URL_REGEX.test(url);
}

// 获取项目的所有关联资料
export async function listProjectLinks(
  db: D1Database,
  projectId: string
): Promise<ProjectLink[]> {
  const result = await db
    .prepare('SELECT * FROM project_links WHERE project_id = ? ORDER BY created_at ASC')
    .bind(projectId)
    .all<ProjectLink>();
  return result.results;
}

// 获取单个关联资料
export async function getProjectLink(
  db: D1Database,
  id: string
): Promise<ProjectLink | null> {
  const result = await db
    .prepare('SELECT * FROM project_links WHERE id = ?')
    .bind(id)
    .first<ProjectLink>();
  return result || null;
}

// 创建关联资料
export async function createProjectLink(
  db: D1Database,
  projectId: string,
  data: { title: string; url: string },
  actor: string = 'system'
): Promise<ProjectLink> {
  // 验证 URL
  if (!isValidUrl(data.url)) {
    throw new Error('URL 必须以 http:// 或 https:// 开头');
  }
  
  const id = generateId();
  const timestamp = now();
  
  // 获取项目信息用于审计
  const project = await db
    .prepare('SELECT portfolio_id, title FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ portfolio_id: string; title: string }>();
  
  if (!project) {
    throw new Error('项目不存在');
  }
  
  await db
    .prepare(`
      INSERT INTO project_links (id, project_id, title, url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(id, projectId, data.title, data.url, timestamp, timestamp)
    .run();
  
  await createAuditEvent(
    db,
    project.portfolio_id,
    actor,
    'create',
    'project_link',
    id,
    `创建关联资料：${data.title}`,
    JSON.stringify({ project: project.title, title: data.title, url: data.url })
  );
  
  return {
    id,
    project_id: projectId,
    title: data.title,
    url: data.url,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

// 更新关联资料
export async function updateProjectLink(
  db: D1Database,
  id: string,
  data: { title?: string; url?: string },
  actor: string = 'system'
): Promise<ProjectLink | null> {
  const existing = await getProjectLink(db, id);
  if (!existing) return null;
  
  // 验证 URL
  if (data.url !== undefined && !isValidUrl(data.url)) {
    throw new Error('URL 必须以 http:// 或 https:// 开头');
  }
  
  const updates: string[] = [];
  const values: (string | number)[] = [];
  
  if (data.title !== undefined) {
    updates.push('title = ?');
    values.push(data.title);
  }
  if (data.url !== undefined) {
    updates.push('url = ?');
    values.push(data.url);
  }
  
  if (updates.length === 0) return existing;
  
  updates.push('updated_at = ?');
  values.push(now());
  values.push(id);
  
  await db
    .prepare(`UPDATE project_links SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
  
  // 获取项目信息
  const project = await db
    .prepare('SELECT portfolio_id FROM projects WHERE id = ?')
    .bind(existing.project_id)
    .first<{ portfolio_id: string }>();
  
  await createAuditEvent(
    db,
    project?.portfolio_id,
    actor,
    'update',
    'project_link',
    id,
    `更新关联资料：${data.title || existing.title}`,
    JSON.stringify(data)
  );
  
  return getProjectLink(db, id);
}

// 删除关联资料
export async function deleteProjectLink(
  db: D1Database,
  id: string,
  actor: string = 'system'
): Promise<boolean> {
  const existing = await getProjectLink(db, id);
  if (!existing) return false;
  
  // 获取项目信息
  const project = await db
    .prepare('SELECT portfolio_id, title FROM projects WHERE id = ?')
    .bind(existing.project_id)
    .first<{ portfolio_id: string; title: string }>();
  
  await db.prepare('DELETE FROM project_links WHERE id = ?').bind(id).run();
  
  await createAuditEvent(
    db,
    project?.portfolio_id,
    actor,
    'delete',
    'project_link',
    id,
    `删除关联资料：${existing.title}`,
    JSON.stringify({ project: project?.title, title: existing.title })
  );
  
  return true;
}

// 获取项目的关联资料数量
export async function countProjectLinks(
  db: D1Database,
  projectId: string
): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM project_links WHERE project_id = ?')
    .bind(projectId)
    .first<{ count: number }>();
  return result?.count || 0;
}
