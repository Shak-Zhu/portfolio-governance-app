// Cloudflare Worker 主入口（WP-006：单用户 Bearer MCP + Hono defaultHandler）
// - /mcp: 官方 createMcpHandler(McpServer + Zod)，前置 Bearer 中间件校验 SHAK_PMO_MCP_TOKEN。
//         无 Cookie；缺失/错误 Bearer → JSON 401；正确 → 进入 createMcpHandler。
//         actor 固定为 mcp:shak-pmo-owner，绝不读取入参 actor/scope/email。
//         不实现 OAuth、不创建 KV、不暴露 .well-known/oauth-*。
// - 其他 URL: 交给 Hono 处理（会话登录页、/api/auth/*、既有业务 API、Agent 安装接口、静态资源）。
import { createMcpHandler } from 'agents/mcp/server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { D1Database, R2Bucket, Fetcher } from '@cloudflare/workers-types';

import * as portfolios from './api/portfolios';
import * as projects from './api/projects';
import * as steps from './api/steps';
import * as stages from './api/stages';
import * as audit from './api/audit';
import * as projectLinks from './api/projectLinks';
import { buildGanttData } from './lib/gantt';
import { AGENT_CONFIG } from './mcp/config';
import { createMcpServerFactory, MCP_ACTOR } from './mcp/server-sdk';
import {
  buildLogoutCookie,
  buildSessionCookie,
  issueSession,
  parseCookies,
  SESSION_COOKIE_NAME,
  timingSafeEqual,
  verifyLoginCredentials,
  verifySession,
} from './auth';
import {
  createBackup,
  listBackups,
  restoreBackup,
  runScheduledBackup,
} from './lib/backup';

// ==================== Worker Env ====================
interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  ASSETS: Fetcher;
  // 隔离恢复演练库（仅本地/QC 环境绑定；生产必须由 Codex 在 PM/QC 通过后创建并填写）
  RESTORE_DRILL_DB?: D1Database;
  SHAK_PMO_WEB_LOGIN_EMAIL?: string;
  SHAK_PMO_WEB_LOGIN_PASSWORD?: string;
  SHAK_PMO_SESSION_SECRET?: string;
  SHAK_PMO_MCP_TOKEN?: string;
  // 非敏感发布引用：仅由 Codex 在 Git 发布后写入最终 Skill Bundle commit。
  SHAK_PMO_SKILL_SOURCE_COMMIT?: string;
  // Node compat 需要
}

// ==================== Constants ====================
// 这些路径在网页登录保护中是公开的；其它路径都要求 Session Cookie。
const PUBLIC_WEB_PATHS = new Set([
  '/login',
  '/login.html',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/health',
  '/api/agent/config',
  '/mcp',
]);
// 静态资源（login 页本身依赖）公开；其它 HTML 必须经过登录保护。
const PUBLIC_STATIC_EXTENSIONS = ['.js', '.css', '.png', '.svg', '.ico', '.map'];
const SKILL_GITHUB_REPO = 'Shak-Zhu/portfolio-governance-app';

interface SkillDistribution {
  sourceCommit: string;
  bundleRoot: string;
  manifestUrl: string;
}

function getSkillDistribution(env: Env): SkillDistribution | null {
  const sourceCommit = (env.SHAK_PMO_SKILL_SOURCE_COMMIT || '').trim();
  // 只允许不可变 40 位 Git SHA；禁止 main、tag、仓库首页或任意 URL。
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) return null;
  const bundleRoot = `https://raw.githubusercontent.com/${SKILL_GITHUB_REPO}/${sourceCommit}/agent-skills/${AGENT_CONFIG.mcpName}`;
  return { sourceCommit, bundleRoot, manifestUrl: `${bundleRoot}/manifest.json` };
}

const BEARER_UNAUTHORIZED = (reason: string) =>
  new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32001, message: 'Unauthorized', data: { reason } },
  }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="shak-pmo-mcp"' },
  });

