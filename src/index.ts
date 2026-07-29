// Cloudflare Worker 主入口
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { D1Database, R2Bucket, Fetcher } from '@cloudflare/workers-types';

import * as portfolios from './api/portfolios';
import * as projects from './api/projects';
import * as steps from './api/steps';
import * as stages from './api/stages';
import * as audit from './api/audit';
import * as projectLinks from './api/projectLinks';
import { buildGanttData, calculateGanttBars } from './lib/gantt';

interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  ASSETS: Fetcher;
}

const app = new Hono<{ Bindings: Env }>();

// 中间件
app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// 通用错误处理
function handleError(error: unknown): Response {
  const message = error instanceof Error ? error.message : '未知错误';
  console.error('API Error:', message);
  return Response.json({ error: message }, { status: 500 });
}

// ========== 组合 API ==========

// GET /api/portfolios - 列出所有组合
app.get('/api/portfolios', async (c) => {
  try {
    const results = await portfolios.listPortfolios(c.env.DB);
    return Response.json(results);
  } catch (e) {
    return handleError(e);
  }
});

// GET /api/portfolios/:id - 获取单个组合
app.get('/api/portfolios/:id', async (c) => {
  try {
    const portfolio = await portfolios.getPortfolio(c.env.DB, c.req.param('id'));
    if (!portfolio) {
      return Response.json({ error: '组合不存在' }, { status: 404 });
    }
    return Response.json(portfolio);
  } catch (e) {
    return handleError(e);
  }
});

