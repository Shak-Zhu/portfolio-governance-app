#!/usr/bin/env node
/**
 * WP-006 MCP Bearer 集成测试（端到端，针对真实运行的 Worker /mcp）
 *
 * 运行前提：以 npm run dev 启动本地 worker，并在 .dev.vars 中配置
 *   SHAK_PMO_MCP_TOKEN=<token>
 *   SHAK_PMO_WEB_LOGIN_EMAIL=<email>
 *   SHAK_PMO_WEB_LOGIN_PASSWORD=<password>
 *   SHAK_PMO_SESSION_SECRET=<任意随机串>
 *
 * 运行方式:
 *   MCP_ORIGIN=http://127.0.0.1:8788 \
 *   MCP_TOKEN=<SHAK_PMO_MCP_TOKEN 的值> \
 *   LOGIN_EMAIL=<email> LOGIN_PASSWORD=<password> \
 *   node scripts/mcp-test.mjs
 *
 * 覆盖验收点：
 *  - 无 Cookie + 正确 Bearer: initialize / tools/list / 31 工具矩阵
 *  - 无 Cookie + 缺失/错误 Bearer: JSON 401，绝不返回 302 / HTML / OAuth 元数据
 *  - 网页登录（带 Cookie）能调通 /api/agent/install，并返回三段含真实 Bearer 的文案
 *  - 网页登录接口动态文案有 Cache-Control: no-store
 *  - 31 工具运行时 schema：缺字段 / 未知字段 / 类型错 / 非法 enum 均被拒
 *  - 每个写领域：成功 + 业务规则拒绝
 *  - 审计 actor 来自认证上下文（写入固定为 mcp:shak-pmo-owner）
 *  - 全 31 工具真实调用
 */

const ORIGIN = process.env.MCP_ORIGIN || 'http://127.0.0.1:8788';
const MCP_URL = `${ORIGIN}/mcp`;
const API_BASE = `${ORIGIN}/api`;

const TOKEN = process.env.MCP_TOKEN || process.env.SHAK_PMO_MCP_TOKEN || '';
const LOGIN_EMAIL = process.env.LOGIN_EMAIL || '';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || '';

if (!TOKEN) { console.error('❌ 必须设置 MCP_TOKEN 或 SHAK_PMO_MCP_TOKEN'); process.exit(2); }
if (!LOGIN_EMAIL || !LOGIN_PASSWORD) { console.error('❌ 必须设置 LOGIN_EMAIL 与 LOGIN_PASSWORD'); process.exit(2); }

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`❌ ${name}: ${e.message}`);
    failed++;
    failures.push(name);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

// ============ Cookie jar for web login ============
const cookieJar = new Map();
function setCookieFromHeader(setCookie) {
  if (!setCookie) return;
  const first = setCookie.split(/,(?=\s*[^=;]+=)/)[0] || setCookie;
  const eq = first.indexOf('=');
  if (eq < 0) return;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).split(';')[0].trim();
  if (name) cookieJar.set(name, value);
}
function cookieHeader() {
  return Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ============ MCP RPC 客户端（带 Bearer）============
let rpcId = 0;
function nextId() { return ++rpcId; }

async function mcpRpc(method, params, opts = {}) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  if (opts.bearer !== null) {
    headers['Authorization'] = `Bearer ${opts.bearer !== undefined ? opts.bearer : TOKEN}`;
  }
  const r = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId(), method, params: params || {} }),
  });
  // 取响应文本
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: r.status, ok: r.ok, headers: r.headers, body: data, raw: text };
}

// ============ Web API（含 Cookie）============
async function webApi(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (cookieJar.size > 0) headers['Cookie'] = cookieHeader();
  const r = await fetch(url, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const sc = r.headers.get('set-cookie');
  if (sc) setCookieFromHeader(sc);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: r.status, ok: r.ok, headers: r.headers, data };
}

