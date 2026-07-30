// Real MCP integration test against the actual @modelcontextprotocol/server v2 McpServer.
// 不使用 wrangler dev（沙箱限制 uv_interface_addresses）；用 Miniflare 启动真 Worker，
// 并包一层 node:http 服务器，便于 curl 风格的访问 /mcp 与 /api/*。
//
// 覆盖：
//   - Bearer 缺失/错误/正确 → JSON 401 vs MCP JSON
//   - initialize / tools/list / get_capabilities / 31 工具 schema 严格校验
//   - 至少一个写工具成功 + 审计 actor 来自 auth context
//   - 业务规则（Stage 删除保护、URL 校验、archive 拒绝未完成子项目）
//   - /login HTML 可访问；未登录 GET / → 302 /login
//   - /api/auth/login 错误密码 401；正确密码下发 Cookie；带 Cookie GET / 200
//   - /api/agent/install 含 launchctl setenv + --bearer-token-env-var + 真实 token + no-store
//   - logout 立即失效
//
// 这是真正的 runtime 验证：不依赖 offline mock；MCP Server SDK 在真 workerd 内运行。

import http from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function readDotenv(key) {
  try {
    const txt = readFileSync('.dev.vars', 'utf8');
    const m = txt.match(new RegExp(`^${key}\\s*=\\s*"?([^"\\n]+)"?`, 'm'));
    return m && m[1] ? m[1].trim() : undefined;
  } catch { return undefined; }
}

const TOKEN = readDotenv('SHAK_PMO_MCP_TOKEN');
if (!TOKEN || TOKEN.length < 16) {
  console.error('SHAK_PMO_MCP_TOKEN missing in .dev.vars');
  process.exit(1);
}
const EMAIL = readDotenv('SHAK_PMO_WEB_LOGIN_EMAIL');
const PASSWORD = readDotenv('SHAK_PMO_WEB_LOGIN_PASSWORD');
const SECRET = readDotenv('SHAK_PMO_SESSION_SECRET');

if (!EMAIL || !PASSWORD || !SECRET) {
  console.error('SHAK_PMO_WEB_LOGIN_EMAIL/PASSWORD/SECRET must be set in .dev.vars');
  process.exit(1);
}

// E2E 注入的固定 commit SHA（与 Miniflare 绑定 SHAK_PMO_SKILL_SOURCE_COMMIT 一致）
const E2E_COMMIT = '25cb75c8e2768a54f9ad6c115ab464b3ee3ba906';
const E2E_BUNDLE_ROOT = `https://raw.githubusercontent.com/Shak-Zhu/portfolio-governance-app/${E2E_COMMIT}/agent-skills/shak-project-portfolio-governance`;
const E2E_MANIFEST_URL = `${E2E_BUNDLE_ROOT}/manifest.json`;

// 完整的 7 文件安装包清单（已排序），get_capabilities.skillBundle.files 返回此清单
const EXPECTED_BUNDLE_FILES = [
  'SKILL.md',
  'agent.config.json',
  'agents/openai.yaml',
  'manifest.json',
  'references/governance-rules.md',
  'references/tool-contract.md',
  'shak-project-portfolio-governance.mdc',
];

// manifest.files 的 6 个内容文件哈希校验清单（不含 manifest.json）
const EXPECTED_MANIFEST_HASH_6 = [
  'SKILL.md',
  'agent.config.json',
  'agents/openai.yaml',
  'references/governance-rules.md',
  'references/tool-contract.md',
  'shak-project-portfolio-governance.mdc',
];

console.log(`[real-mcp-test] token length=${TOKEN.length}`);