// ==================== MCP Authorization Middleware ====================
// 在 Hono 之前拦截 POST /mcp；返回标准 JSON 401；正确 Bearer 放行官方 handler。
async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== 'POST' && request.method !== 'OPTIONS') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // CORS preflight 直接放行
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const auth = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return BEARER_UNAUTHORIZED('Missing Authorization: Bearer');
  }
  const presented = auth.slice(7).trim();
  const expected = (env.SHAK_PMO_MCP_TOKEN || '').trim();
  if (!expected) {
    return BEARER_UNAUTHORIZED('Server bearer token not configured');
  }
  // 固定长度 SHA-256 摘要 + XOR 比较；不因 token 长度/首个差异提前返回。
  if (!(await timingSafeEqual(presented, expected))) {
    return BEARER_UNAUTHORIZED('Invalid bearer token');
  }

  // 正确 Bearer：交给官方 createMcpHandler（agents/mcp）。每次请求调用 createServer
  // factory，返回全新的 McpServer 实例。
  const serverCtx = {
    db: env.DB,
    auth: { actor: MCP_ACTOR as typeof MCP_ACTOR },
    skillDistribution: getSkillDistribution(env),
  };
  try {
    return await createMcpHandler(createMcpServerFactory(serverCtx), {
      route: '/mcp',
      allowedHostnames: ['pmo.pmoforms.com', 'localhost', '127.0.0.1'],
      allowedOriginHostnames: ['pmo.pmoforms.com', 'localhost', '127.0.0.1'],
      corsOptions: {
        origin: '*',
        methods: 'POST, OPTIONS',
        headers: 'Content-Type, Authorization',
        maxAge: 86400,
      },
      onerror: (err: unknown) => {
        const e = err as { stack?: string; message?: string } | undefined;
        // 原始 SDK 错误写到 console；不返回原始堆栈给客户端
        console.error('[mcp-handler]', e?.stack || e?.message || String(err));
      },
    }).fetch(request, env, ctx);
  } catch (e) {
    console.error('[mcp-handler]', (e as Error)?.stack || (e as Error)?.message);
    return BEARER_UNAUTHORIZED('MCP handler failure');
  }
}

// ==================== Hono App（defaultHandler） ====================
const app = new Hono<{ Bindings: Env; Variables: { session: { sub: string } | null } }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

function handleError(error: unknown): Response {
  const message = error instanceof Error ? error.message : '未知错误';
  console.error('API Error:', message);
  return Response.json({ error: message }, { status: 500 });
}

// 公共安全头：防止把响应缓存到共享代理（重要的页面登出 / 安全响应）
function noStoreHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Cache-Control': 'no-store', 'Pragma': 'no-cache', ...extra };
}

// ==================== 健康检查（公共） ====================
app.get('/api/health', (c) => {
  return Response.json({ status: 'ok', timestamp: Date.now() });
});

// ==================== /api/agent/config（公共可读；不含 secret） ====================
app.get('/api/agent/config', (c) => {
  const origin = new URL(c.req.url).origin;
  const bearerConfigured = !!c.env.SHAK_PMO_MCP_TOKEN;
  const distribution = getSkillDistribution(c.env);
  // files 仅含相对路径，无绝对 URL（防止 Git 中漂移）
  // 真实 GitHub raw URL 仅在 skillDistribution（Codex 发布后）存在
  return Response.json({
    mcpName: AGENT_CONFIG.mcpName,
    systemName: AGENT_CONFIG.systemName,
    mcpUrl: AGENT_CONFIG.mcpUrl,
    // manifestPath 是相对于 Bundle 根目录的路径，非绝对 URL
    manifestPath: AGENT_CONFIG.manifestPath,
    skillVersion: AGENT_CONFIG.skillVersion,
    serverVersion: AGENT_CONFIG.serverVersion,
    toolProtocolVersion: AGENT_CONFIG.toolProtocolVersion,
    // files 仅含相对路径，无 URL
    files: AGENT_CONFIG.files,
    auth: {
      mode: 'bearer',
      header: 'Authorization: Bearer <token>',
      configured: bearerConfigured,
    },
    // 真实固定 GitHub raw URL：仅在 Codex 发布后由 SHAK_PMO_SKILL_SOURCE_COMMIT 注入；发布前为 null
    skillDistribution: distribution,
    localMcpUrl: `${origin}/mcp`,
  });
});

// ==================== Auth：登录 / 登出 / 会话状态 ====================
app.post('/api/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { email?: string; password?: string };
  const email = body.email || '';
  const password = body.password || '';
  if (!email || !password) {
    return Response.json({ error: '邮箱和密码不能为空' }, { status: 400, headers: noStoreHeaders() });
  }
  const result = await verifyLoginCredentials(c.env, email, password);
  if (!result.ok) {
    return Response.json({ error: result.reason }, { status: 401, headers: noStoreHeaders() });
  }
  if (!c.env.SHAK_PMO_SESSION_SECRET) {
    return Response.json({ error: '服务未配置 Session 密钥' }, { status: 500, headers: noStoreHeaders() });
  }
  const token = await issueSessionImpl(c.env.SHAK_PMO_SESSION_SECRET, result.sub);
  const cookie = buildSessionCookie(token, c.req.url.startsWith('https://'));
  return Response.json({ ok: true, sub: result.sub }, { status: 200, headers: { ...noStoreHeaders(), 'Set-Cookie': cookie } });
});