// POST /api/portfolios - 创建组合
app.post('/api/portfolios', async (c) => {
  try {
    const body = await c.req.json<{ name: string; description?: string; actor?: string }>();
    const actor = body.actor || 'user';
    const { name, description } = body;
    
    if (!name) {
      return Response.json({ error: '组合名称不能为空' }, { status: 400 });
    }
    
    const portfolio = await portfolios.createPortfolio(c.env.DB, { name, description }, actor);
    return Response.json(portfolio, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
});

// PUT /api/portfolios/:id - 更新组合
app.put('/api/portfolios/:id', async (c) => {
  try {
    const body = await c.req.json<{ name?: string; description?: string; actor?: string }>();
    const actor = body.actor || 'user';
    const portfolio = await portfolios.updatePortfolio(c.env.DB, c.req.param('id'), body, actor);
    
    if (!portfolio) {
      return Response.json({ error: '组合不存在' }, { status: 404 });
    }
    return Response.json(portfolio);
  } catch (e) {
    return handleError(e);
  }
});

// DELETE /api/portfolios/:id - 删除组合
app.delete('/api/portfolios/:id', async (c) => {
  try {
    const body = await c.req.json<{ actor?: string }>();
    const actor = body.actor || 'user';
    const success = await portfolios.deletePortfolio(c.env.DB, c.req.param('id'), actor);
    
    if (!success) {
      return Response.json({ error: '组合不存在' }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (e) {
    return handleError(e);
  }
});

// ========== 项目 API ==========

// GET /api/portfolios/:portfolioId/projects - 列出组合下的项目
app.get('/api/portfolios/:portfolioId/projects', async (c) => {
  try {
    const includeArchived = c.req.query('includeArchived') === 'true';
    const results = await projects.listProjects(c.env.DB, c.req.param('portfolioId'), includeArchived);
    return Response.json(results);
  } catch (e) {
    return handleError(e);
  }
});

// GET /api/projects/:id - 获取单个项目
app.get('/api/projects/:id', async (c) => {
  try {
    const project = await projects.getProject(c.env.DB, c.req.param('id'));
    if (!project) {
      return Response.json({ error: '项目不存在' }, { status: 404 });
    }
    return Response.json(project);
  } catch (e) {
    return handleError(e);
  }
});

// POST /api/portfolios/:portfolioId/projects - 创建项目
app.post('/api/portfolios/:portfolioId/projects', async (c) => {
  try {
    const portfolioId = c.req.param('portfolioId');
    const body = await c.req.json();
    const actor = body.actor || 'user';
    
    if (!body.title || !body.owner) {
      return Response.json({ error: '标题和负责人不能为空' }, { status: 400 });
    }
    
    const project = await projects.createProject(c.env.DB, portfolioId, body, actor);
    return Response.json(project, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
});

// PUT /api/projects/:id - 更新项目
app.put('/api/projects/:id', async (c) => {
  try {
    const body = await c.req.json();
    const actor = body.actor || 'user';
    const project = await projects.updateProject(c.env.DB, c.req.param('id'), body, actor);
    
    if (!project) {
      return Response.json({ error: '项目不存在' }, { status: 404 });
    }
    return Response.json(project);
  } catch (e) {
    return handleError(e);
  }
});

// DELETE /api/projects/:id - 删除项目
app.delete('/api/projects/:id', async (c) => {
  try {
    const body = await c.req.json<{ actor?: string }>();
    const actor = body.actor || 'user';
    const success = await projects.deleteProject(c.env.DB, c.req.param('id'), actor);
    
    if (!success) {
      return Response.json({ error: '项目不存在' }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (e) {
    if (e instanceof Error && e.message.includes('子项目')) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    return handleError(e);
  }
});

// POST /api/projects/:id/complete - 标记完成
app.post('/api/projects/:id/complete', async (c) => {
  try {
    const body = await c.req.json<{ actor?: string }>();
    const actor = body.actor || 'user';
    const project = await projects.completeProject(c.env.DB, c.req.param('id'), actor);
    
    if (!project) {
      return Response.json({ error: '项目不存在' }, { status: 404 });
    }
    return Response.json(project);
  } catch (e) {
    return handleError(e);
  }
});

// POST /api/projects/:id/archive - 归档项目
app.post('/api/projects/:id/archive', async (c) => {
  try {
    const body = await c.req.json<{ actor?: string }>();
    const actor = body.actor || 'user';
    const result = await projects.archiveProject(c.env.DB, c.req.param('id'), actor);
    
    return Response.json(result, { status: result.success ? 200 : 400 });
  } catch (e) {
    return handleError(e);
  }
});

// GET /api/portfolios/:portfolioId/stats - 获取统计
app.get('/api/portfolios/:portfolioId/stats', async (c) => {
  try {
    const stats = await projects.getProjectStats(c.env.DB, c.req.param('portfolioId'));
    return Response.json(stats);
  } catch (e) {
    return handleError(e);
  }
});

// ========== 步骤 API ==========

// GET /api/projects/:projectId/steps - 获取项目的步骤
app.get('/api/projects/:projectId/steps', async (c) => {
  try {
    const results = await steps.listSteps(c.env.DB, c.req.param('projectId'));
    return Response.json(results);
  } catch (e) {
    return handleError(e);
  }
});

// GET /api/portfolios/:portfolioId/steps - 获取组合下所有步骤
app.get('/api/portfolios/:portfolioId/steps', async (c) => {
  try {
    const results = await steps.listAllSteps(c.env.DB, c.req.param('portfolioId'));
    return Response.json(results);
  } catch (e) {
    return handleError(e);
  }
});

// POST /api/projects/:projectId/steps - 创建步骤
app.post('/api/projects/:projectId/steps', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const body = await c.req.json();
    const actor = body.actor || 'user';
    
    if (!body.name) {
      return Response.json({ error: '步骤名称不能为空' }, { status: 400 });
    }
    
    const step = await steps.createStep(c.env.DB, projectId, body, actor);
    return Response.json(step, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message.includes('不存在')) {
      return Response.json({ error: e.message }, { status: 404 });
    }
    return handleError(e);
  }
});

// PUT /api/steps/:id - 更新步骤
app.put('/api/steps/:id', async (c) => {
  try {
    const body = await c.req.json();
    const actor = body.actor || 'user';
    const step = await steps.updateStep(c.env.DB, c.req.param('id'), body, actor);
    
    if (!step) {
      return Response.json({ error: '步骤不存在' }, { status: 404 });
    }
    return Response.json(step);
  } catch (e) {
    return handleError(e);
  }
});

// DELETE /api/steps/:id - 删除步骤
app.delete('/api/steps/:id', async (c) => {
  try {
    const body = await c.req.json<{ actor?: string }>();
    const actor = body.actor || 'user';
    const success = await steps.deleteStep(c.env.DB, c.req.param('id'), actor);
    
    if (!success) {
      return Response.json({ error: '步骤不存在' }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (e) {
    return handleError(e);
  }
});

// ========== Stage API ==========

// GET /api/portfolios/:portfolioId/stages - 获取组合的 Stage
app.get('/api/portfolios/:portfolioId/stages', async (c) => {
  try {
    const results = await stages.listStages(c.env.DB, c.req.param('portfolioId'));
    return Response.json(results);
  } catch (e) {
    return handleError(e);
  }
});

// POST /api/portfolios/:portfolioId/stages - 创建 Stage
app.post('/api/portfolios/:portfolioId/stages', async (c) => {
  try {
    const portfolioId = c.req.param('portfolioId');
    const body = await c.req.json<{ name: string; actor?: string }>();
    const actor = body.actor || 'user';
    
    if (!body.name) {
      return Response.json({ error: 'Stage 名称不能为空' }, { status: 400 });
    }
    
    const stage = await stages.createStage(c.env.DB, portfolioId, { name: body.name }, actor);
    return Response.json(stage, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
});

// PUT /api/stages/:id - 更新 Stage
app.put('/api/stages/:id', async (c) => {
  try {
    const body = await c.req.json<{ name: string; actor?: string }>();
    const actor = body.actor || 'user';
    const result = await stages.updateStage(c.env.DB, c.req.param('id'), body.name, actor);
    
    if (!result.success) {
      return Response.json(result, { status: 400 });
    }
    return Response.json(result.stage);
  } catch (e) {
    return handleError(e);
  }
});

// DELETE /api/stages/:id - 删除 Stage
app.delete('/api/stages/:id', async (c) => {
  try {
    const body = await c.req.json<{ actor?: string }>();
    const actor = body.actor || 'user';
    const result = await stages.deleteStage(c.env.DB, c.req.param('id'), actor);
    
    return Response.json(result, { status: result.success ? 200 : 400 });
  } catch (e) {
    return handleError(e);
  }
});

// ========== 审计 API ==========

// GET /api/portfolios/:portfolioId/audit - 获取审计事件
app.get('/api/portfolios/:portfolioId/audit', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    const result = await audit.listAuditEvents(c.env.DB, c.req.param('portfolioId'), limit, offset);
    return Response.json(result);
  } catch (e) {
    return handleError(e);
  }
});

// GET /api/audit/:type/:id - 获取对象审计历史
app.get('/api/audit/:type/:id', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '20');
    const results = await audit.getAuditHistory(c.env.DB, c.req.param('type'), c.req.param('id'), limit);
    return Response.json(results);
  } catch (e) {
    return handleError(e);
  }
});

// ========== 项目关联资料 API ==========

// GET /api/projects/:projectId/links - 获取项目的关联资料
app.get('/api/projects/:projectId/links', async (c) => {
  try {
    const results = await projectLinks.listProjectLinks(c.env.DB, c.req.param('projectId'));
    return Response.json(results);
  } catch (e) {
    return handleError(e);
  }
});

// POST /api/projects/:projectId/links - 创建关联资料
app.post('/api/projects/:projectId/links', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const body = await c.req.json<{ title: string; url: string; actor?: string }>();
    const actor = body.actor || 'user';
    
    if (!body.title || !body.url) {
      return Response.json({ error: '标题和 URL 不能为空' }, { status: 400 });
    }
    
    const link = await projectLinks.createProjectLink(c.env.DB, projectId, body, actor);
    return Response.json(link, { status: 201 });
  } catch (e) {
    if (e instanceof Error) {
      if (e.message.includes('不存在')) {
        return Response.json({ error: e.message }, { status: 404 });
      }
      if (e.message.includes('http')) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    }
    return handleError(e);
  }
});

// PUT /api/links/:id - 更新关联资料
app.put('/api/links/:id', async (c) => {
  try {
    const body = await c.req.json<{ title?: string; url?: string; actor?: string }>();
    const actor = body.actor || 'user';
    const link = await projectLinks.updateProjectLink(c.env.DB, c.req.param('id'), body, actor);
    
    if (!link) {
      return Response.json({ error: '关联资料不存在' }, { status: 404 });
    }
    return Response.json(link);
  } catch (e) {
    if (e instanceof Error && e.message.includes('http')) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    return handleError(e);
  }
});

// DELETE /api/links/:id - 删除关联资料
app.delete('/api/links/:id', async (c) => {
  try {
    const body = await c.req.json<{ actor?: string }>();
    const actor = body.actor || 'user';
    const success = await projectLinks.deleteProjectLink(c.env.DB, c.req.param('id'), actor);
    
    if (!success) {
      return Response.json({ error: '关联资料不存在' }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (e) {
    return handleError(e);
  }
});

// ========== 甘特图 API ==========

// GET /api/portfolios/:portfolioId/gantt - 获取甘特图数据
app.get('/api/portfolios/:portfolioId/gantt', async (c) => {
  try {
    const portfolioId = c.req.param('portfolioId');
    const start = c.req.query('start') || getDefaultStartDate();
    const end = c.req.query('end') || getDefaultEndDate();
    const scale = (c.req.query('scale') || 'week') as 'day' | 'week' | 'month';
    
    const projectsList = await projects.listProjects(c.env.DB, portfolioId, false);
    const allSteps = await steps.listAllSteps(c.env.DB, portfolioId);
    
    const ganttData = buildGanttData(projectsList, allSteps, start, end, scale);
    
    // 为每个项目计算甘特条
    const rowsWithBars = ganttData.rows.map(row => ({
      ...row,
      bars: calculateGanttBars(row.steps, start, end, scale),
    }));
    
    return Response.json({
      ...ganttData,
      rows: rowsWithBars,
    });
  } catch (e) {
    return handleError(e);
  }
});

function getDefaultStartDate(): string {
  const now = new Date();
  now.setDate(1); // 月初
  return now.toISOString().split('T')[0];
}

function getDefaultEndDate(): string {
  const now = new Date();
  now.setMonth(now.getMonth() + 3); // 3个月后
  return now.toISOString().split('T')[0];
}

// ========== 健康检查 ==========
app.get('/api/health', (c) => {
  return Response.json({ status: 'ok', timestamp: Date.now() });
});

// 未匹配到的 /api/* 路由返回 404 JSON
app.all('/api/*', (c) => {
  return Response.json({ error: '接口不存在' }, { status: 404 });
});

// 静态资源：所有非 /api/* 请求转交 ASSETS 绑定
// html_handling=none 时需手动把根路径映射到 index.html
app.all('*', async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname === '/' || url.pathname === '') {
    url.pathname = '/index.html';
    return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

// 导出 Worker
export default app;
