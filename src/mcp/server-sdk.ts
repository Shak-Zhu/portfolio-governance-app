// MCP Server using official @modelcontextprotocol/server@2.0.0 McpServer + Zod.
// 替代手写 JSON-RPC transport；31 工具全部 runtime schema 强校验（Zod .strict()）。
// WP-006：单用户 Bearer Token 模型。所有正确 Bearer 调用拥有全部工具权限。
// audit actor 固定为 mcp:shak-pmo-owner（由 /mcp 前置 middleware 注入 ctx.auth），
// 不接受、不读、不信客户端传入的 actor/email/scope。
//
// API（v2.0.0）：
//   server.registerTool(name, { description, inputSchema, outputSchema?, ... }, cb)
//   cb(args, ctx) → CallToolResult | InputRequiredResult
//   CallToolResult = { content: [...], structuredContent?, isError? }
//
// Zod schema 必须使用 .strict() 拒绝未知字段；v2 Server 包会自动生成 JSON Schema
// 并在 tool 调用时校验，缺失必填 / 类型错 / enum 非法 / 未知字段都会被拒绝。
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { D1Database } from '@cloudflare/workers-types';
import { MCP_NAME, SERVER_VERSION, AGENT_CONFIG } from './config';

import * as portfolios from '../api/portfolios';
import * as projects from '../api/projects';
import * as steps from '../api/steps';
import * as stages from '../api/stages';
import * as audit from '../api/audit';
import * as projectLinks from '../api/projectLinks';
import { buildGanttData } from '../lib/gantt';

// 固定审计 actor（WP-006 唯一值）
export const MCP_ACTOR = 'mcp:shak-pmo-owner';

// ==================== Zod Schemas（全部 strict）====================

const HEALTH_VALUES = ['green', 'blue', 'amber', 'red', 'unknown'] as const;
const STEP_STATUS = ['done', 'planned', 'risk', 'blocked', 'tbd'] as const;
const SCALE_VALUES = ['day', 'week', 'month'] as const;
const GATE_VALUES = ['open', 'closed'] as const;
const STATUS_VALUES = ['active', 'completed', 'archived'] as const;
const AUDIT_OBJECT_TYPES = ['portfolio', 'project', 'step', 'stage', 'archive', 'project_link'] as const;

// Portfolio schemas
const ListPortfoliosSchema = z.object({}).strict();
const GetPortfolioSchema = z.object({ portfolioId: z.string().min(1) }).strict();
const CreatePortfolioSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
}).strict();
const UpdatePortfolioSchema = z.object({
  portfolioId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
}).strict();
const DeletePortfolioSchema = z.object({ portfolioId: z.string().min(1) }).strict();

// Project schemas
const ListProjectsSchema = z.object({
  portfolioId: z.string().min(1),
  includeArchived: z.boolean().optional(),
}).strict();
const GetProjectSchema = z.object({ projectId: z.string().min(1) }).strict();
const CreateProjectSchema = z.object({
  portfolioId: z.string().min(1),
  title: z.string().min(1),
  owner: z.string().min(1),
  parent_id: z.string().min(1).optional(),
  stage: z.string().optional(),
  health: z.enum(HEALTH_VALUES).optional(),
  expectation: z.string().optional(),
  risk: z.string().optional(),
}).strict();
const UpdateProjectSchema = z.object({
  projectId: z.string().min(1),
  parent_id: z.string().optional(),
  title: z.string().optional(),
  owner: z.string().optional(),
  stage: z.string().optional(),
  health: z.enum(HEALTH_VALUES).optional(),
  expectation: z.string().optional(),
  risk: z.string().optional(),
  gate: z.enum(GATE_VALUES).optional(),
  status: z.enum(STATUS_VALUES).optional(),
}).strict();
const DeleteProjectSchema = z.object({ projectId: z.string().min(1) }).strict();
const CompleteProjectSchema = z.object({ projectId: z.string().min(1) }).strict();
const ArchiveProjectSchema = z.object({ projectId: z.string().min(1) }).strict();
const GetProjectStatsSchema = z.object({ portfolioId: z.string().min(1) }).strict();