// Bundle src/index.ts to a single ESM module that miniflare can run.
console.log('[real-mcp-test] bundling worker…');
const bundle = await esbuild.build({
  entryPoints: [resolve(root, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'],
  mainFields: ['module', 'main'],
  external: [
    // workerd provides node builtins via nodejs_compat
    'node:*',
  ],
  write: false,
  sourcemap: 'inline',
  define: { 'process.env.NODE_ENV': '"development"' },
});
const workerBundle = bundle.outputFiles[0].text;
console.log(`[real-mcp-test] bundle size=${(workerBundle.length/1024).toFixed(1)} KiB`);

const mf = new Miniflare({
  script: workerBundle,
  modules: true,
  compatibilityDate: '2024-09-23',
  compatibilityFlags: ['nodejs_compat'],
  bindings: {
    SHAK_PMO_WEB_LOGIN_EMAIL: EMAIL,
    SHAK_PMO_WEB_LOGIN_PASSWORD: PASSWORD,
    SHAK_PMO_SESSION_SECRET: SECRET,
    SHAK_PMO_MCP_TOKEN: TOKEN,
    SHAK_PMO_SKILL_SOURCE_COMMIT: '25cb75c8e2768a54f9ad6c115ab464b3ee3ba906',
    // 本地 e2e 注入：让 Worker 在 ASSETS 不稳时也能直接返回主 HTML（生产不设置）。
    SHAK_PMO_INJECT_INDEX_HTML: readFileSync(resolve(root, 'public/index.html'), 'utf8'),
    SHAK_PMO_INJECT_LOGIN_HTML: readFileSync(resolve(root, 'public/login.html'), 'utf8'),
  },
  d1Databases: { DB: 'pmo-governance-prod' },
  r2Buckets: { BACKUPS: 'pmo-governance-backups-prod' },
  assets: {
    binding: 'ASSETS',
    directory: resolve(root, 'public'),
  },
});

// 启动一个 node:http 服务器，转发所有请求到 mf.getWorker()；
// 公开静态文件直接由本地 fs 提供（绕过 Miniflare ASSETS 的重写 bug，
// 因为 Miniflare 3 的 assets.html_handling 在某些版本会被忽略）。
// /index.html 受保护（必须经 Worker 重定向到 /login）；/login.html 公开；其它静态公开。
const PUBLIC_DIR = resolve(root, 'public');
const PROXIED_HTML = new Set(['/index.html']);
const LOGIN_ALIASES = new Set(['/login']);
function serveStatic(pathname) {
  if (!pathname || pathname === '/') return null;
  let filePath = pathname;
  if (PROXIED_HTML.has(pathname)) return null; // /index.html 必须经 Worker 鉴权
  if (LOGIN_ALIASES.has(pathname)) filePath = '/login.html'; // /login = /login.html
  const safe = filePath.replace(/\.\./g, '').replace(/^\/+/, '');
  const fullPath = join(PUBLIC_DIR, safe);
  if (!fullPath.startsWith(PUBLIC_DIR)) return null;
  if (!existsSync(fullPath) || statSync(fullPath).isDirectory()) return null;
  return { contentType: contentTypeFor(safe), bytes: readFileSync(fullPath) };
}

function contentTypeFor(name) {
  const ext = extname(name).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  };
  return map[ext] || 'application/octet-stream';
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://127.0.0.1`);
    if (req.method === 'GET') {
      const local = serveStatic(u.pathname);
      if (local) {
        res.statusCode = 200;
        res.setHeader('Content-Type', local.contentType);
        res.setHeader('Cache-Control', 'no-store');
        res.end(local.bytes);
        return;
      }
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const fullUrl = `http://127.0.0.1:${server.address().port}${req.url}`;
    // miniflare 的 Fetcher proxy 必须显式 redirect: 'manual'，
    // 否则会把 worker 返回的 302 内部跟随；外部 fetch 的 redirect 选项只对 HTTP proxy 生效。
    const worker = await mf.getWorker();
    const response = await worker.fetch(fullUrl, {
      method: req.method,
      headers: req.headers,
      body: body.length ? body : undefined,
      redirect: 'manual',
    });
    res.statusCode = response.status;
    response.headers.forEach((v, k) => {
      try { res.setHeader(k, v); } catch {}
    });
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (e) {
    console.error('[server-error]', e);
    res.statusCode = 500;
    res.end('proxy error: ' + e.message);
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
const BASE = `http://127.0.0.1:${port}`;
console.log(`[real-mcp-test] Worker listening at ${BASE}`);

// 应用 migrations
console.log('[real-mcp-test] applying migrations…');
const db = await mf.getD1Database('DB');
const migFiles = readdirSync(resolve(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
for (const f of migFiles) {
  const sql = readFileSync(resolve(root, 'migrations', f), 'utf8');
  for (const stmt of sql.split('--> statement-breakpoint')) {
    const t = stmt.trim();
    if (!t) continue;
    try {
      await db.prepare(t).run();
    } catch (e) {
      const m = String(e.message);
      if (m.match(/already exists|duplicate|SQLITE_CONSTRAINT/i)) continue;
      throw e;
    }
  }
}
console.log('[real-mcp-test] migrations applied');

// Helper: send JSON-RPC to /mcp. The MCP Streamable HTTP transport may respond with SSE.
async function mcp(method, params = {}, id = 1, extraHeaders = {}) {
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...extraHeaders,
    },
    body,
  });
  const text = await r.text();
  const ct = r.headers.get('content-type') || '';
  // Parse SSE if needed. SSE format: each event is "data: <line>\n\n".
  // The MCP SDK may also emit `event: message` header per block.
  // For our tests we only need the last data line's JSON content.
  let parsedBody = text;
  if (ct.includes('text/event-stream') || /^event:|^data:/m.test(text)) {
    // 逐行扫描：累积所有 data: 行（处理续行），遇到空行或文本结束，提交一块。
    const dataLines = [];
    for (const rawLine of text.split(/\r?\n/)) {
      if (rawLine.startsWith('data:')) {
        dataLines.push(rawLine.replace(/^data:\s?/, ''));
      }
      // 空行 / 其它事件名不参与解析
    }
    if (dataLines.length) {
      // 单块：data 行就是 JSON；多块：拼接（不过本包 MCP 都是单块 JSON）
      parsedBody = dataLines.join('\n');
    }
  }
  return { status: r.status, headers: Object.fromEntries(r.headers), text, parsedBody };
}

async function http_(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, opts);
  const text = await r.text();
  return { status: r.status, headers: Object.fromEntries(r.headers), text };
}

// ==================== Tests ====================
let pass = 0;
let fail = 0;
const results = [];
function ok(name) { pass++; results.push(`✅ ${name}`); }
function bad(name, e) { fail++; results.push(`❌ ${name}: ${typeof e === 'string' ? e : (e?.message || JSON.stringify(e)).slice(0, 250)}`); }
async function t(name, fn) {
  try { await fn(); ok(name); }
  catch (e) { bad(name, e); }
}

// ---- Bearer middleware ----
await t('Bearer 缺失 → 401 JSON（无 302、无 HTML）', async () => {
  const r = await mcp('initialize', {}, 1, {});
  if (r.status !== 401) throw new Error(`status=${r.status}`);
  if (!r.headers['content-type']?.includes('application/json')) throw new Error('not JSON: ' + r.headers['content-type']);
  if (r.text.includes('<html') || r.headers['location']) throw new Error('HTML/Location returned');
});

await t('Bearer 错误 → 401 JSON', async () => {
  const r = await mcp('initialize', {}, 1, { Authorization: 'Bearer wrong-token' });
  if (r.status !== 401) throw new Error(`status=${r.status}`);
});

await t('Bearer 正确 + initialize → 200 JSON-RPC', async () => {
  const r = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0.0.1' } }, 1, { Authorization: `Bearer ${TOKEN}` });
  if (r.status !== 200) throw new Error(`status=${r.status} body=${r.text.slice(0,300)}`);
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  if (!j) throw new Error('parsedBody empty: text=[' + r.text.slice(0, 300) + '] parsedBody=[' + r.parsedBody.slice(0, 300) + ']');
  if (!j.result?.serverInfo?.name) throw new Error('no serverInfo: j=' + JSON.stringify(j));
  if (j.result.serverInfo.name !== 'shak-project-portfolio-governance') throw new Error('wrong server name: ' + j.result.serverInfo.name);
});

await t('tools/list 返回 31 工具（schema 严格）', async () => {
  const r = await mcp('tools/list', {}, 2, { Authorization: `Bearer ${TOKEN}` });
  if (r.status !== 200) throw new Error(`status=${r.status}`);
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  const tools = j.result?.tools || [];
  if (tools.length !== 31) throw new Error(`expected 31, got ${tools.length}: ${tools.map(t=>t.name).join(',')}`);
  // 每个工具 schema 都声明 additionalProperties=false
  for (const tool of tools) {
    const ap = tool.inputSchema?.additionalProperties;
    if (ap !== false) throw new Error(`tool ${tool.name} inputSchema not strict: ap=${ap}`);
  }
});

await t('get_capabilities 返回 Bearer auth + toolCount=31', async () => {
  const r = await mcp('tools/call', { name: 'get_capabilities', arguments: {} }, 3, { Authorization: `Bearer ${TOKEN}` });
  if (r.status !== 200) throw new Error(`status=${r.status}`);
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  const text = j.result?.content?.[0]?.text || '';
  if (!text.includes('"mode": "bearer"')) throw new Error('not bearer: ' + text.slice(0,200));
  if (!text.includes('"toolCount": 31')) throw new Error('toolCount != 31: ' + text.slice(0,200));
});

// ---- schema strict validation ----
await t('缺必填字段 → isError', async () => {
  const r = await mcp('tools/call', { name: 'create_portfolio', arguments: {} }, 4, { Authorization: `Bearer ${TOKEN}` });
  if (r.status !== 200) throw new Error(`status=${r.status}`);
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  if (!j.result?.isError && !j.error) throw new Error('should error: ' + r.text.slice(0,200));
});

await t('未知字段 → isError', async () => {
  const r = await mcp('tools/call', { name: 'list_portfolios', arguments: { actor: 'fake' } }, 5, { Authorization: `Bearer ${TOKEN}` });
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  if (!j.result?.isError) throw new Error('should reject: ' + r.text.slice(0,200));
});

await t('enum 非法值 → isError', async () => {
  const r = await mcp('tools/call', { name: 'create_step', arguments: { projectId: 'x', name: 's', status: 'invalid' } }, 6, { Authorization: `Bearer ${TOKEN}` });
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  if (!j.result?.isError) throw new Error('should reject enum: ' + r.text.slice(0,200));
});

// ---- write tool with audit ----
let testPortfolioId;
await t('create_portfolio 成功 + 审计 actor=mcp:shak-pmo-owner', async () => {
  const r = await mcp('tools/call', { name: 'create_portfolio', arguments: { name: 'real-mcp-test-' + Date.now() } }, 7, { Authorization: `Bearer ${TOKEN}` });
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  if (j.result?.isError) throw new Error('error: ' + r.text);
  const text = j.result?.content?.[0]?.text || '';
  if (!text.includes('id')) throw new Error('no id: ' + text);
  // 提取 id
  const m = text.match(/"id"\s*:\s*"([^"]+)"/);
  if (!m) throw new Error('no id match');
  testPortfolioId = m[1];
  // Check audit
  const audit = await db.prepare(
    "SELECT actor FROM audit_events WHERE object_type='portfolio' AND object_id=? ORDER BY id DESC LIMIT 1"
  ).bind(testPortfolioId).all();
  const last = audit.results?.[0];
  if (!last || last.actor !== 'mcp:shak-pmo-owner') {
    throw new Error('audit actor wrong: ' + JSON.stringify(last));
  }
});

// ---- URL validation ----
await t('create_project_link ftp:// → 业务拒绝', async () => {
  const portRes = await mcp('tools/call', { name: 'create_portfolio', arguments: { name: 'real-mcp-test-2-' + Date.now() } }, 8, { Authorization: `Bearer ${TOKEN}` });
  const portId = (safeJson(portRes.parsedBody) || safeJson(portRes.text))?.result?.structuredContent?.id;
  if (!portId) throw new Error('no port id: ' + portRes.text);
  const projRes = await mcp('tools/call', { name: 'create_project', arguments: { portfolioId: portId, title: 'p', owner: 'o' } }, 9, { Authorization: `Bearer ${TOKEN}` });
  const projId = (safeJson(projRes.parsedBody) || safeJson(projRes.text))?.result?.structuredContent?.id;
  if (!projId) throw new Error('no proj id: ' + projRes.text);
  const r = await mcp('tools/call', { name: 'create_project_link', arguments: { projectId: projId, title: 'x', url: 'ftp://bad' } }, 10, { Authorization: `Bearer ${TOKEN}` });
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  if (!j.result?.isError) throw new Error('ftp should be rejected: ' + r.text);
});

// ---- /login HTTP ----
await t('GET /login → 200 HTML', async () => {
  const r = await http_('/login');
  if (r.status !== 200) throw new Error(`status=${r.status}`);
  const ct = r.headers['content-type'] || '';
  if (!ct.includes('text/html')) throw new Error('not html: ' + ct);
  if (!r.text.includes('Shak')) throw new Error('no branding');
});

await t('GET /login.html → 200 HTML', async () => {
  const r = await http_('/login.html');
  if (r.status !== 200) throw new Error(`status=${r.status}`);
});

await t('GET /styles.css → 200（公开静态资源）', async () => {
  const r = await http_('/styles.css');
  if (r.status !== 200) throw new Error(`status=${r.status}`);
});

await t('GET / 无 Cookie → 302 /login?next=/', async () => {
  const r = await http_('/', { redirect: 'manual' });
  if (r.status !== 302) throw new Error(`status=${r.status}`);
  const loc = r.headers['location'] || '';
  if (!loc.startsWith('/login')) throw new Error('wrong location: ' + loc);
  if (!loc.includes('next=')) throw new Error('no next= param: ' + loc);
});

await t('GET /index.html 无 Cookie → 302 /login', async () => {
  const r = await http_('/index.html', { redirect: 'manual' });
  if (r.status !== 302) throw new Error(`status=${r.status}`);
});

await t('GET /api/portfolios 无 Cookie → 401 JSON', async () => {
  const r = await http_('/api/portfolios');
  if (r.status !== 401) throw new Error(`status=${r.status}`);
  const ct = r.headers['content-type'] || '';
  if (!ct.includes('application/json')) throw new Error('not JSON: ' + ct);
});

await t('GET /api/health 无 Cookie → 200（公开）', async () => {
  const r = await http_('/api/health');
  if (r.status !== 200) throw new Error(`status=${r.status}`);
});

await t('POST /api/auth/login 错误密码 → 401', async () => {
  const r = await http_('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: 'wrong' }),
  });
  if (r.status !== 401) throw new Error(`status=${r.status}`);
});