app.post('/api/auth/logout', (c) => {
  const cookie = buildLogoutCookie(c.req.url.startsWith('https://'));
  return Response.json({ ok: true }, { status: 200, headers: { ...noStoreHeaders(), 'Set-Cookie': cookie } });
});

app.get('/api/auth/session', async (c) => {
  const secure = c.req.url.startsWith('https://');
  const cookies = parseCookies(c.req.header('Cookie'));
  const token = cookies[SESSION_COOKIE_NAME];
  const session = c.env.SHAK_PMO_SESSION_SECRET
    ? await verifySession(c.env.SHAK_PMO_SESSION_SECRET, token)
    : null;
  if (!session) {
    return Response.json({ authenticated: false }, { status: 401, headers: noStoreHeaders() });
  }
  return Response.json({
    authenticated: true,
    sub: session.sub,
    expiresAt: session.exp,
  }, { headers: noStoreHeaders() });
});

// 复用的签发函数（包在 index 内避免改 import 结构）
function issueSessionImpl(secret: string, sub: string): Promise<string> {
  return issueSession(secret, sub);
}

// ==================== 会话中间件：保护业务 API 与接入中心 ====================
async function authenticateSession(c: { env: Env; req: { header: (k: string) => string | undefined }; set: (k: string, v: unknown) => void }, path: string): Promise<{ sub: string } | null> {
  if (!c.env.SHAK_PMO_SESSION_SECRET) {
    return null;
  }
  const cookies = parseCookies(c.req.header('Cookie'));
  const token = cookies[SESSION_COOKIE_NAME];
  const session = await verifySession(c.env.SHAK_PMO_SESSION_SECRET, token);
  if (!session) return null;
  c.set('session', { sub: session.sub });
  return { sub: session.sub };
}

app.use('/api/*', async (c, next) => {
  const url = new URL(c.req.url);
  if (
    url.pathname === '/api/health' ||
    url.pathname === '/api/auth/login' ||
    url.pathname === '/api/auth/logout' ||
    url.pathname === '/api/auth/session' ||
    url.pathname === '/api/agent/config' ||
    url.pathname === '/api/agent/install'
  ) {
    // /api/agent/install 在路由处理器内部再校验；其它都是公开端点。
    await next();
    return;
  }
  const session = await authenticateSession(c, url.pathname);
  if (!session) {
    return Response.json({ error: '未登录' }, { status: 401, headers: noStoreHeaders() });
  }
  await next();
});

// 网页 HTML 保护：未登录的浏览器 GET HTML 跳 /login。
// 静态资源（.js/.css/.png 等）、login 页面本身公开。
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const path = url.pathname;

  // 已确认公开：直接放行
  if (PUBLIC_WEB_PATHS.has(path)) {
    await next();
    return;
  }
  // 静态资源扩展名公开
  if (PUBLIC_STATIC_EXTENSIONS.some((ext) => path.endsWith(ext))) {
    await next();
    return;
  }

  // 业务 HTML / 根路径必须登录：检测 Session
  // 非 GET 请求或路径不在网页范围（如 /mcp）已经走其它分支，这里仅处理 GET 网页 HTML。
  if (c.req.method !== 'GET') {
    await next();
    return;
  }
  // 只对根路径 / HTML / 其它无后缀路径做 HTML 保护
  const isHtmlCandidate =
    path === '/' ||
    path.endsWith('.html') ||
    (!path.includes('.') && !path.startsWith('/api/') && !path.startsWith('/mcp'));
  if (!isHtmlCandidate) {
    await next();
    return;
  }

  if (!c.env.SHAK_PMO_SESSION_SECRET) {
    // 服务端未配置：拒绝暴露主页面。
    return new Response('Service session secret not configured', {
      status: 503,
      headers: noStoreHeaders(),
    });
  }
  const session = await authenticateSession(c, path);
  if (!session) {
    // 未登录 → 302 到 /login（保留 next 参数以便登录后回跳）
    const target = encodeURIComponent(path + url.search);
    return new Response(null, {
      status: 302,
      headers: {
        ...noStoreHeaders(),
        Location: `/login?next=${target}`,
      },
    });
  }
  await next();
});