// Step schemas
const ListStepsSchema = z.object({ projectId: z.string().min(1) }).strict();
const ListPortfolioStepsSchema = z.object({ portfolioId: z.string().min(1) }).strict();
const CreateStepSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  status: z.enum(STEP_STATUS).optional(),
}).strict();
const UpdateStepSchema = z.object({
  stepId: z.string().min(1),
  name: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  status: z.enum(STEP_STATUS).optional(),
  sort_order: z.number().optional(),
}).strict();
const DeleteStepSchema = z.object({ stepId: z.string().min(1) }).strict();

// Stage schemas
const ListStagesSchema = z.object({ portfolioId: z.string().min(1) }).strict();
const CreateStageSchema = z.object({
  portfolioId: z.string().min(1),
  name: z.string().min(1),
}).strict();
const UpdateStageSchema = z.object({
  stageId: z.string().min(1),
  name: z.string().min(1),
}).strict();
const DeleteStageSchema = z.object({ stageId: z.string().min(1) }).strict();

// Project Link schemas
const ListProjectLinksSchema = z.object({ projectId: z.string().min(1) }).strict();
const CreateProjectLinkSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  url: z.string()
    .url()
    .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
      message: 'URL 必须是 http:// 或 https://',
    }),
}).strict();
const UpdateProjectLinkSchema = z.object({
  linkId: z.string().min(1),
  title: z.string().optional(),
  url: z.string()
    .url()
    .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
      message: 'URL 必须是 http:// 或 https://',
    })
    .optional(),
}).strict();
const DeleteProjectLinkSchema = z.object({ linkId: z.string().min(1) }).strict();

// Gantt schema
const GetGanttSchema = z.object({
  portfolioId: z.string().min(1),
  start: z.string().optional(),
  end: z.string().optional(),
  scale: z.enum(SCALE_VALUES).optional(),
}).strict();

// Audit schemas
const ListAuditEventsSchema = z.object({
  portfolioId: z.string().min(1),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
}).strict();
const GetObjectAuditSchema = z.object({
  objectType: z.enum(AUDIT_OBJECT_TYPES),
  objectId: z.string().min(1),
  limit: z.number().int().positive().optional(),
}).strict();
const ListArchivedProjectsSchema = z.object({ portfolioId: z.string().min(1) }).strict();

// Discovery schema
const GetCapabilitiesSchema = z.object({}).strict();

// ==================== Result envelope helper ====================

/**
 * 包装工具返回值为 MCP CallToolResult envelope（content + structuredContent）。
 * 错误统一转为 isError:true + 描述信息，不抛异常到 transport 层（schema 校验失败除外）。
 */
function jsonResult<T>(data: T): { content: [{ type: 'text'; text: string }]; structuredContent: T } {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function jsonError(message: string, data?: unknown): { content: [{ type: 'text'; text: string }]; isError: true; structuredContent: { error: string; data?: unknown } } {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    structuredContent: { error: message, data },
  };
}

// ==================== Server Factory ====================

export interface ServerContext {
  db: D1Database;
  // Bearer 验证已由 /mcp 前置 middleware 完成；这里只携带一个可信标识。
  // actor 始终为 MCP_ACTOR，绝不来自入参。
  auth: { actor: typeof MCP_ACTOR };
  skillDistribution?: {
    sourceCommit: string;
    bundleRoot: string;
    manifestUrl: string;
  } | null;
}

/**
 * 返回 createMcpHandler 所需的 factory。factory 签名是：
 *   (requestCtx: McpRequestContext) => McpServer
 * 每次 HTTP 请求都会调用 factory 重新构造一个 McpServer（v2 官方契约）。
 * 我们的 closure 形式忽略 requestCtx、复用 ServerContext（db + auth）。
 */