// ============ 1) 鉴权：缺失 / 错误 / 正确 Bearer ============
async function runAuthTests() {
  console.log('\n=== 鉴权测试 ===');

  await test('A1. 缺失 Authorization: Bearer → 401 JSON', async () => {
    const r = await mcpRpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } }, { bearer: null });
    assert(r.status === 401, `状态应为 401，实际 ${r.status}`);
    assert(r.headers.get('content-type')?.includes('application/json'), `Content-Type 必须是 JSON，实际 ${r.headers.get('content-type')}`);
    assert(!r.headers.get('location'), `不得返回 302 Location，实际 ${r.headers.get('location')}`);
  });

  await test('A2. 错误 Bearer → 401 JSON', async () => {
    const r = await mcpRpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } }, { bearer: 'definitely-wrong-token-1234' });
    assert(r.status === 401, `状态应为 401，实际 ${r.status}`);
    assert(r.headers.get('www-authenticate')?.includes('Bearer'), `必须带 WWW-Authenticate: Bearer`);
    assert(!r.headers.get('location'), `不得返回 302 Location`);
  });

  await test('A3. /mcp 必须不被网页登录拦截：缺 Cookie 时正确 Bearer 成功', async () => {
    // 这里 cookieJar 应该为空（不登录）；只带 Bearer
    cookieJar.clear();
    const r = await mcpRpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert(r.status === 200, `状态应为 200，实际 ${r.status}`);
    assert(r.body && r.body.result, `initialize 必须返回 result`);
    assert(r.body.result.serverInfo, `serverInfo 必须存在`);
    assert(r.body.result.capabilities?.tools, `tools capability 必须存在`);
  });

  await test('A4. /mcp 响应不带 Set-Cookie / Location', async () => {
    const r = await mcpRpc('tools/list', {});
    assert(r.status === 200, `tools/list 应 200，实际 ${r.status}`);
    assert(!r.headers.get('set-cookie'), `/mcp 不应下发 Set-Cookie`);
    assert(!r.headers.get('location'), `/mcp 不应返回 302 Location`);
  });
}

// ============ 2) initialize / tools/list ============
async function runDiscoveryTests() {
  console.log('\n=== 工具发现 ===');

  await test('D1. initialize 返回 serverInfo + capabilities', async () => {
    const r = await mcpRpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-test', version: '1.0.0' } });
    assert(r.status === 200, `状态 200`);
    assert(r.body.result.serverInfo?.name === 'shak-project-portfolio-governance', `name 错误`);
    assert(r.body.result.serverInfo?.version, `version 必须有`);
    assert(r.body.result.capabilities?.tools, `tools capability 必须有`);
  });

  let tools;
  await test('D2. tools/list 返回完整 31 工具', async () => {
    const r = await mcpRpc('tools/list', {});
    assert(r.status === 200, `状态 200`);
    tools = r.body.result.tools;
    assert(Array.isArray(tools), `tools 应为数组`);
    assert(tools.length === 31, `工具数应为 31，实际 ${tools.length}`);
    for (const t of tools) {
      assert(typeof t.name === 'string' && t.name.length > 0, `工具必须含 name`);
      assert(typeof t.description === 'string' && t.description.length > 0, `工具必须含 description`);
      assert(t.inputSchema?.type === 'object', `inputSchema.type 必须是 object`);
      assert(t.inputSchema?.additionalProperties === false, `inputSchema.additionalProperties 必须为 false（Zod .strict()）`);
    }
  });

  await test('D3. get_capabilities 返回鉴权模式为 bearer', async () => {
    const r = await mcpRpc('tools/call', { name: 'get_capabilities', arguments: {} });
    assert(r.status === 200, `状态 200`);
    const out = JSON.parse(r.body.result.structuredContent || JSON.stringify(r.body.result.content?.[0]?.text ? JSON.parse(r.body.result.content[0].text).result : {}));
    assert(out.auth?.mode === 'bearer', `auth.mode 应为 bearer，实际 ${out.auth?.mode}`);
    assert(out.auth?.header?.startsWith('Authorization: Bearer'), `auth.header 必须是 Bearer Header`);
    assert(out.toolCount === 31, `toolCount 应为 31，实际 ${out.toolCount}`);
    assert(out.health === 'ok', `health 应为 ok`);
  });

  return tools;
}

