// 项目（Project）API handlers
import { D1Database } from '@cloudflare/workers-types';
import { generateId, now, createAuditEvent } from '../lib/db';
import type { Project, CreateProjectRequest, UpdateProjectRequest } from '../types';

// 获取组合下的所有项目
export async function listProjects(
  db: D1Database,
  portfolioId: string,
  includeArchived: boolean = false
): Promise<Project[]> {
  let query = 'SELECT * FROM projects WHERE portfolio_id = ?';
  if (!includeArchived) {
    query += ' AND is_archived = 0';
  }
  query += ' ORDER BY created_at ASC';
  
  const result = await db
    .prepare(query)
    .bind(portfolioId)
    .all<Project>();
  return result.results;
}

// 获取单个项目
export async function getProject(db: D1Database, id: string): Promise<Project | null> {
  const result = await db
    .prepare('SELECT * FROM projects WHERE id = ?')
    .bind(id)
    .first<Project>();
  return result || null;
}

// 创建项目
export async function createProject(
  db: D1Database,
  portfolioId: string,
  data: CreateProjectRequest,
  actor: string = 'system'
): Promise<Project> {
  const id = generateId();
  const timestamp = now();
  
  await db
    .prepare(`
      INSERT INTO projects (id, portfolio_id, parent_id, title, owner, stage, health, expectation, risk, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `)
    .bind(
      id,
      portfolioId,
      data.parent_id || null,
      data.title,
      data.owner,
      data.stage || null,
      data.health || 'unknown',
      data.expectation || null,
      data.risk || null,
      timestamp,
      timestamp
    )
    .run();
  
  await createAuditEvent(
    db,
    portfolioId,
    actor,
    'create',
    'project',
    id,
    `创建项目：${data.title}`,
    JSON.stringify(data)
  );
  
  return {
    id,
    portfolio_id: portfolioId,
    parent_id: data.parent_id,
    title: data.title,
    owner: data.owner,
    stage: data.stage,
    health: (data.health || 'unknown') as Project['health'],
    expectation: data.expectation,
    risk: data.risk,
    gate: 'open',
    status: 'active',
    is_archived: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

// 更新项目
export async function updateProject(
  db: D1Database,
  id: string,
  data: UpdateProjectRequest,
  actor: string = 'system'
): Promise<Project | null> {
  const existing = await getProject(db, id);
  if (!existing) return null;
  
  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  
  if (data.parent_id !== undefined) {
    updates.push('parent_id = ?');
    values.push(data.parent_id);
  }
  if (data.title !== undefined) {
    updates.push('title = ?');
    values.push(data.title);
  }
  if (data.owner !== undefined) {
    updates.push('owner = ?');
    values.push(data.owner);
  }
  if (data.stage !== undefined) {
    updates.push('stage = ?');
    values.push(data.stage);
  }
  if (data.health !== undefined) {
    updates.push('health = ?');
    values.push(data.health);
  }
  if (data.expectation !== undefined) {
    updates.push('expectation = ?');
    values.push(data.expectation);
  }
  if (data.risk !== undefined) {
    updates.push('risk = ?');
    values.push(data.risk);
  }
  if (data.gate !== undefined) {
    updates.push('gate = ?');
    values.push(data.gate);
  }
  if (data.status !== undefined) {
    updates.push('status = ?');
    values.push(data.status);
    if (data.status === 'completed') {
      updates.push('updated_at = ?');
      values.push(now());
    }
  }
  
  if (updates.length === 0) return existing;
  
  updates.push('updated_at = ?');
  values.push(now());
  values.push(id);
  
  await db
    .prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
  
  const summary = Object.keys(data).map(k => `${k}: ${data[k as keyof UpdateProjectRequest]}`).join(', ');
  await createAuditEvent(db, existing.portfolio_id, actor, 'update', 'project', id, `更新项目：${summary}`, JSON.stringify(data));
  
  return getProject(db, id);
}

// 删除项目
export async function deleteProject(
  db: D1Database,
  id: string,
  actor: string = 'system'
): Promise<boolean> {
  const existing = await getProject(db, id);
  if (!existing) return false;
  
  // 检查是否有子项目
  const children = await db
    .prepare('SELECT id FROM projects WHERE parent_id = ? AND is_archived = 0')
    .bind(id)
    .all();
  
  if (children.results.length > 0) {
    throw new Error('无法删除：有未归档的子项目');
  }
  
  await db.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
  
  await createAuditEvent(
    db,
    existing.portfolio_id,
    actor,
    'delete',
    'project',
    id,
    `删除项目：${existing.title}`
  );
  
  return true;
}

// 归档项目（整体归档规则）
export async function archiveProject(
  db: D1Database,
  id: string,
  actor: string = 'system'
): Promise<{ success: boolean; message: string }> {
  const project = await getProject(db, id);
  if (!project) {
    return { success: false, message: '项目不存在' };
  }
  
  // 必须是顶级项目（没有父项目）
  if (project.parent_id) {
    return { success: false, message: '子项目不可单独归档，只能归档顶级项目' };
  }
  
  // 检查所有后代项目是否都已完成
  const descendants = await getAllDescendants(db, id);
  const incompleteDescendants = descendants.filter(d => d.status !== 'completed' && d.is_archived === 0);
  
  if (incompleteDescendants.length > 0) {
    const titles = incompleteDescendants.map(d => d.title).join('、');
    return {
      success: false,
      message: `后代项目未全部完成，无法归档：${titles}`,
    };
  }
  
  const timestamp = now();
  
  // 归档顶级项目
  await db
    .prepare('UPDATE projects SET is_archived = 1, archived_at = ?, updated_at = ? WHERE id = ?')
    .bind(timestamp, timestamp, id)
    .run();
  
  // 归档所有后代项目
  for (const descendant of descendants) {
    await db
      .prepare('UPDATE projects SET is_archived = 1, archived_at = ?, updated_at = ? WHERE id = ?')
      .bind(timestamp, timestamp, descendant.id)
      .run();
  }
  
  await createAuditEvent(
    db,
    project.portfolio_id,
    actor,
    'archive',
    'project',
    id,
    `整体归档项目及其后代：${project.title}`
  );
  
  return { success: true, message: '项目及后代已归档' };
}

// 获取项目的所有后代
async function getAllDescendants(db: D1Database, parentId: string): Promise<Project[]> {
  const descendants: Project[] = [];
  const queue: string[] = [parentId];
  
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = await db
      .prepare('SELECT * FROM projects WHERE parent_id = ?')
      .bind(currentId)
      .all<Project>();
    
    for (const child of children.results) {
      descendants.push(child);
      queue.push(child.id);
    }
  }
  
  return descendants;
}

// 完成项目
export async function completeProject(
  db: D1Database,
  id: string,
  actor: string = 'system'
): Promise<Project | null> {
  const project = await getProject(db, id);
  if (!project) return null;
  
  const timestamp = now();
  
  await db
    .prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?')
    .bind('completed', timestamp, id)
    .run();
  
  await createAuditEvent(
    db,
    project.portfolio_id,
    actor,
    'complete',
    'project',
    id,
    `标记完成：${project.title}`
  );
  
  return getProject(db, id);
}

// 获取项目的统计信息（仅统计顶级项目：parent_id IS NULL）
// 子项目仍在项目主数据、甘特、归档明细和所有 list_* 结果中显示，
// 只是不计入首页四项组合 KPI 卡。
export async function getProjectStats(
  db: D1Database,
  portfolioId: string
): Promise<{
  total: number;
  active: number;
  completed: number;
  archived: number;
}> {
  const stats = await db
    .prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_archived = 0 AND status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN is_archived = 0 AND status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN is_archived = 1 THEN 1 ELSE 0 END) as archived
      FROM projects
      WHERE portfolio_id = ?
        AND parent_id IS NULL
    `)
    .bind(portfolioId)
    .first<{ total: number; active: number; completed: number; archived: number }>();

  return {
    total: stats?.total || 0,
    active: stats?.active || 0,
    completed: stats?.completed || 0,
    archived: stats?.archived || 0,
  };
}