// ==================== /api/agent/install（动态安装指令） ====================
app.get('/api/agent/install', async (c) => {
  // 强制要求会话有效
  const cookies = parseCookies(c.req.header('Cookie'));
  const token = cookies[SESSION_COOKIE_NAME];
  const session = c.env.SHAK_PMO_SESSION_SECRET
    ? await verifySession(c.env.SHAK_PMO_SESSION_SECRET, token)
    : null;
  if (!session) {
    return Response.json({ error: '未登录' }, { status: 401, headers: noStoreHeaders() });
  }
  const mcpToken = c.env.SHAK_PMO_MCP_TOKEN;
  if (!mcpToken) {
    return Response.json({ error: '服务未配置 MCP Token' }, { status: 503, headers: noStoreHeaders() });
  }
  const distribution = getSkillDistribution(c.env);
  if (!distribution) {
    return Response.json({ error: 'Skill 发布版本尚未由 Codex 固化' }, { status: 503, headers: noStoreHeaders() });
  }
  const mcpUrl = AGENT_CONFIG.mcpUrl;
  const skillRoot = distribution.bundleRoot;
  const manifestUrl = distribution.manifestUrl;
  const mcpName = AGENT_CONFIG.mcpName;

  // Codex CLI 实际支持的 flag 只有 --bearer-token-env-var，
  // 因此文案必须先 setenv（macOS 用 launchctl setenv；其它平台导出后启动 Codex Desktop），
  // 再用 --bearer-token-env-var 引用环境变量名，最后提示完全退出/重开 Codex Desktop
  // （Codex Desktop 不会自动重新加载 setenv）。
  const codex = `# Shak 项目组合治理系统 · Codex 接入（Bearer Token, 安全合并，不覆盖已有配置）
# MCP 名称 : ${mcpName}
# MCP URL  : ${mcpUrl}
# 说明    : Codex CLI 仅支持 --bearer-token-env-var；Token 写入环境变量再引用。
#           setenv 后必须【完全退出 Codex Desktop 并重开】，新的 MCP 会话才会读到 Token。
#
# 1) 把 Bearer Token 写入当前登录会话的环境变量（macOS GUI 持久；终端瞬时）
launchctl setenv SHAK_PMO_MCP_TOKEN "${mcpToken}"
export SHAK_PMO_MCP_TOKEN="${mcpToken}"
#
# 2) 注册 MCP（官方 Streamable HTTP + Bearer Header via env var）
codex mcp add ${mcpName} --url ${mcpUrl} --bearer-token-env-var SHAK_PMO_MCP_TOKEN
#
# 3) 安装完整 GitHub Skill Bundle（固定 commit，不使用 main / 仓库首页 / 站点静态文件）
export SHAK_SKILL_ROOT="${skillRoot}"
export SHAK_SKILL_MANIFEST="${manifestUrl}"
export SHAK_SKILL_TARGET="$HOME/.codex/skills/${mcpName}"
python3 - <<'PY'
import hashlib, json, os, shutil, sys, tempfile, urllib.parse, urllib.request
root, manifest_url, target = os.environ['SHAK_SKILL_ROOT'], os.environ['SHAK_SKILL_MANIFEST'], os.environ['SHAK_SKILL_TARGET']
tmp = tempfile.mkdtemp(prefix='shak-skill-')
try:
    with urllib.request.urlopen(manifest_url) as r:
        manifest = json.load(r)
    for rel, meta in manifest['files'].items():
        dest = os.path.join(tmp, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with urllib.request.urlopen(root + '/' + urllib.parse.quote(rel)) as r:
            data = r.read()
        if hashlib.sha256(data).hexdigest() != meta['sha256']:
            raise RuntimeError('SHA-256 mismatch: ' + rel)
        with open(dest, 'wb') as f: f.write(data)
    with open(os.path.join(tmp, 'manifest.json'), 'wb') as f:
        f.write(json.dumps(manifest, ensure_ascii=False, indent=2).encode() + b'\\n')
    os.makedirs(os.path.dirname(target), exist_ok=True)
    shutil.rmtree(target, ignore_errors=True)
    shutil.move(tmp, target)
    tmp = None
    print('Skill Bundle 已校验并安装:', target)
except Exception as e:
    print('Skill 安装失败:', e, file=sys.stderr)
    sys.exit(1)
finally:
    if tmp: shutil.rmtree(tmp, ignore_errors=True)
PY
#
# 4) 验证
codex mcp list
# 完全退出 Codex Desktop 并重开 → 在 Codex 中调用 get_capabilities：
#   确认 toolCount=31、auth.mode=bearer、skillVersion 与 manifest 一致。
echo "manifest: ${manifestUrl}"
echo "skill root: ${skillRoot}"`;

  const cursor = `# Shak 项目组合治理系统 · Cursor 接入（Bearer Token, 安全合并 ~/.cursor/mcp.json，不覆盖已有 MCP）
python3 - <<'PY'
import hashlib, json, os, shutil, tempfile, urllib.parse, urllib.request
home = os.path.expanduser("~")
cfg_path = os.path.join(home, ".cursor", "mcp.json")
os.makedirs(os.path.dirname(cfg_path), exist_ok=True)
data = {}
if os.path.exists(cfg_path):
    with open(cfg_path) as f:
        try: data = json.load(f)
        except Exception: data = {}
servers = data.setdefault("mcpServers", {})
# 只新增/更新本 MCP，保留其它所有已有 server
servers["${mcpName}"] = {"url": "${mcpUrl}", "headers": {"Authorization": "Bearer ${mcpToken}"}}
with open(cfg_path, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
print("已安全合并到", cfg_path)
# 下载并校验完整 GitHub Skill Bundle；Cursor Rule 从同一固定 commit 安装。
root = "${skillRoot}"
tmp = tempfile.mkdtemp(prefix="shak-skill-")
try:
    with urllib.request.urlopen("${manifestUrl}") as r: manifest = json.load(r)
    for rel, meta in manifest["files"].items():
        dest = os.path.join(tmp, rel); os.makedirs(os.path.dirname(dest), exist_ok=True)
        with urllib.request.urlopen(root + "/" + urllib.parse.quote(rel)) as r: data = r.read()
        if hashlib.sha256(data).hexdigest() != meta["sha256"]: raise RuntimeError("SHA-256 mismatch: " + rel)
        with open(dest, "wb") as f: f.write(data)
    # 保留已校验的 manifest，便于本地审计已安装 Skill 的版本和全部文件哈希。
    with open(os.path.join(tmp, "manifest.json"), "wb") as f:
        f.write(json.dumps(manifest, ensure_ascii=False, indent=2).encode() + b"\\n")
    bundle_dir = os.path.join(home, ".cursor", "skills", "${mcpName}")
    shutil.rmtree(bundle_dir, ignore_errors=True); os.makedirs(os.path.dirname(bundle_dir), exist_ok=True)
    shutil.move(tmp, bundle_dir); tmp = None
finally:
    if tmp: shutil.rmtree(tmp, ignore_errors=True)
# 安装 Cursor Rule (.mdc) from verified bundle
rule_dir = os.path.join(home, ".cursor", "rules")
os.makedirs(rule_dir, exist_ok=True)
shutil.copyfile(os.path.join(bundle_dir, "shak-project-portfolio-governance.mdc"), os.path.join(rule_dir, "${mcpName}.mdc"))
print("已安装 Rule:", os.path.join(rule_dir, "${mcpName}.mdc"))
PY
# 在 Cursor 中打开 MCP 设置，完成本 MCP 接入（Bearer Header 由上述配置提供）。
# 然后运行 tools/list 做工具发现，并调用 get_capabilities 校验 skillVersion。
# 说明：Cursor 使用 .cursor/rules/*.mdc，不会原生读取 Codex 的 SKILL.md。
echo "manifest: ${manifestUrl}"`;

  const generic = `# Shak 项目组合治理系统 · 通用 MCP Client 接入（标准 Streamable HTTP + Bearer Token）
# MCP 名称 : ${mcpName}
# MCP URL  : ${mcpUrl}
# 鉴权    : Authorization: Bearer ${mcpToken}
# 验证步骤:
#   1) 用 MCP Inspector 验证：npx @modelcontextprotocol/inspector
#   2) 在 Inspector 填入 MCP URL（Streamable HTTP），在 Headers 加 Authorization: Bearer ${mcpToken}
#   3) 调用 tools/list 做工具发现
#   4) 调用 get_capabilities，确认 skillVersion 与 manifest 一致：
#      ${manifestUrl}
# Skill Bundle root（固定 Git commit）: ${skillRoot}
# Rule 文档  : ${skillRoot}/shak-project-portfolio-governance.mdc`;

  return Response.json(
    { codex, cursor, generic },
    { status: 200, headers: noStoreHeaders() }
  );
});