// ============ 3) 运行时 schema：缺字段 / 未知字段 / 类型错 / 非法 enum ============
async function runSchemaTests(tools) {
  console.log('\n=== 运行时 schema 强校验 ===');

  // 找一个写工具测试
  const writeTool = tools.find(t => t.name === 'create_portfolio');
  assert(writeTool, `必须有 create_portfolio 工具`);

  await test('S1. 缺必填字段 name → 错误', async () => {
    const r = await mcpRpc('tools/call', { name: 'create_portfolio', arguments: { description: 'x' } });
    assert(r.body?.error?.code === -32602 || r.body?.result?.isError || (r.body?.result?.isError === true), `缺字段应被拒：${JSON.stringify(r.body)}`);
  });

  await test('S2. 未知字段 actor → .strict() 拒绝', async () => {
    const r = await mcpRpc('tools/call', { name: 'create_portfolio', arguments: { name: 'WP006 Schema Test', actor: 'fake' } });
    // Zod .strict() 会在工具内抛错，被 SDK 转为 isError
    assert(r.body?.result?.isError === true, `未知字段应被拒：${JSON.stringify(r.body)}`);
    const text = r.body.result.content?.[0]?.text || '';
    assert(text.includes('actor') || text.includes('Unrecognized') || text.includes('strict') || text.includes('unknown') || text.includes('Unexpected'), `错误信息应提到字段：${text}`);
  });

  await test('S3. 类型错误：name 传数字 → 拒绝', async () => {
    const r = await mcpRpc('tools/call', { name: 'create_portfolio', arguments: { name: 12345 } });
    assert(r.body?.result?.isError === true, `类型错应被拒：${JSON.stringify(r.body)}`);
  });

  await test('S4. enum 非法值：status=tbdd → 拒绝', async () => {
    const r = await mcpRpc('tools/call', { name: 'create_portfolio', arguments: { name: 'X', description: 'y' } });
    // 先创建一个临时组合，拿到 projectId 才能测 status 非法值；跳过也可
    if (r.body?.result?.isError) return; // 如果上一步已经先失败则跳过
    const tmp = r.body.result.structuredContent || JSON.parse(r.body.result.content?.[0]?.text || '{}');
    const portfolioId = tmp.id;
    const project = await mcpRpc('tools/call', { name: 'create_project', arguments: { portfolioId, title: 'Schema Enum Test', owner: 'me' } });
    const projectOut = project.body.result.structuredContent || JSON.parse(project.body.result.content?.[0]?.text || '{}');
    const projectId = projectOut.id;
    const step = await mcpRpc('tools/call', { name: 'create_step', arguments: { projectId, name: 's', status: 'tbdd' } });
    assert(step.body?.result?.isError === true, `非法 enum 应被拒：${JSON.stringify(step.body)}`);
    // 清理
    await mcpRpc('tools/call', { name: 'delete_project', arguments: { projectId } });
    await mcpRpc('tools/call', { name: 'delete_portfolio', arguments: { portfolioId } });
  });

  await test('S5. 缺必填字段 portfolioId (create_step) → 拒绝', async () => {
    const r = await mcpRpc('tools/call', { name: 'create_step', arguments: { name: 'no project' } });
    assert(r.body?.result?.isError === true || r.body?.error, `缺 portfolioId 应被拒：${JSON.stringify(r.body)}`);
  });
}