export function createMcpServerFactory(ctx: ServerContext) {
  return () => {
    const server = new McpServer({
      name: MCP_NAME,
      version: SERVER_VERSION,
    });

    const ACTOR = ctx.auth.actor;
    if (ACTOR !== MCP_ACTOR) {
      // 防御：若上游传错 actor，直接拒。
      throw new Error('未授权的审计 actor');
    }

    // ========== Portfolio Tools ==========
    server.registerTool(
      'list_portfolios',
      {
        title: 'List Portfolios',
        description: '列出所有项目组合（Portfolio）。返回组合数组，每项含 id、name、description、created_at、updated_at。',
        inputSchema: ListPortfoliosSchema,
      },
      async () => jsonResult(await portfolios.listPortfolios(ctx.db))
    );

    server.registerTool(
      'get_portfolio',
      {
        title: 'Get Portfolio',
        description: '获取单个项目组合详情。参数 portfolioId。不存在时返回业务错误。',
        inputSchema: GetPortfolioSchema,
      },
      async (args) => {
        const p = await portfolios.getPortfolio(ctx.db, args.portfolioId);
        if (!p) return jsonError('组合不存在');
        return jsonResult(p);
      }
    );

    server.registerTool(
      'create_portfolio',
      {
        title: 'Create Portfolio',
        description: '创建项目组合。参数 name（必填）、description（可选）。审计 actor 来自认证上下文（mcp:shak-pmo-owner），不接受入参 actor。',
        inputSchema: CreatePortfolioSchema,
      },
      async (args) => jsonResult(await portfolios.createPortfolio(ctx.db, args, ACTOR))
    );

    server.registerTool(
      'update_portfolio',
      {
        title: 'Update Portfolio',
        description: '更新项目组合的 name / description。参数 portfolioId 必填，其余可选。',
        inputSchema: UpdatePortfolioSchema,
      },
      async (args) => {
        const { portfolioId, ...patch } = args;
        const updated = await portfolios.updatePortfolio(ctx.db, portfolioId, patch, ACTOR);
        if (!updated) return jsonError('组合不存在');
        return jsonResult(updated);
      }
    );

    server.registerTool(
      'delete_portfolio',
      {
        title: 'Delete Portfolio',
        description: '删除项目组合。参数 portfolioId。删除写入审计。',
        inputSchema: DeletePortfolioSchema,
      },
      async (args) => {
        const ok = await portfolios.deletePortfolio(ctx.db, args.portfolioId, ACTOR);
        if (!ok) return jsonError('组合不存在');
        return jsonResult({ success: true });
      }
    );

    // ========== Project Tools ==========
    server.registerTool(
      'list_projects',
      {
        title: 'List Projects',
        description: '列出组合下的项目。参数 portfolioId 必填；includeArchived 可选（默认 false）。',
        inputSchema: ListProjectsSchema,
      },
      async (args) => jsonResult(await projects.listProjects(ctx.db, args.portfolioId, args.includeArchived ?? false))
    );

    server.registerTool(
      'get_project',
      {
        title: 'Get Project',
        description: '获取单个项目详情。参数 projectId。',
        inputSchema: GetProjectSchema,
      },
      async (args) => {
        const p = await projects.getProject(ctx.db, args.projectId);
        if (!p) return jsonError('项目不存在');
        return jsonResult(p);
      }
    );

    server.registerTool(
      'create_project',
      {
        title: 'Create Project',
        description: '在组合下创建项目。参数 portfolioId、title、owner 必填；parent_id（父项目，用于层级）、stage、health（green/blue/amber/red/unknown）、expectation、risk 可选。',
        inputSchema: CreateProjectSchema,
      },
      async (args) => {
        const { portfolioId, ...data } = args;
        return jsonResult(await projects.createProject(ctx.db, portfolioId, data, ACTOR));
      }
    );

    server.registerTool(
      'update_project',
      {
        title: 'Update Project',
        description: '更新项目字段。参数 projectId 必填；parent_id、title、owner、stage、health、expectation、risk、gate、status 可选。维护 parent 用 parent_id。',
        inputSchema: UpdateProjectSchema,
      },
      async (args) => {
        const { projectId, ...patch } = args;
        const updated = await projects.updateProject(ctx.db, projectId, patch, ACTOR);
        if (!updated) return jsonError('项目不存在');
        return jsonResult(updated);
      }
    );

    server.registerTool(
      'delete_project',
      {
        title: 'Delete Project',
        description: '删除项目。存在未归档子项目时被拒绝（业务规则）。参数 projectId。',
        inputSchema: DeleteProjectSchema,
      },
      async (args) => {
        try {
          const ok = await projects.deleteProject(ctx.db, args.projectId, ACTOR);
          if (!ok) return jsonError('项目不存在');
          return jsonResult({ success: true });
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      }
    );

    server.registerTool(
      'complete_project',
      {
        title: 'Complete Project',
        description: '标记项目完成（status=completed）。参数 projectId。',
        inputSchema: CompleteProjectSchema,
      },
      async (args) => {
        const p = await projects.completeProject(ctx.db, args.projectId, ACTOR);
        if (!p) return jsonError('项目不存在');
        return jsonResult(p);
      }
    );

    server.registerTool(
      'archive_project',
      {
        title: 'Archive Project',
        description: '整体归档顶级项目及其后代。仅顶级项目可归档；所有后代必须已完成，否则被拒绝。参数 projectId。',
        inputSchema: ArchiveProjectSchema,
      },
      async (args) => {
        const result = await projects.archiveProject(ctx.db, args.projectId, ACTOR);
        if (!result.success) return jsonError(result.message || '归档失败');
        return jsonResult(result);
      }
    );

    server.registerTool(
      'get_project_stats',
      {
        title: 'Get Project Stats',
        description: '获取组合项目统计：total/active/completed/archived。参数 portfolioId。',
        inputSchema: GetProjectStatsSchema,
      },
      async (args) => jsonResult(await projects.getProjectStats(ctx.db, args.portfolioId))
    );

    // ========== Step Tools ==========
    server.registerTool(
      'list_steps',
      {
        title: 'List Steps',
        description: '列出项目的步骤（甘特条数据源）。参数 projectId。',
        inputSchema: ListStepsSchema,
      },
      async (args) => jsonResult(await steps.listSteps(ctx.db, args.projectId))
    );

    server.registerTool(
      'list_portfolio_steps',
      {
        title: 'List Portfolio Steps',
        description: '列出组合下所有项目的步骤。参数 portfolioId。',
        inputSchema: ListPortfolioStepsSchema,
      },
      async (args) => jsonResult(await steps.listAllSteps(ctx.db, args.portfolioId))
    );

    server.registerTool(
      'create_step',
      {
        title: 'Create Step',
        description: '为项目创建步骤。参数 projectId、name 必填；start_date/end_date（YYYY-MM-DD）、status（done/planned/risk/blocked/tbd）可选。无合法日期或 status=tbd 时进入未排期工作包区，不落时间轴。',
        inputSchema: CreateStepSchema,
      },
      async (args) => {
        const { projectId, ...data } = args;
        return jsonResult(await steps.createStep(ctx.db, projectId, data, ACTOR));
      }
    );

    server.registerTool(
      'update_step',
      {
        title: 'Update Step',
        description: '更新步骤。参数 stepId 必填；name、start_date、end_date、status、sort_order 可选。补齐合法起止日期且原为 tbd 时自动转 planned；清空任一日期自动回退 tbd（TBD ↔ Plan 语义与网页一致）。清空日期请传空字符串 ""。',
        inputSchema: UpdateStepSchema,
      },
      async (args) => {
        const { stepId, ...patch } = args;
        const updated = await steps.updateStep(ctx.db, stepId, patch, ACTOR);
        if (!updated) return jsonError('步骤不存在');
        return jsonResult(updated);
      }
    );

    server.registerTool(
      'delete_step',
      {
        title: 'Delete Step',
        description: '删除步骤。参数 stepId。',
        inputSchema: DeleteStepSchema,
      },
      async (args) => {
        const ok = await steps.deleteStep(ctx.db, args.stepId, ACTOR);
        if (!ok) return jsonError('步骤不存在');
        return jsonResult({ success: true });
      }
    );

    // ========== Stage Tools ==========
    server.registerTool(
      'list_stages',
      {
        title: 'List Stages',
        description: '列出组合的 Stage 集合。参数 portfolioId。',
        inputSchema: ListStagesSchema,
      },
      async (args) => jsonResult(await stages.listStages(ctx.db, args.portfolioId))
    );

    server.registerTool(
      'create_stage',
      {
        title: 'Create Stage',
        description: '创建 Stage。参数 portfolioId、name。',
        inputSchema: CreateStageSchema,
      },
      async (args) => jsonResult(await stages.createStage(ctx.db, args.portfolioId, { name: args.name }, ACTOR))
    );

    server.registerTool(
      'update_stage',
      {
        title: 'Update Stage',
        description: '重命名 Stage。参数 stageId、name。被任何项目（含已归档）使用的 Stage 禁止改名（业务规则）。',
        inputSchema: UpdateStageSchema,
      },
      async (args) => {
        const result = await stages.updateStage(ctx.db, args.stageId, args.name, ACTOR);
        if (!result.success) return jsonError(result.message || 'Stage 更新失败');
        return jsonResult(result.stage);
      }
    );

    server.registerTool(
      'delete_stage',
      {
        title: 'Delete Stage',
        description: '删除 Stage。被任何项目（含已归档）使用的 Stage 禁止删除（删除保护）。参数 stageId。',
        inputSchema: DeleteStageSchema,
      },
      async (args) => {
        const result = await stages.deleteStage(ctx.db, args.stageId, ACTOR);
        if (!result.success) return jsonError(result.message);
        return jsonResult(result);
      }
    );

    // ========== Project Link Tools ==========
    server.registerTool(
      'list_project_links',
      {
        title: 'List Project Links',
        description: '列出项目关联资料。参数 projectId。',
        inputSchema: ListProjectLinksSchema,
      },
      async (args) => jsonResult(await projectLinks.listProjectLinks(ctx.db, args.projectId))
    );

    server.registerTool(
      'create_project_link',
      {
        title: 'Create Project Link',
        description: '为项目创建关联资料。参数 projectId、title、url。url 仅接受 http(s)，否则被拒绝。',
        inputSchema: CreateProjectLinkSchema,
      },
      async (args) => {
        try {
          const { projectId, ...data } = args;
          return jsonResult(await projectLinks.createProjectLink(ctx.db, projectId, data, ACTOR));
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      }
    );

    server.registerTool(
      'update_project_link',
      {
        title: 'Update Project Link',
        description: '更新关联资料。参数 linkId 必填；title、url 可选。url 仅接受 http(s)。',
        inputSchema: UpdateProjectLinkSchema,
      },
      async (args) => {
        try {
          const { linkId, ...patch } = args;
          const updated = await projectLinks.updateProjectLink(ctx.db, linkId, patch, ACTOR);
          if (!updated) return jsonError('关联资料不存在');
          return jsonResult(updated);
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      }
    );

    server.registerTool(
      'delete_project_link',
      {
        title: 'Delete Project Link',
        description: '删除关联资料。参数 linkId。',
        inputSchema: DeleteProjectLinkSchema,
      },
      async (args) => {
        const ok = await projectLinks.deleteProjectLink(ctx.db, args.linkId, ACTOR);
        if (!ok) return jsonError('关联资料不存在');
        return jsonResult({ success: true });
      }
    );

    // ========== Gantt Tool ==========
    server.registerTool(
      'get_gantt',
      {
        title: 'Get Gantt',
        description: '读取组合甘特数据。参数 portfolioId 必填；start、end（YYYY-MM-DD）、scale（day/week/month，默认 week）可选。返回 timeline（时间格）、rows（含 bars 落位）、unscheduled（未排期工作包分组）、config。',
        inputSchema: GetGanttSchema,
      },
      async (args) => {
        const scale = args.scale || 'week';
        const now = new Date();
        const defStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const defEnd = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString().split('T')[0];
        const start = args.start || defStart;
        const end = args.end || defEnd;
        const projectsList = await projects.listProjects(ctx.db, args.portfolioId, false);
        const allSteps = await steps.listAllSteps(ctx.db, args.portfolioId);
        return jsonResult(buildGanttData(projectsList, allSteps, start, end, scale));
      }
    );

    // ========== Audit Tools ==========
    server.registerTool(
      'list_audit_events',
      {
        title: 'List Audit Events',
        description: '读取组合审计事件（分页）。参数 portfolioId 必填；limit、offset 可选。',
        inputSchema: ListAuditEventsSchema,
      },
      async (args) => {
        const limit = args.limit ?? 50;
        const offset = args.offset ?? 0;
        return jsonResult(await audit.listAuditEvents(ctx.db, args.portfolioId, limit, offset));
      }
    );

    server.registerTool(
      'get_object_audit',
      {
        title: 'Get Object Audit',
        description: '读取单个对象的审计历史。参数 objectType（portfolio/project/step/stage/archive/project_link）、objectId；limit 可选。',
        inputSchema: GetObjectAuditSchema,
      },
      async (args) => {
        const limit = args.limit ?? 20;
        return jsonResult(await audit.getAuditHistory(ctx.db, args.objectType, args.objectId, limit));
      }
    );

    server.registerTool(
      'list_archived_projects',
      {
        title: 'List Archived Projects',
        description: '查询组合下的已归档项目。参数 portfolioId。',
        inputSchema: ListArchivedProjectsSchema,
      },
      async (args) => {
        const all = await projects.listProjects(ctx.db, args.portfolioId, true);
        return jsonResult(
          all.filter((p: { is_archived: number; status: string }) => p.is_archived === 1 || p.status === 'archived')
        );
      }
    );

    // ========== Discovery Tool ==========
    server.registerTool(
      'get_capabilities',
      {
        title: 'Get Capabilities',
        description: '返回 MCP 服务发现与健康信息：系统名称、服务器版本、工具协议版本、Skill 版本、Skill manifest URL、支持的鉴权方式、工具数量与健康状态。无副作用。',
        inputSchema: GetCapabilitiesSchema,
      },
      async () =>
        jsonResult({
          systemName: AGENT_CONFIG.systemName,
          mcpName: AGENT_CONFIG.mcpName,
          serverVersion: SERVER_VERSION,
          toolProtocolVersion: AGENT_CONFIG.toolProtocolVersion,
        skillVersion: AGENT_CONFIG.skillVersion,
        manifestUrl: ctx.skillDistribution?.manifestUrl ?? null,
          mcpUrl: AGENT_CONFIG.mcpUrl,
          auth: {
            mode: 'bearer',
            header: 'Authorization: Bearer <token>',
            audience: 'shak-pmo-owner',
          },
          toolCount: 31,
          health: 'ok',
          skillBundle: {
            sourceCommit: ctx.skillDistribution?.sourceCommit ?? null,
            bundleRoot: ctx.skillDistribution?.bundleRoot ?? null,
            files: [
              'SKILL.md',
              'shak-project-portfolio-governance.mdc',
              'references/tool-contract.md',
              'references/governance-rules.md',
              'agents/openai.yaml',
              'manifest.json',
            ],
            // skillSourceCommit 由 Codex 在 QC 后把不可变 Git commit 写入 manifest 与本页；
            // Cursor 不猜测、不提交、不发布。
            installMode: 'one-click copy from /api/agent/install after web login',
          },
        })
    );

    return server;
  };
}