// ==================== 既有业务 API（来自 src/api/） ====================
// 这些路由已经在 WP-002A/WP-005 实现并验证；这里保留路径与语义，由 Hono 转发。
// 内部仍使用业务库，无任何硬编码 actor；网页前端不传 actor（默认 'user'）。

// 组合
app.get('/api/portfolios', async (c) => {
  try { return Response.json(await portfolios.listPortfolios(c.env.DB)); }
  catch (e) { return handleError(e); }
});
app.get('/api/portfolios/:id', async (c) => {
  try {
    const p = await portfolios.getPortfolio(c.env.DB, c.req.param('id'));
    return p ? Response.json(p) : Response.json({ error: '组合不存在' }, { status: 404 });
  } catch (e) { return handleError(e); }
});
app.post('/api/portfolios', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as { name?: string; description?: string };
    if (!body.name) return Response.json({ error: '组合名称不能为空' }, { status: 400 });
    const p = await portfolios.createPortfolio(c.env.DB, { name: body.name, description: body.description }, 'user');
    return Response.json(p, { status: 201 });
  } catch (e) { return handleError(e); }
});
app.put('/api/portfolios/:id', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as { name?: string; description?: string };
    const p = await portfolios.updatePortfolio(c.env.DB, c.req.param('id'), body, 'user');
    return p ? Response.json(p) : Response.json({ error: '组合不存在' }, { status: 404 });
  } catch (e) { return handleError(e); }
});
app.delete('/api/portfolios/:id', async (c) => {
  try {
    const ok = await portfolios.deletePortfolio(c.env.DB, c.req.param('id'), 'user');
    return ok ? Response.json({ success: true }) : Response.json({ error: '组合不存在' }, { status: 404 });
  } catch (e) { return handleError(e); }
});