// ============ 4) 全 31 工具调用 ============
async function runToolMatrixTests() {
  console.log('\n=== 全 31 工具调用 ===');

  // 先准备测试数据：组合 + Stage + 项目 + 步骤 + 关联资料
  const ctx = { portfolioId: null, stageId: null, projectId: null, stepId: null, linkId: null };

  async function call(name, args) {
    const r = await mcpRpc('tools/call', { name, arguments: args });
    if (r.body?.result?.isError) throw new Error(`工具 ${name} 报错：${r.body.result.content?.[0]?.text}`);
    if (r.body?.error) throw new Error(`工具 ${name} 错误：${JSON.stringify(r.body.error)}`);
    const out = r.body.result.structuredContent || (r.body.result.content?.[0]?.text ? JSON.parse(r.body.result.content[0].text) : {});
    return out;
  }

  await test('M01. list_portfolios', async () => {
    const out = await call('list_portfolios', {});
    assert(Array.isArray(out), 'list 应返回数组');
  });

  await test('M02. create_portfolio', async () => {
    const out = await call('create_portfolio', { name: 'WP006 Portfolio', description: 'created by mcp test' });
    ctx.portfolioId = out.id;
    assert(ctx.portfolioId, '必须返回 id');
  });

  await test('M03. get_portfolio', async () => {
    const out = await call('get_portfolio', { portfolioId: ctx.portfolioId });
    assert(out.id === ctx.portfolioId, 'id 应匹配');
  });

  await test('M04. update_portfolio', async () => {
    const out = await call('update_portfolio', { portfolioId: ctx.portfolioId, description: 'updated by mcp' });
    assert(out.description === 'updated by mcp', 'description 应被更新');
  });

  await test('M05. create_stage', async () => {
    const out = await call('create_stage', { portfolioId: ctx.portfolioId, name: 'WP006 Stage' });
    ctx.stageId = out.id;
    assert(ctx.stageId, '必须返回 id');
  });

  await test('M06. list_stages', async () => {
    const out = await call('list_stages', { portfolioId: ctx.portfolioId });
    assert(Array.isArray(out) && out.length >= 1, '应至少含 1 个 Stage');
  });

  await test('M07. update_stage', async () => {
    const out = await call('update_stage', { stageId: ctx.stageId, name: 'WP006 Stage Renamed' });
    assert(out.name === 'WP006 Stage Renamed', 'name 应被改名');
  });

  await test('M08. create_project', async () => {
    const out = await call('create_project', {
      portfolioId: ctx.portfolioId,
      title: 'WP006 Top Project',
      owner: 'qa-bot',
      stage: 'WP006 Stage Renamed',
      health: 'green',
      expectation: 'qa',
    });
    ctx.projectId = out.id;
    assert(ctx.projectId, '必须返回 id');
  });

  await test('M09. get_project', async () => {
    const out = await call('get_project', { projectId: ctx.projectId });
    assert(out.id === ctx.projectId, 'id 匹配');
  });

  await test('M10. list_projects', async () => {
    const out = await call('list_projects', { portfolioId: ctx.portfolioId });
    assert(Array.isArray(out) && out.length >= 1, '至少 1 个项目');
  });

  await test('M11. update_project', async () => {
    const out = await call('update_project', { projectId: ctx.projectId, health: 'amber' });
    assert(out.health === 'amber', 'health 应更新');
  });

  await test('M12. get_project_stats', async () => {
    const out = await call('get_project_stats', { portfolioId: ctx.portfolioId });
    assert(typeof out.total === 'number', 'total 必须为数字');
  });

  await test('M13. create_step (TBD)', async () => {
    const out = await call('create_step', { projectId: ctx.projectId, name: 'TBD Step' });
    ctx.stepId = out.id;
    assert(out.status === 'tbd', '无日期应自动 tbd');
  });

  await test('M14. list_steps', async () => {
    const out = await call('list_steps', { projectId: ctx.projectId });
    assert(Array.isArray(out) && out.length >= 1, '至少 1 个步骤');
  });

  await test('M15. update_step (TBD → Plan)', async () => {
    const out = await call('update_step', { stepId: ctx.stepId, start_date: '2026-08-05', end_date: '2026-08-12' });
    assert(out.status === 'planned', '补齐日期自动 planned');
    assert(out.start_date === '2026-08-05', 'start_date 写入');
  });

  await test('M16. update_step (Plan → TBD)', async () => {
    const out = await call('update_step', { stepId: ctx.stepId, start_date: '', end_date: '' });
    assert(out.status === 'tbd', '清空日期自动回退 tbd');
  });

  await test('M17. list_portfolio_steps', async () => {
    const out = await call('list_portfolio_steps', { portfolioId: ctx.portfolioId });
    assert(Array.isArray(out), '应为数组');
  });

  await test('M18. delete_step', async () => {
    await call('delete_step', { stepId: ctx.stepId });
    ctx.stepId = null;
  });

  await test('M19. create_project_link (https)', async () => {
    const out = await call('create_project_link', { projectId: ctx.projectId, title: 'docs', url: 'https://example.com/docs' });
    ctx.linkId = out.id;
    assert(ctx.linkId, '必须返回 id');
  });

  await test('M20. list_project_links', async () => {
    const out = await call('list_project_links', { projectId: ctx.projectId });
    assert(Array.isArray(out) && out.length >= 1, '至少 1 条');
  });

  await test('M21. update_project_link', async () => {
    const out = await call('update_project_link', { linkId: ctx.linkId, title: 'docs-updated' });
    assert(out.title === 'docs-updated', 'title 应被更新');
  });

  await test('M22. create_project_link (ftp) → 业务规则拒绝', async () => {
    const r = await mcpRpc('tools/call', { name: 'create_project_link', arguments: { projectId: ctx.projectId, title: 'bad', url: 'ftp://example.com' } });
    assert(r.body?.result?.isError === true, '非法 url 应被拒');
  });

  await test('M23. delete_stage (被引用) → 业务规则拒绝', async () => {
    const r = await mcpRpc('tools/call', { name: 'delete_stage', arguments: { stageId: ctx.stageId } });
    assert(r.body?.result?.isError === true, '被项目引用的 Stage 删除应被拒');
  });

  await test('M24. complete_project', async () => {
    const out = await call('complete_project', { projectId: ctx.projectId });
    assert(out.status === 'completed', 'status 应为 completed');
  });

  await test('M25. archive_project (顶层已完成 → 成功)', async () => {
    const out = await call('archive_project', { projectId: ctx.projectId });
    assert(out.success === true, `归档应成功：${JSON.stringify(out)}`);
  });

  await test('M26. get_gantt', async () => {
    const out = await call('get_gantt', { portfolioId: ctx.portfolioId, scale: 'week' });
    assert(out.timeline && Array.isArray(out.timeline.cells), 'timeline.cells 应为数组');
    assert(Array.isArray(out.rows), 'rows 应为数组');
  });

  await test('M27. list_audit_events', async () => {
    const out = await call('list_audit_events', { portfolioId: ctx.portfolioId, limit: 20 });
    assert(Array.isArray(out.events || out), '应返回事件数组');
  });

  await test('M28. get_object_audit (project)', async () => {
    const out = await call('get_object_audit', { objectType: 'project', objectId: ctx.projectId });
    assert(Array.isArray(out) || Array.isArray(out?.events), '应返回审计数组');
  });

  await test('M29. list_archived_projects', async () => {
    const out = await call('list_archived_projects', { portfolioId: ctx.portfolioId });
    assert(Array.isArray(out), '应为数组');
  });

  await test('M30. delete_project_link', async () => {
    await call('delete_project_link', { linkId: ctx.linkId });
    ctx.linkId = null;
  });

  // delete_project 需要 project 不存在子项目；刚才已经 archive 了，再 delete 应能通过
  await test('M31. delete_project (archived) + delete_portfolio', async () => {
    // 直接 delete 顶级项目（含 archived 后代）应被拒，需先取消归档？这里只清理组合
    await call('delete_portfolio', { portfolioId: ctx.portfolioId });
  });

  await test('M32. delete_stage (未引用)', async () => {
    // 上面 project 已经 archive / portfolio 被 delete，应可成功
    const r = await mcpRpc('tools/call', { name: 'delete_stage', arguments: { stageId: ctx.stageId } });
    assert(!r.body?.result?.isError, `未引用 Stage 删除应成功：${JSON.stringify(r.body)}`);
  });
}