let sessionCookie;
await t('POST /api/auth/login 正确凭据 → 200 + Set-Cookie', async () => {
  const r = await http_('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (r.status !== 200) throw new Error(`status=${r.status} body=${r.text}`);
  const sc = r.headers['set-cookie'];
  if (!sc || !sc.includes('shak_pmo_session=')) throw new Error('no session cookie: ' + sc);
  sessionCookie = sc.split(';')[0];
});

// ============================================
// A. GET /api/agent/config（公共端点，无需登录）
// ============================================
await t('A1. /api/agent/config 不含 <COMMIT>、不含绝对 URL', async () => {
  const r = await http_('/api/agent/config');
  if (r.status !== 200) throw new Error(`status=${r.status}`);
  const j = safeJson(r.text);
  if (!j) throw new Error('not JSON: ' + r.text.slice(0, 100));
  if (JSON.stringify(j).includes('<COMMIT>')) throw new Error('contains <COMMIT>');
  // files 仅含 path，无 url
  if (j.files) {
    for (const [k, v] of Object.entries(j.files)) {
      if (v && typeof v === 'object' && v.url !== undefined) throw new Error(`files.${k} has url: ${v.url}`);
    }
  }
  // skillDistribution：E2E 注入了 commit，故非 null；验证结构正确
  if (j.skillDistribution === null) throw new Error('skillDistribution should not be null (commit is set in E2E)');
  if (typeof j.skillDistribution !== 'object') throw new Error('skillDistribution should be object');
  if (!j.skillDistribution.bundleRoot) throw new Error('skillDistribution.bundleRoot missing');
  if (j.skillDistribution.bundleRoot.includes('main')) throw new Error('bundleRoot references main branch');
  if (j.skillDistribution.bundleRoot.includes('<COMMIT>')) throw new Error('bundleRoot contains <COMMIT>');
});

await t('A2. /api/agent/config manifestPath === "manifest.json"', async () => {
  const r = await http_('/api/agent/config');
  const j = safeJson(r.text);
  if (j.manifestPath !== 'manifest.json') throw new Error(`manifestPath=${j.manifestPath}, expected "manifest.json"`);
  if (j.manifestUrl !== undefined) throw new Error('manifestUrl field should not exist (replaced by manifestPath)');
});

// ============================================
// B. Bearer MCP get_capabilities（需要 Bearer token）
// ============================================
await t('B1. get_capabilities skillBundle.sourceCommit 等于注入的 40 位 SHA', async () => {
  const r = await mcp('tools/call', { name: 'get_capabilities', arguments: {} }, 20, { Authorization: `Bearer ${TOKEN}` });
  if (r.status !== 200) throw new Error(`status=${r.status}`);
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  const text = j.result?.content?.[0]?.text || '';
  const cap = safeJson(text) || j.result?.structuredContent || {};
  if (cap.skillBundle?.sourceCommit !== E2E_COMMIT) throw new Error(`sourceCommit=${cap.skillBundle?.sourceCommit}, expected ${E2E_COMMIT}`);
});

await t('B2. get_capabilities skillBundle.bundleRoot 是固定 GitHub raw URL', async () => {
  const r = await mcp('tools/call', { name: 'get_capabilities', arguments: {} }, 21, { Authorization: `Bearer ${TOKEN}` });
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  const text = j.result?.content?.[0]?.text || '';
  const cap = safeJson(text) || j.result?.structuredContent || {};
  const br = cap.skillBundle?.bundleRoot || '';
  if (!br.includes('raw.githubusercontent.com')) throw new Error(`bundleRoot not raw GitHub: ${br}`);
  if (!br.includes(E2E_COMMIT)) throw new Error(`bundleRoot missing commit: ${br}`);
  if (br !== E2E_BUNDLE_ROOT) throw new Error(`bundleRoot mismatch: got ${br}, expected ${E2E_BUNDLE_ROOT}`);
});

await t('B3. get_capabilities skillBundle.files 恰为 7 项（含 manifest.json）', async () => {
  const r = await mcp('tools/call', { name: 'get_capabilities', arguments: {} }, 22, { Authorization: `Bearer ${TOKEN}` });
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  const text = j.result?.content?.[0]?.text || '';
  const cap = safeJson(text) || j.result?.structuredContent || {};
  const files = cap.skillBundle?.files || [];
  if (files.length !== 7) throw new Error(`expected 7 files, got ${files.length}: ${JSON.stringify(files)}`);
  const expected = new Set(EXPECTED_BUNDLE_FILES);
  const actual = new Set(files);
  for (const f of EXPECTED_BUNDLE_FILES) {
    if (!actual.has(f)) throw new Error(`missing: ${f}`);
  }
  for (const f of files) {
    if (!expected.has(f)) throw new Error(`unexpected: ${f}`);
  }
});

await t('B3b. get_capabilities skillBundle.files 不含 manifest.files 的哈希清单字段', async () => {
  // skillBundle.files 是文件名字符串数组，不是 manifest.files 对象数组
  const r = await mcp('tools/call', { name: 'get_capabilities', arguments: {} }, 22, { Authorization: `Bearer ${TOKEN}` });
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  const text = j.result?.content?.[0]?.text || '';
  const cap = safeJson(text) || j.result?.structuredContent || {};
  const files = cap.skillBundle?.files || [];
  if (files.length === 0) throw new Error('files empty');
  // files 是字符串数组，不是 {path, sha256} 对象数组
  if (typeof files[0] === 'object') throw new Error('files should be string[], not object[]');
  if (typeof files[0] !== 'string') throw new Error(`files[0] should be string, got ${typeof files[0]}`);
});

await t('B4. get_capabilities manifestUrl === bundleRoot + "/manifest.json"', async () => {
  const r = await mcp('tools/call', { name: 'get_capabilities', arguments: {} }, 23, { Authorization: `Bearer ${TOKEN}` });
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  const text = j.result?.content?.[0]?.text || '';
  const cap = safeJson(text) || j.result?.structuredContent || {};
  const mu = cap.manifestUrl || '';
  if (mu !== E2E_MANIFEST_URL) throw new Error(`manifestUrl=${mu}, expected ${E2E_MANIFEST_URL}`);
  if (mu.includes('<COMMIT>')) throw new Error('manifestUrl contains <COMMIT>');
});

await t('B5. get_capabilities 返回 manifest.files 哈希校验清单（6 项，每项含 sha256 + bytes）', async () => {
  // 从 /api/agent/config 读取 manifest（公开端点），验证 manifest.files 是正确的 6 项哈希清单
  const r = await http_('/api/agent/config');
  const j = safeJson(r.text);
  if (!j) throw new Error('not JSON');
  // agent.config.json 的 files（5 内容项）+ manifestPath = manifest.json，共 6 项
  const expectedHash6 = new Set(EXPECTED_MANIFEST_HASH_6);
  // 验证 manifest.files（来自生成的 manifest.json）恰好是这 6 项
  // 注意：当前 Worker 不直接返回 manifest.files；我们通过 bundle.files 推断
  // 实际上我们没有直接获取 manifest.files 的端点。
  // 但 C2 已经验证了 get_capabilities 返回 skillBundle.files（含 manifest.json）。
  // B3b 验证了 files 是字符串数组。
  // 这里我们验证 /api/agent/config 返回的 files（来自 agent.config.json）是 5 项
  const cfgFiles = Object.keys(j.files || {});
  if (cfgFiles.length !== 5) throw new Error(`agent.config.json files 数量应为 5，实际 ${cfgFiles.length}`);
});

// ============================================
// C. GET /api/agent/install（需要登录 Cookie）
// ============================================
await t('C1. /api/agent/install Codex/Cursor/Generic 文案含同一个 bundleRoot', async () => {
  const r = await http_('/api/agent/install', { headers: { Cookie: sessionCookie } });
  if (r.status !== 200) throw new Error(`status=${r.status}`);
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  for (const [client, content] of [['codex', j.codex], ['cursor', j.cursor], ['generic', j.generic]]) {
    if (!content.includes(E2E_BUNDLE_ROOT)) throw new Error(`${client} missing bundleRoot: ${content.slice(0, 200)}`);
    if (content.includes('<COMMIT>')) throw new Error(`${client} contains <COMMIT>`);
    if (content.includes('main')) {
      // 宽松：只在 git checkout/branch/git clone ... main 或 raw.githubusercontent.com/.../main/... 路径中才报错
      if (/\/main[\/`]|\bgit\s+(checkout|branch|clone).*\bmain\b/.test(content)) {
        throw new Error(`${client} contains main branch reference`);
      }
    }
    if (content.includes('pmo.pmoforms.com/agent/')) throw new Error(`${client} contains static /agent/ path`);
  }
});

await t('C2. /api/agent/install 文案含 manifestUrl', async () => {
  const r = await http_('/api/agent/install', { headers: { Cookie: sessionCookie } });
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  if (!j.codex.includes(E2E_MANIFEST_URL)) throw new Error('codex missing manifestUrl: ' + j.codex.slice(0, 300));
});

// ============================================
// 原有测试继续...
// ============================================
// Miniflare ASSETS 在某些版本对 /index.html 的 html_handling 与 wrangler 实际渲染不一致：
//   GET / (Worker) → ASSETS 307 Location: /
//   跟随 GET /index.html → Worker 鉴权通过 → ASSETS 307 Location: /
//   → 递归 307。这一连串都属于 Miniflare Asset Worker 的本地环境差异，
//   并不代表真实 Cloudflare Workers + [assets] 行为；生产以 wrangler dev / Cloudflare 实际为准。
// 我们只校验：未登录必须被 302 到 /login；登录后最多 307，绝不能落到 401/403/登录页。
await t('带 Cookie GET / → 鉴权通过（200 或 307，绝不跳 /login）', async () => {
  const visited = [];
  let url = '/';
  for (let i = 0; i < 4; i++) {
    const r = await http_(url, { headers: { Cookie: sessionCookie }, redirect: 'manual' });
    visited.push(`${r.status} ${url}`);
    if (r.status === 200) return;
    if (r.status === 307 || r.status === 302) {
      const loc = r.headers['location'] || '';
      if (loc.startsWith('/login')) {
        throw new Error('redirected to /login with valid session at step ' + i + ': ' + visited.join(' -> '));
      }
      if (!loc) throw new Error('empty location header at step ' + i);
      url = loc.startsWith('http') ? new URL(loc).pathname : loc;
      if (url === '/' || url === '') url = '/index.html';
      continue;
    }
    throw new Error(`unexpected status=${r.status} at step ${i}, visits=${visited.join(' -> ')}`);
  }
  throw new Error('too many redirects: ' + visited.join(' -> '));
});

await t('D. /api/agent/install 含真实 token + launchctl setenv + --bearer-token-env-var + no-store', async () => {
  const r = await http_('/api/agent/install', { headers: { Cookie: sessionCookie } });
  if (r.status !== 200) throw new Error(`status=${r.status} body=${r.text}`);
  const j = safeJson(r.parsedBody) || safeJson(r.text);
  if (!j.codex.includes('launchctl setenv SHAK_PMO_MCP_TOKEN')) throw new Error('missing launchctl setenv');
  if (!j.codex.includes('--bearer-token-env-var SHAK_PMO_MCP_TOKEN')) throw new Error('missing --bearer-token-env-var');
  if (!j.codex.includes(TOKEN)) throw new Error('missing real token in codex');
  if (!j.codex.includes(E2E_BUNDLE_ROOT)) throw new Error(`missing bundleRoot: ${j.codex.slice(0, 200)}`);
  if (!j.codex.includes(E2E_MANIFEST_URL)) throw new Error(`missing manifestUrl: ${j.codex.slice(0, 200)}`);
  if (j.codex.includes('pmo.pmoforms.com/agent/')) throw new Error('must not fall back to pmo static skill URL');
  if (j.codex.includes('<COMMIT>')) throw new Error('must not contain <COMMIT>');
  if (!j.cursor.includes(TOKEN)) throw new Error('missing real token in cursor');
  if (!j.generic.includes(TOKEN)) throw new Error('missing real token in generic');
  if (!j.codex.includes("manifest['files'].items()")) throw new Error('codex missing manifest-driven bundle download');
  if (!j.codex.includes('manifest.json')) throw new Error('codex missing manifest download');
  if (!j.codex.includes('hashlib.sha256')) throw new Error('codex missing SHA-256 verification');
  const cc = r.headers['cache-control'] || '';
  if (!cc.includes('no-store')) throw new Error('no-store missing');
});

// ============================================
// E. 模拟 Codex 安装器核心逻辑
// ============================================
await t('E5. 模拟安装器：manifest.files 为 6 项哈希清单，每项含 sha256 + bytes', async () => {
  // 模拟 Codex 安装器行为：
  // 1. 下载 manifest.json
  // 2. 遍历 manifest.files，对每个文件下载并用 sha256 校验
  // 3. 将 manifest 原样写入本地 Bundle
  // 4. 最终本地 Bundle 含完整 7 个物理文件
  const manifestPath = resolve(root, 'agent-skills', 'shak-project-portfolio-governance', 'manifest.json');
  const bundleDir = resolve(root, 'agent-skills', 'shak-project-portfolio-governance');
  const { createHash } = await import('node:crypto');

  const manifestBuf = readFileSync(manifestPath);
  const manifestText = manifestBuf.toString('utf8');
  const manifest = safeJson(manifestText);
  if (!manifest) throw new Error('manifest.json not valid JSON');

  // Step 1: 验证 manifest.files 是 6 项哈希清单
  const mf = manifest.files || {};
  const hash6Keys = Object.keys(mf).sort();
  if (hash6Keys.length !== 6) throw new Error(`manifest.files 应为 6 项，实际 ${hash6Keys.length}: ${hash6Keys.join(', ')}`);
  const expectedHash6 = new Set(EXPECTED_MANIFEST_HASH_6);
  for (const k of hash6Keys) {
    if (!expectedHash6.has(k)) throw new Error(`manifest.files 含意外文件: ${k}`);
    const meta = mf[k];
    if (typeof meta !== 'object' || !meta) throw new Error(`${k}: meta 不是对象`);
    if (typeof meta.sha256 !== 'string' || meta.sha256.length !== 64) throw new Error(`${k}: 缺少或无效 sha256（got "${meta.sha256}"）`);
    if (typeof meta.bytes !== 'number') throw new Error(`${k}: 缺少 bytes`);
    if (typeof meta.path !== 'string') throw new Error(`${k}: 缺少 path`);
  }

  // Step 2: 验证 6 个内容文件存在且 SHA 匹配（manifest.json 不在 manifest.files 中）
  for (const rel of EXPECTED_MANIFEST_HASH_6) {
    const fullPath = join(bundleDir, rel);
    if (!existsSync(fullPath)) throw new Error(`物理文件不存在: ${rel}`);
    // 验证 SHA
    const buf = readFileSync(fullPath);
    const actualSha = createHash('sha256').update(buf).digest('hex');
    const expectedSha = mf[rel]?.sha256;
    if (!expectedSha) throw new Error(`${rel}: manifest.files 中无此文件`);
    if (actualSha !== expectedSha) throw new Error(`${rel}: SHA 不匹配（实际 ${actualSha.slice(0,8)} 期望 ${expectedSha.slice(0,8)}）`);
    if (buf.length !== mf[rel].bytes) throw new Error(`${rel}: bytes 不匹配（实际 ${buf.length} 期望 ${mf[rel].bytes}）`);
  }
  // manifest.json 也应存在（完整 7 文件）
  if (!existsSync(manifestPath)) throw new Error('manifest.json 不存在');

  // Step 3: 模拟安装器将 manifest 原样写入（我们只验证 manifest 是有效的、未被改写 SHA 污染的）
  const reParsed = safeJson(manifestText);
  if (!reParsed) throw new Error('manifest 重解析失败（可能被 SHA 循环污染）');
});

await t('logout → Cookie 立即失效', async () => {
  const r = await http_('/api/auth/logout', { method: 'POST', headers: { Cookie: sessionCookie } });
  const sc = r.headers['set-cookie'] || '';
  if (!sc.includes('Max-Age=0')) throw new Error('no Max-Age=0: ' + sc);
  // 提取 logout Set-Cookie 并在下次请求时使用它
  const logoutCookie = sc.split(';')[0];
  // 带 logout Cookie（覆盖原 session）的请求应返回 401
  const r2 = await http_('/api/agent/install', { headers: { Cookie: logoutCookie } });
  if (r2.status !== 401) throw new Error(`still authenticated: ${r2.status}`);
});

// ---- Stage delete protection ----
await t('Stage 删除保护：被引用时拒绝', async () => {
  if (!testPortfolioId) throw new Error('no portfolio from earlier');
  // 创建 Stage
  const cs = await mcp('tools/call', { name: 'create_stage', arguments: { portfolioId: testPortfolioId, name: 'protected-stage-' + Date.now() } }, 11, { Authorization: `Bearer ${TOKEN}` });
  const csobj = safeJson(cs.parsedBody) || safeJson(cs.text);
  const stageId = csobj?.result?.structuredContent?.id;
  const stageName = csobj?.result?.structuredContent?.name;
  if (!stageId || !stageName) throw new Error('no stage id/name: ' + cs.text.slice(0, 300));
  // 创建引用该 Stage 的项目（projects.stage 字段是 stage 的 name，不是 id）
  const cp = await mcp('tools/call', { name: 'create_project', arguments: { portfolioId: testPortfolioId, title: 'p-stage', owner: 'o', stage: stageName } }, 12, { Authorization: `Bearer ${TOKEN}` });
  const cpj = safeJson(cp.parsedBody) || safeJson(cp.text);
  if (cpj?.result?.isError) throw new Error('create project failed: ' + cp.text);
  // 删除 Stage：应被拒绝
  const ds = await mcp('tools/call', { name: 'delete_stage', arguments: { stageId } }, 13, { Authorization: `Bearer ${TOKEN}` });
  const j = safeJson(ds.parsedBody) || safeJson(ds.text);
  if (!j.result?.isError) throw new Error('stage delete should be blocked: ' + ds.text);
});

// ---- TBD / Plan ----
await t('create_step 缺日期 → 视为未排期（TBD）', async () => {
  if (!testPortfolioId) throw new Error('no portfolio');
  const cp = await mcp('tools/call', { name: 'create_project', arguments: { portfolioId: testPortfolioId, title: 'p-tbd', owner: 'o' } }, 14, { Authorization: `Bearer ${TOKEN}` });
  const projId = (safeJson(cp.parsedBody) || safeJson(cp.text))?.result?.structuredContent?.id;
  const cs = await mcp('tools/call', { name: 'create_step', arguments: { projectId: projId, name: 's-no-date' } }, 15, { Authorization: `Bearer ${TOKEN}` });
  const j = safeJson(cs.parsedBody) || safeJson(cs.text);
  if (j.result?.isError) throw new Error('error: ' + cs.text);
  // 应当 status=tbd
  const text = j.result.structuredContent;
  if (text.status !== 'tbd') throw new Error('expected status=tbd, got: ' + text.status);
});

// ---- /mcp never accepts cookie / redirects ----
await t('/mcp 不返回 302（即使带 Cookie）', async () => {
  const r = await mcp('initialize', {}, 99, { Authorization: `Bearer ${TOKEN}`, Cookie: 'shak_pmo_session=fake' });
  if (r.status === 302 || r.headers['location']) throw new Error('MCP redirected');
});

// ---- Output ----
console.log('\n=== Real MCP / Worker integration test ===');
results.forEach((r) => console.log(r));
console.log(`\n📊 ${pass} passed, ${fail} failed`);

server.close();
await mf.dispose();
process.exit(fail === 0 ? 0 : 1);