// 项目
app.get('/api/portfolios/:portfolioId/projects', async (c) => {
  try {
    const inc = c.req.query('includeArchived') === 'true';
    return Response.json(await projects.listProjects(c.env.DB, c.req.param('portfolioId'), inc));
  } catch (e) { return handleError(e); }
});
app.get('/api/projects/:id', async (c) => {
  try {
    const p = await projects.getProject(c.env.DB, c.req.param('id'));
    return p ? Response.json(p) : Response.json({ error: '项目不存在' }, { status: 404 });
  } catch (e) { return handleError(e); }
});
app.post('/api/portfolios/:portfolioId/projects', async (c) => {
  try {
    const portfolioId = c.req.param('portfolioId');
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    if (!body.title || !body.owner) return Response.json({ error: '标题和负责人不能为空' }, { status: 400 });
    const created = await projects.createProject(c.env.DB, portfolioId, body as never, 'user');
    return Response.json(created, { status: 201 });
  } catch (e) { return handleError(e); }
});
app.put('/api/projects/:id', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const updated = await projects.updateProject(c.env.DB, c.req.param('id'), body as never, 'user');
    return updated ? Response.json(updated) : Response.json({ error: '项目不存在' }, { status: 404 });
  } catch (e) { return handleError(e); }
});
app.delete('/api/projects/:id', async (c) => {
  try {
    const ok = await projects.deleteProject(c.env.DB, c.req.param('id'), 'user');
    if (!ok) return Response.json({ error: '项目不存在' }, { status: 404 });
    return Response.json({ success: true });
  } catch (e) {
    if (e instanceof Error && e.message.includes('子项目')) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    return handleError(e);
  }
});
app.post('/api/projects/:id/complete', async (c) => {
  try {
    const p = await projects.completeProject(c.env.DB, c.req.param('id'), 'user');
    return p ? Response.json(p) : Response.json({ error: '项目不存在' }, { status: 404 });
  } catch (e) { return handleError(e); }
});
app.post('/api/projects/:id/archive', async (c) => {
  try {
    const result = await projects.archiveProject(c.env.DB, c.req.param('id'), 'user');
    return Response.json(result, { status: result.success ? 200 : 400 });
  } catch (e) { return handleError(e); }
});
app.get('/api/portfolios/:portfolioId/stats', async (c) => {
  try { return Response.json(await projects.getProjectStats(c.env.DB, c.req.param('portfolioId'))); }
  catch (e) { return handleError(e); }
});

// 步骤
app.get('/api/projects/:projectId/steps', async (c) => {
  try { return Response.json(await steps.listSteps(c.env.DB, c.req.param('projectId'))); }
  catch (e) { return handleError(e); }
});
app.get('/api/portfolios/:portfolioId/steps', async (c) => {
  try { return Response.json(await steps.listAllSteps(c.env.DB, c.req.param('portfolioId'))); }
  catch (e) { return handleError(e); }
});
app.post('/api/projects/:projectId/steps', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    if (!body.name) return Response.json({ error: '步骤名称不能为空' }, { status: 400 });
    const s = await steps.createStep(c.env.DB, c.req.param('projectId'), body as never, 'user');
    return Response.json(s, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message.includes('不存在')) {
      return Response.json({ error: e.message }, { status: 404 });
    }
    return handleError(e);
  }
});
app.put('/api/steps/:id', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const s = await steps.updateStep(c.env.DB, c.req.param('id'), body as never, 'user');
    return s ? Response.json(s) : Response.json({ error: '步骤不存在' }, { status: 404 });
  } catch (e) { return handleError(e); }
});
app.delete('/api/steps/:id', async (c) => {
  try {
    const ok = await steps.deleteStep(c.env.DB, c.req.param('id'), 'user');
    return ok ? Response.json({ success: true }) : Response.json({ error: '步骤不存在' }, { status: 404 });
  } catch (e) { return handleError(e); }
});