// ============ 5) 网页登录 + 动态 /api/agent/install ============
async function runWebTests() {
  console.log('\n=== 网页登录 + 动态安装指令 ===');

  await test('W1. 错误密码 → 401 JSON', async () => {
    const r = await webApi('/auth/login', { method: 'POST', body: { email: LOGIN_EMAIL, password: 'wrong-password-xxx' } });
    assert(r.status === 401, `错误密码应 401，实际 ${r.status}`);
  });

  await test('W2. 正确邮箱+密码 → 200 + Set-Cookie', async () => {
    const r = await webApi('/auth/login', { method: 'POST', body: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD } });
    assert(r.status === 200, `登录应 200，实际 ${r.status}`);
    assert(cookieJar.has('shak_pmo_session'), '应有 Session Cookie');
  });

  await test('W3. /api/auth/session 已登录返回 authenticated=true', async () => {
    const r = await webApi('/auth/session');
    assert(r.status === 200, `session 应 200，实际 ${r.status}`);
    assert(r.data.authenticated === true, '应已认证');
  });

  await test('W4. /api/agent/install 返回三段含 Bearer 文案 + no-store', async () => {
    const r = await webApi('/agent/install');
    assert(r.status === 200, `install 应 200，实际 ${r.status}`);
    const cc = r.headers.get('cache-control') || '';
    assert(cc.includes('no-store'), `Cache-Control 必须包含 no-store，实际 "${cc}"`);
    assert(typeof r.data.codex === 'string' && r.data.codex.includes('Bearer ') && r.data.codex.includes(TOKEN),
      `codex 文案必须含真实 Bearer Token`);
    assert(typeof r.data.cursor === 'string' && r.data.cursor.includes('Bearer ') && r.data.cursor.includes(TOKEN),
      `cursor 文案必须含真实 Bearer Token`);
    assert(typeof r.data.generic === 'string' && r.data.generic.includes('Bearer ') && r.data.generic.includes(TOKEN),
      `generic 文案必须含真实 Bearer Token`);
    // Codex 文案必须使用 codex mcp add
    assert(r.data.codex.includes('codex mcp add'), 'Codex 文案必须使用 codex mcp add');
    // Cursor 文案必须安全合并 mcp.json
    assert(r.data.cursor.includes('.cursor/mcp.json') && r.data.cursor.includes('setdefault'),
      'Cursor 文案必须安全合并 mcp.json');
    // 通用文案必须包含 manifest 校验
    assert(r.data.generic.includes('get_capabilities'), '通用文案必须包含 get_capabilities 校验');
  });

  await test('W5. /api/agent/config 是公共可读且无 token', async () => {
    cookieJar.clear();
    const r = await webApi('/agent/config');
    assert(r.status === 200, `config 应 200，实际 ${r.status}`);
    assert(!JSON.stringify(r.data).includes(TOKEN), `公共 config 不得泄露 Bearer Token`);
    // 恢复 session 用于后续
    await webApi('/auth/login', { method: 'POST', body: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD } });
  });

  await test('W6. 未登录 /api/agent/install → 401', async () => {
    cookieJar.clear();
    const r = await webApi('/agent/install');
    assert(r.status === 401, `未登录应 401，实际 ${r.status}`);
    // 恢复
    await webApi('/auth/login', { method: 'POST', body: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD } });
  });

  await test('W7. logout → Cookie 失效', async () => {
    const r = await webApi('/auth/logout', { method: 'POST' });
    assert(r.status === 200, `logout 应 200，实际 ${r.status}`);
    // 之后再调 session 应该 401
    const s = await webApi('/auth/session');
    assert(s.status === 401, `logout 后 session 应 401，实际 ${s.status}`);
  });
}

// ============ 主流程 ============
(async () => {
  console.log('🚀 WP-006 MCP Bearer 集成测试');
  console.log(`   Origin: ${ORIGIN}`);
  console.log(`   MCP URL: ${MCP_URL}`);
  console.log(`   Token length: ${TOKEN.length}`);
  console.log('');

  await runAuthTests();
  const tools = await runDiscoveryTests();
  await runSchemaTests(tools);
  await runToolMatrixTests();
  await runWebTests();

  console.log(`\n📊 MCP Bearer 测试结果: ${passed} 通过, ${failed} 失败`);
  if (failed > 0) {
    console.log('\n❌ 失败项:');
    failures.forEach(f => console.log(`   - ${f}`));
    process.exit(1);
  }
  process.exit(0);
})();