// 步骤（Step）API handlers
import { D1Database } from '@cloudflare/workers-types';
import { generateId, now, createAuditEvent, isValidDate } from '../lib/db';
import type { Step, CreateStepRequest, UpdateStepRequest } from '../types';

// 获取项目的所有步骤
export async function listSteps(db: D1Database, projectId: string): Promise<Step[]> {
  const result = await db
    .prepare('SELECT * FROM steps WHERE project_id = ? ORDER BY sort_order ASC')
    .bind(projectId)
    .all<Step>();
  return result.results;
}

// 获取组合下所有项目的步骤
export async function listAllSteps(
  db: D1Database,
  portfolioId: string
): Promise<Step[]> {
  const result = await db
    .prepare(`
      SELECT s.* FROM steps s
      JOIN projects p ON s.project_id = p.id
      WHERE p.portfolio_id = ? AND p.is_archived = 0
      ORDER BY s.sort_order ASC
    `)
    .bind(portfolioId)
    .all<Step>();
  return result.results;
}

// 获取单个步骤
export async function getStep(db: D1Database, id: string): Promise<Step | null> {
  const result = await db
    .prepare('SELECT * FROM steps WHERE id = ?')
    .bind(id)
    .first<Step>();
  return result || null;
}

// 创建步骤
export async function createStep(
  db: D1Database,
  projectId: string,
  data: CreateStepRequest,
  actor: string = 'system'
): Promise<Step> {
  const id = generateId();
  const timestamp = now();
  
  // 验证日期格式
  if (data.start_date && !isValidDate(data.start_date)) {
    throw new Error('开始日期格式无效');
  }
  if (data.end_date && !isValidDate(data.end_date)) {
    throw new Error('结束日期格式无效');
  }
  
  // 获取项目信息用于审计
  const project = await db
    .prepare('SELECT portfolio_id, title FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ portfolio_id: string; title: string }>();
  
  if (!project) {
    throw new Error('项目不存在');
  }
  
  // 获取当前最大 sort_order
  const maxOrder = await db
    .prepare('SELECT MAX(sort_order) as max_order FROM steps WHERE project_id = ?')
    .bind(projectId)
    .first<{ max_order: number | null }>();
  
  const sortOrder = (maxOrder?.max_order ?? -1) + 1;
  const status = data.status || (!data.start_date || !data.end_date ? 'tbd' : 'planned');
  
  await db
    .prepare(`
      INSERT INTO steps (id, project_id, name, start_date, end_date, status, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      projectId,
      data.name,
      data.start_date || null,
      data.end_date || null,
      status,
      sortOrder,
      timestamp,
      timestamp
    )
    .run();
  
  await createAuditEvent(
    db,
    project.portfolio_id,
    actor,
    'create',
    'step',
    id,
    `创建步骤：${data.name}`,
    JSON.stringify({ project: project.title, ...data })
  );
  
  return {
    id,
    project_id: projectId,
    name: data.name,
    start_date: data.start_date,
    end_date: data.end_date,
    status: status as Step['status'],
    sort_order: sortOrder,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

// 更新步骤
export async function updateStep(
  db: D1Database,
  id: string,
  data: UpdateStepRequest,
  actor: string = 'system'
): Promise<Step | null> {
  const existing = await getStep(db, id);
  if (!existing) return null;
  
  // 验证日期格式
  if (data.start_date && !isValidDate(data.start_date)) {
    throw new Error('开始日期格式无效');
  }
  if (data.end_date && !isValidDate(data.end_date)) {
    throw new Error('结束日期格式无效');
  }
  
  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  
  if (data.name !== undefined) {
    updates.push('name = ?');
    values.push(data.name);
  }
  if (data.start_date !== undefined) {
    updates.push('start_date = ?');
    values.push(data.start_date || null);
  }
  if (data.end_date !== undefined) {
    updates.push('end_date = ?');
    values.push(data.end_date || null);
  }
  if (data.status !== undefined) {
    updates.push('status = ?');
    values.push(data.status);
  }
  if (data.sort_order !== undefined) {
    updates.push('sort_order = ?');
    values.push(data.sort_order);
  }
  
  if (updates.length === 0) return existing;
  
  // 自动调整状态（仅当调用方未显式指定 status 时）：
  // - 日期被补齐（新开始+结束都合法）且原为 tbd -> planned，进入日期轴
  // - 任一日期被清空/缺失（含空串）-> tbd，回到未排期工作包区
  // 注意：空串 '' 也代表“清空日期”，必须用 !== undefined 判断字段是否被触及。
  const touchesDates = data.start_date !== undefined || data.end_date !== undefined;
  if (touchesDates && data.status === undefined) {
    const newStartDate = data.start_date !== undefined ? (data.start_date || null) : (existing.start_date || null);
    const newEndDate = data.end_date !== undefined ? (data.end_date || null) : (existing.end_date || null);
    if (newStartDate && newEndDate) {
      if (existing.status === 'tbd') {
        updates.push('status = ?');
        values.push('planned');
      }
    } else {
      updates.push('status = ?');
      values.push('tbd');
    }
  }
  
  updates.push('updated_at = ?');
  values.push(now());
  values.push(id);
  
  await db
    .prepare(`UPDATE steps SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
  
  // 获取项目信息
  const project = await db
    .prepare('SELECT portfolio_id FROM projects WHERE id = ?')
    .bind(existing.project_id)
    .first<{ portfolio_id: string }>();
  
  const summary = Object.keys(data).map(k => `${k}: ${data[k as keyof UpdateStepRequest]}`).join(', ');
  await createAuditEvent(
    db,
    project?.portfolio_id,
    actor,
    'update',
    'step',
    id,
    `更新步骤：${summary}`,
    JSON.stringify(data)
  );
  
  return getStep(db, id);
}

// 删除步骤
export async function deleteStep(
  db: D1Database,
  id: string,
  actor: string = 'system'
): Promise<boolean> {
  const existing = await getStep(db, id);
  if (!existing) return false;
  
  // 获取项目信息
  const project = await db
    .prepare('SELECT portfolio_id FROM projects WHERE id = ?')
    .bind(existing.project_id)
    .first<{ portfolio_id: string }>();
  
  await db.prepare('DELETE FROM steps WHERE id = ?').bind(id).run();
  
  await createAuditEvent(
    db,
    project?.portfolio_id,
    actor,
    'delete',
    'step',
    id,
    `删除步骤：${existing.name}`
  );
  
  return true;
}

// 批量删除项目的步骤
export async function deleteStepsByProject(
  db: D1Database,
  projectId: string,
  actor: string = 'system'
): Promise<number> {
  const steps = await listSteps(db, projectId);
  const count = steps.length;
  
  // 获取项目信息
  const project = await db
    .prepare('SELECT portfolio_id FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ portfolio_id: string }>();
  
  await db.prepare('DELETE FROM steps WHERE project_id = ?').bind(projectId).run();
  
  if (count > 0) {
    await createAuditEvent(
      db,
      project?.portfolio_id,
      actor,
      'delete',
      'step',
      projectId,
      `批量删除项目步骤：${count} 个步骤`
    );
  }
  
  return count;
}