// Stage
app.get('/api/portfolios/:portfolioId/stages', async (c) => {
  try { return Response.json(await stages.listStages(c.env.DB, c.req.param('portfolioId'))); }
  catch (e) { return handleError(e); }
});
app.post('/api/portfolios/:portfolioId/stages', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as { name?: string };
    if (!body.name) return Response.json({ error: 'Stage 名称不能为空' }, { status: 400 });
    const s = await stages.createStage(c.env.DB, c.req.param('portfolioId'), { name: body.name }, 'user');
    return Response.json(s, { status: 201 });
  } catch (e) { return handleError(e); }
});
app.put('/api/stages/:id', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as { name?: string };
    const result = await stages.updateStage(c.env.DB, c.req.param('id'), body.name || '', 'user');
    return result.success ? Response.json(result.stage) : Response.json(result, { status: 400 });
  } catch (e) { return handleError(e); }
});
app.delete('/api/stages/:id', async (c) => {
  try {
    const result = await stages.deleteStage(c.env.DB, c.req.param('id'), 'user');
    return Response.json(result, { status: result.success ? 200 : 400 });
  } catch (e) { return handleError(e); }
});

// 审计
app.get('/api/portfolios/:portfolioId/audit', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    return Response.json(await audit.listAuditEvents(c.env.DB, c.req.param('portfolioId'), limit, offset));
  } catch (e) { return handleError(e); }
});
app.get('/api/audit/:type/:id', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '20');
    return Response.json(await audit.getAuditHistory(c.env.DB, c.req.param('type'), c.req.param('id'), limit));
  } catch (e) { return handleError(e); }
});

// 项目关联资料
app.get('/api/projects/:projectId/links', async (c) => {
  try { return Response.json(await projectLinks.listProjectLinks(c.env.DB, c.req.param('projectId'))); }
  catch (e) { return handleError(e); }
});
app.post('/api/projects/:projectId/links', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as { title?: string; url?: string };
    if (!body.title || !body.url) return Response.json({ error: '标题和 URL 不能为空' }, { status: 400 });
    const link = await projectLinks.createProjectLink(c.env.DB, c.req.param('projectId'), body, 'user');
    return Response.json(link, { status: 201 });
  } catch (e) {
    if (e instanceof Error) {
      if (e.message.includes('不存在')) return Response.json({ error: e.message }, { status: 404 });
      if (e.message.includes('http')) return Response.json({ error: e.message }, { status: 400 });
    }
    return handleError(e);
  }
});
app.put('/api/links/:id', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as { title?: string; url?: string };
    const link = await projectLinks.updateProjectLink(c.env.DB, c.req.param('id'), body, 'user');
    return link ? Response.json(link) : Response.json({ error: '关联资料不存在' }, { status: 404 });
  } catch (e) {
    if (e instanceof Error && e.message.includes('http')) return Response.json({ error: e.message }, { status: 400 });
    return handleError(e);
  }
});
app.delete('/api/links/:id', async (c) => {
  try {
    const ok = await projectLinks.deleteProjectLink(c.env.DB, c.req.param('id'), 'user');
    return ok ? Response.json({ success: true }) : Response.json({ error: '关联资料不存在' }, { status: 404 });
  } catch (e) { return handleError(e); }
});

// 甘特图
app.get('/api/portfolios/:portfolioId/gantt', async (c) => {
  try {
    const portfolioId = c.req.param('portfolioId');
    const start = c.req.query('start') || defaultStartDate();
    const end = c.req.query('end') || defaultEndDate();
    const scale = (c.req.query('scale') || 'week') as 'day' | 'week' | 'month';
    const ps = await projects.listProjects(c.env.DB, portfolioId, false);
    const ss = await steps.listAllSteps(c.env.DB, portfolioId);
    return Response.json(buildGanttData(ps, ss, start, end, scale));
  } catch (e) { return handleError(e); }
});

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().split('T')[0];
}
function defaultEndDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return d.toISOString().split('T')[0];
}

// ==================== 备份管理 API（WP-008）====================
// 全部需要登录会话保护；无任何公开端点。

// 列出最近备份
app.get('/api/backups', async (c) => {
  try {
    const entries = await listBackups(c.env.BACKUPS);
    // 只返回元数据，不返回表内容
    return Response.json(entries.map(e => ({
      key: e.key,
      size: e.size,
      createdAt: e.createdAt,
      contentSha256: e.contentSha256,
    })));
  } catch (e) { return handleError(e); }
});

// 备份就绪状态（WP-008 L2：告知 UI 隔离恢复库是否可用）
app.get('/api/backups/status', async (c) => {
  // 受 /api/* 中间件保护，未登录返回 401
  // 不泄漏 D1 ID、数据库名称、secret 或 R2 内容
  const available = !!c.env.RESTORE_DRILL_DB;
  return Response.json({ restoreDrillAvailable: available }, { headers: noStoreHeaders() });
});

// 手动触发一次备份
app.post('/api/backups', async (c) => {
  try {
    const { manifest, key } = await createBackup(c.env.DB, c.env.BACKUPS);
    return Response.json({
      ok: true,
      key,
      createdAt: manifest.createdAt,
      contentSha256: manifest.contentSha256,
      tableSummaries: manifest.tableSummaries,
    }, { status: 201, headers: noStoreHeaders() });
  } catch (e) { return handleError(e); }
});

// 恢复演练（仅恢复到隔离 D1 RESTORE_DRILL_DB，绝不覆盖生产）
// 唯一恢复目标：代码中显式固定的 env.RESTORE_DRILL_DB
app.post('/api/backups/restore', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as { key?: string };
    if (!body.key) return Response.json({ error: 'backup key 不能为空' }, { status: 400, headers: noStoreHeaders() });

    // 唯一恢复目标：env.RESTORE_DRILL_DB
    // 禁止通过请求体传 targetDbBinding，禁止动态索引 env[用户输入]
    const drillDb = c.env.RESTORE_DRILL_DB;
    if (!drillDb) {
      return Response.json({
        error: '恢复演练隔离库尚未由管理员配置（RESTORE_DRILL_DB 未绑定）',
      }, { status: 503, headers: noStoreHeaders() });
    }

    const result = await restoreBackup(c.env.BACKUPS, body.key, drillDb);
    return Response.json({ ok: true, ...result }, { headers: noStoreHeaders() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 400, headers: noStoreHeaders() });
  }
});

// API 兜底：未匹配的 /api/* 返回 404 JSON
app.all('/api/*', (c) => {
  return Response.json({ error: '接口不存在' }, { status: 404, headers: noStoreHeaders() });
});

// 静态资源：非 /api/* 与 /mcp 请求由 env.ASSETS 提供。
// 已登录请求直达资源；未登录请求由上面的中间件提前 302 到 /login，
// 因此这里的兜底不再放行未鉴权访问 HTML 主页。
// 对于 e2e 测试（用 Miniflare + 不带 ASSETS 重写），允许通过 env.SHAK_PMO_INJECT_INDEX_HTML
// / env.SHAK_PMO_INJECT_LOGIN_HTML 直接返回静态内容兜底；生产不会设置这些 env。
async function injectStatic(c, key, fallbackPath) {
  try {
    const r = await c.env.ASSETS.fetch(new Request(new URL(fallbackPath, c.req.url).toString(), c.req.raw));
    if (r && r.ok) return r;
  } catch {}
  const fallback = c.env[key];
  if (typeof fallback === 'string' && fallback.length) {
    return new Response(fallback, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  return new Response('Asset not available', { status: 503, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
}

app.all('*', async (c) => {
  const url = new URL(c.req.url);
  // /agent/* 永久不存在：返回 404（静态分发已移除，Skill 仅通过 GitHub raw 安装）
  if (url.pathname.startsWith('/agent/')) {
    return Response.json({ error: 'Agent Skill 静态分发已移除，请通过 /api/agent/install 获取安装指令' }, {
      status: 404,
      headers: noStoreHeaders(),
    });
  }
  if (url.pathname === '/login' || url.pathname === '/login.html') {
    return injectStatic(c, 'SHAK_PMO_INJECT_LOGIN_HTML', '/login.html');
  }
  if (url.pathname === '/' || url.pathname === '') {
    return injectStatic(c, 'SHAK_PMO_INJECT_INDEX_HTML', '/index.html');
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

// ==================== Worker Default Export ====================
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // /mcp 始终走 MCP 处理器，与网页登录完全分离，绝不被 Hono 拦截
    if (url.pathname === '/mcp') {
      return handleMcp(request, env, ctx);
    }
    // 其它：Hono 默认处理
    return app.fetch(request, env, ctx);
  },

  // 每天 UTC 03:00 由 wrangler.toml cron 触发一次逻辑备份
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const result = await runScheduledBackup(env);
    if (!result.ok) {
      // cron 失败不抛异常（wrangler 会记录日志），但记录到控制台
      console.error('[scheduled] R2 备份失败:', result.error);
    } else {
      console.log('[scheduled] R2 备份成功:', result.key);
    }
  },
};
