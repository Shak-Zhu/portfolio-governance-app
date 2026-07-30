// AI 项目组合治理 - 前端应用
const API_BASE = '/api';

// ========== 状态管理 ==========
let state = {
  currentPortfolioId: null,
  portfolios: [],
  projects: [],
  stages: [],
  ganttScale: 'week',
  ganttRange: { start: '', end: '' },
  collapsedProjectIds: new Set(),
  // 依赖说明默认收起；它是治理信息，不应伪装成工期或挤压时间轴。
  collapsedDependencyStepIds: new Set(),
  editingSteps: {},  // 跟踪编辑中的步骤
  session: null,     // { sub, expiresAt } 或 null
  agentInstall: null, // 登录后从 /api/agent/install 获取的三段安装文案
};

// ========== 工具函数 ==========
async function api(path, options = {}) {
  const opts = {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  if (opts.body && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/session') {
    // 未登录或 Session 失效：跳转到登录页
    window.location.replace('/login');
    throw new Error('未登录');
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('API 返回非 JSON'); }
  if (!res.ok) throw new Error(data.error || data.message || 'API 错误');
  return data;
}

function apiRaw(path, options = {}) {
  // 不抛异常、不触发重定向
  return fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  }).then(res => res.json()).catch(() => null);
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDateInput(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toISOString().split('T')[0];
}

function getHealthClass(health) {
  const map = { green: 'green', blue: '', amber: 'amber', red: 'red', unknown: '' };
  return map[health] || '';
}

function getStatusClass(status) {
  const map = { active: '', completed: 'completed', archived: 'archived' };
  return map[status] || '';
}

function getStageName(stage) {
  return stage || '未设置';
}

function getOwner(project) {
  return project.owner || '未分配';
}

function formatShortTimelineDate(value) {
  if (!value) return '';
  const match = String(value).match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return '';
  return `${Number(match[2])}/${Number(match[3])}`;
}

function getTimelineDateRange(cell) {
  const directStart = cell.startDate || cell.start_date || cell.start || cell.rangeStart || cell.date;
  const directEnd = cell.endDate || cell.end_date || cell.end || cell.rangeEnd;
  if (directStart && directEnd) return [directStart, directEnd];
  const matches = String(cell.rangeLabel || '').match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g) || [];
  return matches.length >= 2 ? [matches[0], matches[1]] : [];
}

function formatTimelineCell(cell, scale) {
  if (scale === 'day') {
    const [date] = getTimelineDateRange(cell);
    const label = formatShortTimelineDate(date);
    if (label) return label;
  }
  if (scale === 'week') {
    if (cell.rangeLabel) return cell.rangeLabel;
    const [start, end] = getTimelineDateRange(cell);
    const startLabel = formatShortTimelineDate(start);
    const endLabel = formatShortTimelineDate(end);
    if (startLabel && endLabel) return `${startLabel}–${endLabel}`;
  }
  if (scale === 'month') {
    const match = String(cell.rangeLabel || cell.label || '').match(/(\d{4})[-/]?(\d{1,2})/);
    if (match) return `${match[1]}/${String(match[2]).padStart(2, '0')}`;
  }
  return cell.label || cell.rangeLabel || '—';
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
  setupDialogs();
  setupTabs();
  setupGanttControls();
  setupPortfolioControls();
  setupProjectDialog();
  setupPortfolioDialog();
  setupStageDialog();
  setupSessionBox();
  setupBackupControls();

  // 第一步：检查登录态；未登录直接去 /login
  try {
    const session = await apiRaw('/auth/session');
    if (!session || !session.authenticated) {
      window.location.replace('/login');
      return;
    }
    state.session = session;
    renderSessionBox();
  } catch {
    window.location.replace('/login');
    return;
  }

  try {
    await loadPortfolios();
  } catch (e) {
    console.error('初始化失败:', e);
    alert('初始化失败，请检查服务是否启动');
  }
});

// ========== 会话显示 / 登出 ==========
function renderSessionBox() {
  const box = document.getElementById('sessionBox');
  const subEl = document.getElementById('sessionSub');
  if (!box || !subEl) return;
  if (state.session && state.session.sub) {
    box.hidden = false;
    subEl.textContent = `已登录：${state.session.sub}`;
  } else {
    box.hidden = true;
  }
}

function setupSessionBox() {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
    } catch { /* 忽略 */ }
    state.session = null;
    state.agentInstall = null;
    // 强制跳登录页
    window.location.replace('/login');
  });
}

// ========== 对话框设置 ==========
function setupDialogs() {
  document.querySelectorAll('.close-dialog').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('dialog')?.close();
    });
  });
  
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  });
}

// ========== 标签页切换 ==========
function setupTabs() {
  document.querySelectorAll('.main-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.view + 'View')?.classList.add('active');
      
      if (tab.dataset.view === 'gantt') loadGantt();
      else if (tab.dataset.view === 'data') loadProjects();
      else if (tab.dataset.view === 'archive') loadArchive();
      else if (tab.dataset.view === 'agent') loadAgentCenter();
      else if (tab.dataset.view === 'backups') loadBackups();
    });
  });
}

// ========== Agent 接入中心 ==========
// 单一配置源：`/api/agent/config`（公共可读，不含 secret）；
// 实际带 Bearer Token 的安装文案来自登录后的 `/api/agent/install`，绝不在静态文件中包含 token。
let agentConfigCache = null;

async function loadAgentCenter() {
  const statusEl = document.getElementById('agentStatus');
  const statusText = document.getElementById('agentStatusText');
  if (!statusEl) return;

  // 第一步：公共 /api/agent/config
  try {
    const cfg = await apiRaw('/agent/config');
    if (!cfg) throw new Error('无法读取接入配置');
    agentConfigCache = cfg;

    document.getElementById('agentMcpName').textContent = cfg.mcpName || '—';
    document.getElementById('agentMcpUrl').textContent = cfg.mcpUrl || '—';
    document.getElementById('agentSkillVersion').textContent = cfg.skillVersion || '—';
    document.getElementById('agentToolProto').textContent = cfg.toolProtocolVersion || '—';
    const authEl = document.getElementById('agentAuthMode');
    if (authEl && cfg.auth) authEl.textContent = `${cfg.auth.header}（${cfg.auth.configured ? '已配置' : '未配置'}）`;

    if (cfg.auth && cfg.auth.configured) {
      statusEl.dataset.state = 'enabled';
      statusText.textContent = 'MCP 已配置 Bearer Token。登录后即可一键复制含真实 Token 的安装指令。';
    } else {
      statusEl.dataset.state = 'pending';
      statusText.textContent = 'MCP Token 未配置。请管理员在 Worker Secrets 中设置 SHAK_PMO_MCP_TOKEN。';
    }
  } catch (e) {
    statusEl.dataset.state = 'error';
    statusText.textContent = '读取 MCP 接入配置失败：' + (e?.message || '');
    return;
  }

  // 第二步：若已登录，加载动态安装指令
  await loadAgentInstallCommands();
}

async function loadAgentInstallCommands() {
  const buttons = document.querySelectorAll('.agent-copy');
  // 未登录：禁用按钮，提示去登录
  if (!state.session) {
    buttons.forEach((btn) => {
      btn.disabled = true;
      btn.textContent = '登录后可一键复制';
    });
    return;
  }
  // 已登录：调用 /api/agent/install 拿真实 token 文案（no-store）
  try {
    const r = await fetch(`${API_BASE}/agent/install`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
    });
    if (r.status === 401) {
      buttons.forEach((btn) => { btn.disabled = true; btn.textContent = '会话失效，请重新登录'; });
      return;
    }
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      buttons.forEach((btn) => { btn.disabled = true; btn.textContent = data.error || '安装指令不可用' });
      return;
    }
    const data = await r.json();
    state.agentInstall = data;
    buttons.forEach((btn) => {
      btn.disabled = false;
      btn.textContent = '一键复制安装或更新指令';
      const client = btn.dataset.client;
      btn.onclick = () => copyAgentCommand(client, btn);
    });
  } catch (e) {
    buttons.forEach((btn) => { btn.disabled = true; btn.textContent = '读取安装指令失败' });
    console.error('loadAgentInstallCommands failed:', e);
  }
}

function buildAgentCommand(client) {
  // 真实 token 必须来自 /api/agent/install（登录后动态生成）；
  // 不在静态文件中拼装，不在 DOM 中伪造 token。
  const install = state.agentInstall;
  if (!install) return '';
  if (client === 'codex') return install.codex || '';
  if (client === 'cursor') return install.cursor || '';
  return install.generic || '';
}

async function copyAgentCommand(client, btn) {
  if (!state.agentInstall) return;
  const cmd = buildAgentCommand(client);
  if (!cmd) return;
  const hint = document.querySelector(`.agent-copy-hint[data-client="${client}"]`);
  try {
    await navigator.clipboard.writeText(cmd);
    if (hint) hint.textContent = '已复制到剪贴板。粘贴到终端执行：首次会安装，已有同名 Agent 时只更新该 Agent。';
  } catch {
    if (hint) {
      hint.textContent = '浏览器阻止了剪贴板，请手动复制下方指令：';
      const pre = document.createElement('pre');
      pre.className = 'agent-cmd-fallback';
      pre.textContent = cmd;
      hint.after(pre);
    }
  }
}

// ========== 甘特图控制 ==========
function setupGanttControls() {
  // 缩放切换
  document.querySelectorAll('.scale').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.scale').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.ganttScale = btn.dataset.scale;
      loadGantt();
    });
  });
  
  // 区间选择
  document.getElementById('rangeStart')?.addEventListener('change', loadGantt);
  document.getElementById('rangeEnd')?.addEventListener('change', loadGantt);
  
  // 重置区间
  document.getElementById('resetRangeBtn')?.addEventListener('click', () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 3, 0);
    document.getElementById('rangeStart').value = start.toISOString().split('T')[0];
    document.getElementById('rangeEnd').value = end.toISOString().split('T')[0];
    loadGantt();
  });
}

function setDefaultDateRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 3, 0);
  document.getElementById('rangeStart').value = start.toISOString().split('T')[0];
  document.getElementById('rangeEnd').value = end.toISOString().split('T')[0];
  state.ganttRange = {
    start: document.getElementById('rangeStart').value,
    end: document.getElementById('rangeEnd').value,
  };
}

// ========== 组合控制 ==========
function setupPortfolioControls() {
  // 组合切换
  document.getElementById('portfolioSelect')?.addEventListener('change', async (e) => {
    state.currentPortfolioId = e.target.value;
    await loadCurrentPortfolio();
  });
  
  // 新建组合
  document.getElementById('newPortfolioBtn')?.addEventListener('click', () => {
    document.getElementById('portfolioDialog').showModal();
  });
  
  // Stage 管理
  document.getElementById('stageManageBtn')?.addEventListener('click', () => {
    loadStageDialog();
    document.getElementById('stageDialog').showModal();
  });
}

async function loadPortfolios() {
  state.portfolios = await api('/portfolios');
  const select = document.getElementById('portfolioSelect');
  select.innerHTML = state.portfolios.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  
  if (state.portfolios.length > 0) {
    state.currentPortfolioId = state.portfolios[0].id;
    await loadCurrentPortfolio();
  }
}

async function loadCurrentPortfolio() {
  if (!state.currentPortfolioId) return;
  await Promise.all([loadStats(), loadStages()]);
  loadGantt();
}

async function loadStats() {
  if (!state.currentPortfolioId) return;
  try {
    const stats = await api(`/portfolios/${state.currentPortfolioId}/stats`);
    document.getElementById('totalCount').textContent = stats.total || 0;
    document.getElementById('inProgressCount').textContent = stats.active || 0;
    document.getElementById('completeCount').textContent = stats.completed || 0;
    document.getElementById('archivedCount').textContent = stats.archived || 0;
  } catch (e) {
    console.error('加载统计失败:', e);
  }
}

// ========== 甘特图 ==========
async function loadGantt() {
  if (!state.currentPortfolioId) return;
  
  const start = document.getElementById('rangeStart').value || state.ganttRange.start;
  const end = document.getElementById('rangeEnd').value || state.ganttRange.end;
  
  if (!start || !end) {
    setDefaultDateRange();
    return loadGantt();
  }
  
  try {
    const data = await api(`/portfolios/${state.currentPortfolioId}/gantt?start=${start}&end=${end}&scale=${state.ganttScale}`);
    renderGantt(data);
  } catch (e) {
    console.error('加载甘特图失败:', e);
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderGantt(data) {
  const timeHeader = document.getElementById('timeHeader');
  const ganttBody = document.getElementById('ganttBody');

  // 与已接受 Demo 对齐：日视图更密、周视图保留足够宽度显示起止日期。
  const colWidth = state.ganttScale === 'day' ? 48 : state.ganttScale === 'week' ? 88 : 100;
  const colsCount = data.timeline.length;
  const gridTemplate = `repeat(${colsCount}, ${colWidth}px)`;

  // 时间轴头部：严格按真实单元格数量渲染，不做静默截断
  timeHeader.innerHTML = data.timeline.map(cell => {
    let cls = 'time-cell';
    if (cell.isWeekend) cls += ' weekend';
    if (cell.isCurrent) cls += ' current';
    const title = cell.rangeLabel ? ` title="${escapeHtml(cell.rangeLabel)}"` : '';
    return `<div class="${cls}"${title}>${escapeHtml(formatTimelineCell(cell, state.ganttScale))}</div>`;
  }).join('');
  timeHeader.style.gridTemplateColumns = gridTemplate;

  if (data.rows.length === 0) {
    ganttBody.innerHTML = '<div class="empty">暂无项目数据</div>';
    renderUnscheduled(data.unscheduled);
    return;
  }

  ganttBody.innerHTML = data.rows.map(row => {
    const p = row.project;
    const level = row.level;
    const indent = level > 0 ? `<span class="tree">${'├ '.repeat(level)}</span>` : '';

    let healthBadge = '';
    if (p.health && p.health !== 'unknown') {
      const healthMap = { green: '🟢', blue: '🔵', amber: '🟡', red: '🔴' };
      healthBadge = healthMap[p.health] || '';
    }

    const statusClass = p.status === 'completed' ? 'badge completed' : p.is_archived ? 'badge archived' : '';
    const statusLabel = p.is_archived ? '已归档' : p.status === 'completed' ? '已完成' : '执行中';

    const barsHtml = renderGanttBars(row.bars, data.timeline, colWidth);

    return `
      <div class="gantt-row ${level > 0 ? 'level-' + level : 'parent'}">
        <div class="project-cell col-project">
          <div class="project-name">${indent}${escapeHtml(p.title)}</div>
          ${p.expectation ? `<div class="expectation">${escapeHtml(p.expectation.substring(0, 60))}${p.expectation.length > 60 ? '...' : ''}</div>` : ''}
        </div>
        <div class="status-cell col-status">
          <div class="badges">
            <span class="badge">${escapeHtml(getOwner(p))}</span>
            ${healthBadge ? `<span class="badge ${getHealthClass(p.health)}">${healthBadge}</span>` : ''}
            <span class="badge">${escapeHtml(getStageName(p.stage))}</span>
          </div>
          <span class="badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="timeline" style="grid-template-columns: ${gridTemplate}; --column-width: ${colWidth}px;">
          ${barsHtml}
        </div>
      </div>
    `;
  }).join('');

  // 依赖说明与工期条分层呈现；展开状态只保存在当前页面，避免重载后留下噪声。
  ganttBody.querySelectorAll('[data-dependency-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const { stepId } = button.dataset;
      if (state.collapsedDependencyStepIds.has(stepId)) {
        state.collapsedDependencyStepIds.delete(stepId);
      } else {
        state.collapsedDependencyStepIds.add(stepId);
      }
      renderGantt(data);
    });
  });

  renderUnscheduled(data.unscheduled);
}

// 甘特条使用 CSS Grid 的 grid-column 落位，天然对齐时间轴单元格边界，
// 不再用绝对定位 left/width（避免相对每个格重复偏移导致越界）。
const dependencyTypeLabels = {
  finish_to_start: '完成后开始',
  input_required: '关键输入',
  business_gate: '业务确认 Gate',
  external_dependency: '外部依赖',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function dateToUtcMs(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
}

// 周/月格内仍按真实日期落位：例如 8/3–8/4 不会占满整个 8 月格。
function getPreciseBarMetrics(bar, timeline, colWidth) {
  const firstCell = timeline[bar.colStart];
  const lastCell = timeline[bar.colEnd];
  const startMs = Math.max(dateToUtcMs(bar.startDate), firstCell.startMs);
  const endExclusiveMs = Math.min(dateToUtcMs(bar.endDate) + DAY_MS, lastCell.endMs + DAY_MS);
  const firstCellMs = firstCell.endMs - firstCell.startMs + DAY_MS;
  const lastCellMs = lastCell.endMs - lastCell.startMs + DAY_MS;
  const startOffset = Math.max(0, Math.min(colWidth, ((startMs - firstCell.startMs) / firstCellMs) * colWidth));
  const endOffset = Math.max(0, Math.min(colWidth, ((lastCell.endMs + DAY_MS - endExclusiveMs) / lastCellMs) * colWidth));
  const spanWidth = (bar.colEnd - bar.colStart + 1) * colWidth;
  const durationWidth = Math.max(2, spanWidth - startOffset - endOffset);
  return { startOffset, durationWidth, compact: durationWidth < 72 };
}

function renderGanttBars(bars, timeline, colWidth) {
  if (!bars || bars.length === 0) return '';
  let nextRow = 1;
  return bars.map((bar) => {
    const colStart = bar.colStart + 1; // grid-column 从 1 开始
    const colEnd = bar.colEnd + 2;     // 结束列 +1（闭区间）再 +1（grid 线）
    const { startOffset, durationWidth, compact } = getPreciseBarMetrics(bar, timeline, colWidth);
    const dependencyDetail = (bar.dependencyDetail || '').trim();
    const blockedImpact = (bar.blockedImpact || '').trim();
    const showDependency = bar.status === 'blocked' && bar.dependencyType && bar.dependencyType !== 'none' && dependencyDetail;
    const row = nextRow++;
    const dependencyRow = showDependency ? nextRow++ : null;
    const dependencyCollapsed = !state.collapsedDependencyStepIds.has(bar.stepId);
    const callout = showDependency ? `
      <div class="dependency-callout blocked"
           style="grid-column: ${colStart} / -1; grid-row: ${dependencyRow};"
           title="前置（${escapeHtml(dependencyTypeLabels[bar.dependencyType] || bar.dependencyType)}）：${escapeHtml(dependencyDetail)}${blockedImpact ? `；阻塞：${escapeHtml(blockedImpact)}` : ''}">
        <button type="button" class="dependency-toggle" data-dependency-toggle data-step-id="${escapeHtml(bar.stepId)}" aria-expanded="${String(!dependencyCollapsed)}">${dependencyCollapsed ? '▸ 展开依赖' : '▾ 收起依赖'}</button>
        ${dependencyCollapsed ? '' : `<span class="dependency-detail"><strong>前置（${escapeHtml(dependencyTypeLabels[bar.dependencyType] || bar.dependencyType)}）：</strong>${escapeHtml(dependencyDetail)}${blockedImpact ? `<span> → 阻塞：</span>${escapeHtml(blockedImpact)}` : ''}</span>`}
      </div>` : '';
    return `
      <div class="step-track ${escapeHtml(bar.status)} ${compact ? 'compact-task' : ''}"
           style="grid-column: ${colStart} / ${colEnd}; grid-row: ${row}; --bar-start: ${startOffset.toFixed(2)}px; --bar-width: ${durationWidth.toFixed(2)}px;"
           title="${escapeHtml(bar.stepName)}（${escapeHtml(bar.startDate)} → ${escapeHtml(bar.endDate)}）">
        <span class="step-duration" aria-hidden="true"></span>
        ${compact
          ? `<span class="short-task-chip"><span class="short-task-dot" aria-hidden="true"></span><span class="short-task-name">${escapeHtml(bar.stepName)}</span></span>`
          : `<span class="step-bar-label">${escapeHtml(bar.stepName)}</span>`}
      </div>
      ${callout}`;
  }).join('');
}

// 未排期工作包区域：按项目分组的固定尺寸灰色虚线卡
function renderUnscheduled(groups) {
  const section = document.getElementById('unscheduledSection');
  const body = document.getElementById('unscheduledBody');
  const countEl = document.getElementById('unscheduledCount');
  if (!section || !body) return;

  const validGroups = (groups || []).filter(g => g && g.steps && g.steps.length > 0);

  // 无 TBD 时整个区域隐藏
  if (validGroups.length === 0) {
    section.hidden = true;
    body.innerHTML = '';
    if (countEl) countEl.textContent = '';
    return;
  }

  const totalCards = validGroups.reduce((sum, g) => sum + g.steps.length, 0);
  if (countEl) countEl.textContent = `${validGroups.length} 个项目 · ${totalCards} 个工作包`;

  body.innerHTML = validGroups.map(group => {
    const p = group.project;
    const owner = getOwner(p);
    const stage = getStageName(p.stage);
    const cards = group.steps.map(step => `
      <div class="tbd-card" title="${escapeHtml(step.name)}">
        <span class="tbd-card-project">${escapeHtml(p.title)}</span>
        <span class="tbd-card-name">${escapeHtml(step.name)}</span>
        <span class="tbd-card-tag">未排期 · 无日期</span>
      </div>
    `).join('');

    return `
      <div class="unscheduled-group">
        <div class="unscheduled-group-head">
          <strong>${escapeHtml(p.title)}</strong>
          <span class="badge">${escapeHtml(owner)}</span>
          <span class="badge">${escapeHtml(stage)}</span>
        </div>
        <div class="tbd-card-row">${cards}</div>
      </div>
    `;
  }).join('');

  section.hidden = false;
}

// ========== 项目主数据 ==========
async function loadProjects() {
  if (!state.currentPortfolioId) return;
  
  try {
    const [projects, stages] = await Promise.all([
      api(`/portfolios/${state.currentPortfolioId}/projects`),
      api(`/portfolios/${state.currentPortfolioId}/stages`),
    ]);
    
    state.projects = projects;
    state.stages = stages;
    
    await renderProjectTable();
    renderStageSummary();
  } catch (e) {
    console.error('加载项目失败:', e);
  }
}

async function renderProjectTable() {
  const tbody = document.getElementById('dataBody');
  
  if (state.projects.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">暂无项目，点击上方"新增项目"创建</td></tr>';
    return;
  }
  
  const orderedProjects = buildProjectTree(state.projects);
  const rowsHtml = [];
  for (const { project: p, level, hasChildren, parentTitle } of orderedProjects) {
    const isTopLevel = !p.parent_id;
    const canArchive = isTopLevel && p.status === 'completed';
    
    // 获取关联资料数量
    let linksCount = 0;
    let linksHtml = '-';
    try {
      const links = await api(`/projects/${p.id}/links`);
      linksCount = links.length;
      if (linksCount > 0) {
        linksHtml = links.map(l => 
          `<a href="${l.url}" target="_blank" rel="noopener noreferrer" title="${l.title}">📎${linksCount}</a>`
        ).join(' ');
      }
    } catch (e) {}
    
    rowsHtml.push(`
      <tr data-id="${p.id}" data-tree-level="${level}">
        <td>
          <div class="project-tree-cell" style="--tree-depth: ${level};" role="treeitem" aria-level="${level + 1}"${hasChildren ? ` aria-expanded="${!state.collapsedProjectIds.has(p.id)}"` : ''}>
            <span class="tree-rail" aria-hidden="true"></span>
            ${hasChildren ? `<button class="tree-toggle" type="button" data-tree-toggle="${p.id}" aria-label="${state.collapsedProjectIds.has(p.id) ? '展开' : '收起'} ${escapeHtml(p.title)}">${state.collapsedProjectIds.has(p.id) ? '▸' : '▾'}</button>` : '<span class="tree-leaf" aria-hidden="true">└</span>'}
            <div class="project-tree-content">
              <div class="project-tree-title"><span class="project-kind">${p.parent_id ? '子项目' : '总项目'}</span>${escapeHtml(p.title)}</div>
              ${parentTitle ? `<small class="project-parent-ref">隶属：${escapeHtml(parentTitle)}</small>` : ''}
            </div>
          </div>
        </td>
        <td>${getOwner(p)}</td>
        <td>${p.expectation ? p.expectation.substring(0, 50) + (p.expectation.length > 50 ? '...' : '') : '-'}</td>
        <td>${getStageName(p.stage)}</td>
        <td>${p.health === 'unknown' ? '-' : (p.health || '-')}</td>
        <td><span class="badge ${getStatusClass(p.status)}">${p.status === 'completed' ? '已完成' : p.is_archived ? '已归档' : '执行中'}</span></td>
        <td>${linksHtml}</td>
        <td>
          <div class="action-stack">
            <button class="edit-btn" onclick="editProject('${p.id}')">编辑</button>
            ${p.status !== 'completed' ? `<button class="edit-btn" onclick="completeProject('${p.id}')">完成</button>` : ''}
            ${canArchive ? `<button class="edit-btn" onclick="archiveProject('${p.id}')">归档</button>` : ''}
            ${!p.parent_id && !p.is_archived ? `<button class="edit-btn danger" onclick="deleteProject('${p.id}')">删除</button>` : ''}
          </div>
        </td>
      </tr>
    `);
  }
  
  tbody.innerHTML = rowsHtml.join('');
  tbody.querySelectorAll('[data-tree-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const projectId = button.dataset.treeToggle;
      if (state.collapsedProjectIds.has(projectId)) state.collapsedProjectIds.delete(projectId);
      else state.collapsedProjectIds.add(projectId);
      renderProjectTable();
    });
  });
}

function buildProjectTree(projects) {
  const byId = new Map(projects.map((project, index) => [project.id, { project, index, children: [] }]));
  const roots = [];
  byId.forEach((node) => {
    const parent = node.project.parent_id ? byId.get(node.project.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  const byCreationOrder = (a, b) => a.index - b.index;
  roots.sort(byCreationOrder);
  byId.forEach((node) => node.children.sort(byCreationOrder));

  const output = [];
  const walk = (node, level, parentTitle = '') => {
    const hasChildren = node.children.length > 0;
    output.push({ project: node.project, level, hasChildren, parentTitle });
    if (hasChildren && !state.collapsedProjectIds.has(node.project.id)) {
      node.children.forEach((child) => walk(child, level + 1, node.project.title));
    }
  };
  roots.forEach((node) => walk(node, 0));
  return output;
}

function renderStageSummary() {
  const container = document.getElementById('stageSummary');
  container.innerHTML = state.stages.map(s => `<span>${s.name}</span>`).join('');
}

// ========== 归档中心 ==========
async function loadArchive() {
  if (!state.currentPortfolioId) return;
  
  try {
    const projects = await api(`/portfolios/${state.currentPortfolioId}/projects?includeArchived=true`);
    const archived = projects.filter(p => p.is_archived === 1 || p.status === 'archived');
    
    const container = document.getElementById('archiveBody');
    
    if (archived.length === 0) {
      container.innerHTML = '<div class="empty">暂无已归档项目</div>';
      return;
    }
    
    // 按顶级项目分组
    const topLevelArchived = archived.filter(p => !p.parent_id);
    
    container.innerHTML = topLevelArchived.map(p => `
      <div class="archive-card">
        <h3>${p.title}</h3>
        <p>归档时间：${p.archived_at ? formatDate(p.archived_at) : '-'}</p>
        <ul>
          ${archived.filter(a => a.parent_id === p.id || a.id === p.id).map(a => `<li>${a.title}</li>`).join('')}
        </ul>
      </div>
    `).join('');
  } catch (e) {
    console.error('加载归档失败:', e);
  }
}

// ========== 项目对话框 ==========
function setupProjectDialog() {
  // 添加步骤按钮
  document.getElementById('addStepBtn')?.addEventListener('click', () => {
    addStepRow({ _isNew: true });
  });
  
  // 添加关联资料按钮
  document.getElementById('addLinkBtn')?.addEventListener('click', () => {
    addLinkRow({ _isNew: true });
  });
  
  // 项目表单提交
  document.getElementById('projectForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveProject();
  });
}

function addStepRow(data = {}) {
  const container = document.getElementById('stepsForm');
  const tempId = 'new-' + Date.now() + '-' + Math.random().toString(36).substring(7);
  const stepId = data.id || tempId;
  
  const row = document.createElement('div');
  row.className = 'step-row';
  row.dataset.stepId = stepId;
  row.dataset.isNew = data._isNew ? 'true' : 'false';
  
  row.innerHTML = `
    <input type="text" class="step-name" value="${escapeHtml(data.name || '')}" placeholder="步骤名称"/>
    <input type="date" class="step-start" value="${data.start_date ? data.start_date.split('T')[0] : ''}"/>
    <input type="date" class="step-end" value="${data.end_date ? data.end_date.split('T')[0] : ''}"/>
    <select class="step-status">
      <option value="planned" ${data.status === 'planned' || !data.status ? 'selected' : ''}>计划中</option>
      <option value="done" ${data.status === 'done' ? 'selected' : ''}>已完成</option>
      <option value="risk" ${data.status === 'risk' ? 'selected' : ''}>有风险</option>
      <option value="blocked" ${data.status === 'blocked' ? 'selected' : ''}>已阻塞</option>
      <option value="tbd" ${data.status === 'tbd' ? 'selected' : ''}>TBD 未排期</option>
    </select>
    <select class="step-dependency-type" aria-label="依赖关系类型">
      <option value="none" ${!data.dependency_type || data.dependency_type === 'none' ? 'selected' : ''}>无依赖</option>
      <option value="finish_to_start" ${data.dependency_type === 'finish_to_start' ? 'selected' : ''}>完成后开始</option>
      <option value="input_required" ${data.dependency_type === 'input_required' ? 'selected' : ''}>关键输入</option>
      <option value="business_gate" ${data.dependency_type === 'business_gate' ? 'selected' : ''}>业务确认 Gate</option>
      <option value="external_dependency" ${data.dependency_type === 'external_dependency' ? 'selected' : ''}>外部依赖</option>
    </select>
    <input type="text" class="step-dependency-detail" value="${escapeHtml(data.dependency_detail || '')}" placeholder="前置依赖 / 关键输入"/>
    <input type="text" class="step-blocked-impact" value="${escapeHtml(data.blocked_impact || '')}" placeholder="阻塞影响（谁 / 什么决策）"/>
    <button type="button" onclick="removeStepRow(this)">×</button>
  `;
  
  container.appendChild(row);
}

function removeStepRow(btn) {
  btn.closest('.step-row').remove();
}

function addLinkRow(data = {}) {
  const container = document.getElementById('linksForm');
  const tempId = 'new-' + Date.now() + '-' + Math.random().toString(36).substring(7);
  const linkId = data.id || tempId;
  
  const row = document.createElement('div');
  row.className = 'link-row';
  row.dataset.linkId = linkId;
  row.dataset.isNew = data._isNew ? 'true' : 'false';
  
  row.innerHTML = `
    <input type="text" class="link-title" value="${data.title || ''}" placeholder="资料标题"/>
    <input type="url" class="link-url" value="${data.url || ''}" placeholder="https://..."/>
    <button type="button" onclick="removeLinkRow(this)">×</button>
  `;
  
  container.appendChild(row);
}

function removeLinkRow(btn) {
  btn.closest('.link-row').remove();
}

async function editProject(id) {
  const project = state.projects.find(p => p.id === id);
  if (!project) return;
  
  document.getElementById('projectDialogTitle').textContent = '编辑项目';
  document.getElementById('projectId').value = id;
  document.getElementById('title').value = project.title;
  document.getElementById('owner').value = project.owner || '';
  document.getElementById('expectation').value = project.expectation || '';
  document.getElementById('risk').value = project.risk || '';
  
  // 加载父项目选项
  const parentSelect = document.getElementById('parentId');
  parentSelect.innerHTML = '<option value="">无（顶级项目）</option>' +
    state.projects.filter(p => p.id !== id).map(p => 
      `<option value="${p.id}" ${p.id === project.parent_id ? 'selected' : ''}>${p.title}</option>`
    ).join('');
  
  // 加载 Stage 选项
  const stageSelect = document.getElementById('stage');
  stageSelect.innerHTML = '<option value="">未设置</option>' +
    state.stages.map(s => 
      `<option value="${s.name}" ${s.name === project.stage ? 'selected' : ''}>${s.name}</option>`
    ).join('');
  
  // 加载 Health
  document.getElementById('health').value = project.health || 'unknown';
  
  // 清空并重新加载步骤
  document.getElementById('stepsForm').innerHTML = '';
  try {
    const steps = await api(`/projects/${id}/steps`);
    steps.forEach(s => addStepRow(s));
  } catch (e) {
    console.error('加载步骤失败:', e);
  }
  
  // 清空并重新加载关联资料
  document.getElementById('linksForm').innerHTML = '';
  try {
    const links = await api(`/projects/${id}/links`);
    links.forEach(l => addLinkRow(l));
  } catch (e) {
    console.error('加载关联资料失败:', e);
  }
  
  document.getElementById('projectDialog').showModal();
}

async function saveProject() {
  const id = document.getElementById('projectId').value;
  const isNew = !id;
  
  const data = {
    title: document.getElementById('title').value,
    owner: document.getElementById('owner').value,
    stage: document.getElementById('stage').value || undefined,
    health: document.getElementById('health').value,
    expectation: document.getElementById('expectation').value || undefined,
    risk: document.getElementById('risk').value || undefined,
    parent_id: document.getElementById('parentId').value || undefined,
  };
  
  try {
    let projectId = id;
    
    if (isNew) {
      const result = await api(`/portfolios/${state.currentPortfolioId}/projects`, {
        method: 'POST',
        body: { ...data, actor: 'web-ui' },
      });
      projectId = result.id;
    } else {
      await api(`/projects/${id}`, {
        method: 'PUT',
        body: { ...data, actor: 'web-ui' },
      });
      projectId = id;
    }
    
    // 获取当前已有的步骤（用于对比）
    const existingSteps = isNew ? [] : await api(`/projects/${projectId}/steps`);
    const existingStepIds = new Set(existingSteps.map(s => s.id));
    
    // 获取当前已有的关联资料（用于对比）
    const existingLinks = isNew ? [] : await api(`/projects/${projectId}/links`);
    const existingLinkIds = new Set(existingLinks.map(l => l.id));
    
    // 处理步骤
    const stepRows = document.querySelectorAll('#stepsForm .step-row');
    const processedStepIds = new Set();
    
    for (const row of stepRows) {
      const stepId = row.dataset.stepId;
      const isNewStep = row.dataset.isNew === 'true';
      const name = row.querySelector('.step-name').value.trim();
      if (!name) continue;
      
      const startDate = row.querySelector('.step-start').value;
      const endDate = row.querySelector('.step-end').value;
      const status = row.querySelector('.step-status').value;
      const dependencyType = row.querySelector('.step-dependency-type').value;
      const dependencyDetail = row.querySelector('.step-dependency-detail').value.trim();
      const blockedImpact = row.querySelector('.step-blocked-impact').value.trim();

      if (dependencyType !== 'none' && !dependencyDetail) {
        throw new Error(`步骤「${name}」设置了依赖关系，必须填写前置依赖 / 关键输入`);
      }

      const stepPayload = {
        name,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        status,
        dependency_type: dependencyType,
        dependency_detail: dependencyDetail || undefined,
        blocked_impact: blockedImpact || undefined,
        actor: 'web-ui',
      };
      
      processedStepIds.add(stepId);
      
      if (isNewStep || !existingStepIds.has(stepId)) {
        // 新步骤：POST
        await api(`/projects/${projectId}/steps`, {
          method: 'POST',
          body: stepPayload,
        });
      } else {
        // 已有步骤：检查是否变更，变更则 PUT
        const existing = existingSteps.find(s => s.id === stepId);
        if (existing && (
          existing.name !== name ||
          existing.start_date !== startDate ||
          existing.end_date !== endDate ||
          existing.status !== status ||
          (existing.dependency_type || 'none') !== dependencyType ||
          (existing.dependency_detail || '') !== dependencyDetail ||
          (existing.blocked_impact || '') !== blockedImpact
        )) {
          await api(`/steps/${stepId}`, {
            method: 'PUT',
            body: stepPayload,
          });
        }
      }
    }
    
    // 删除未在表单中出现的步骤
    for (const step of existingSteps) {
      if (!processedStepIds.has(step.id)) {
        await api(`/steps/${step.id}`, { method: 'DELETE', body: { actor: 'web-ui' } });
      }
    }
    
    // 处理关联资料
    const linkRows = document.querySelectorAll('#linksForm .link-row');
    const processedLinkIds = new Set();
    
    for (const row of linkRows) {
      const linkId = row.dataset.linkId;
      const isNewLink = row.dataset.isNew === 'true';
      const title = row.querySelector('.link-title').value.trim();
      const url = row.querySelector('.link-url').value.trim();
      if (!title || !url) continue;
      
      // URL 验证
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        alert(`关联资料 URL 必须以 http:// 或 https:// 开头: ${title}`);
        continue;
      }
      
      processedLinkIds.add(linkId);
      
      if (isNewLink || !existingLinkIds.has(linkId)) {
        // 新资料：POST
        await api(`/projects/${projectId}/links`, {
          method: 'POST',
          body: { title, url, actor: 'web-ui' },
        });
      } else {
        // 已有资料：检查是否变更
        const existing = existingLinks.find(l => l.id === linkId);
        if (existing && (existing.title !== title || existing.url !== url)) {
          await api(`/links/${linkId}`, {
            method: 'PUT',
            body: { title, url, actor: 'web-ui' },
          });
        }
      }
    }
    
    // 删除未在表单中出现的关联资料
    for (const link of existingLinks) {
      if (!processedLinkIds.has(link.id)) {
        await api(`/links/${link.id}`, { method: 'DELETE', body: { actor: 'web-ui' } });
      }
    }
    
    document.getElementById('projectDialog').close();
    await loadProjects();
    loadGantt();
    loadStats();
    
  } catch (e) {
    console.error('保存失败:', e);
    alert('保存失败: ' + e.message);
  }
}

// ========== 组合对话框 ==========
function setupPortfolioDialog() {
  document.getElementById('portfolioForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const data = {
      name: document.getElementById('portfolioName').value,
      description: document.getElementById('portfolioDescription').value,
    };
    
    try {
      await api('/portfolios', { method: 'POST', body: { ...data, actor: 'web-ui' } });
      document.getElementById('portfolioDialog').close();
      await loadPortfolios();
    } catch (e) {
      alert('创建失败: ' + e.message);
    }
  });
}

// ========== Stage 对话框 ==========
function setupStageDialog() {
  document.getElementById('stageForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('newStageName').value;
    if (!name) return;
    
    try {
      await api(`/portfolios/${state.currentPortfolioId}/stages`, {
        method: 'POST',
        body: { name, actor: 'web-ui' },
      });
      document.getElementById('newStageName').value = '';
      await loadStageDialog();
    } catch (e) {
      alert('创建失败: ' + e.message);
    }
  });
}

async function loadStageDialog() {
  try {
    state.stages = await api(`/portfolios/${state.currentPortfolioId}/stages`);
    renderStageList();
  } catch (e) {
    console.error('加载 Stage 失败:', e);
  }
}

function renderStageList() {
  const container = document.getElementById('stageList');
  
  if (state.stages.length === 0) {
    container.innerHTML = '<p class="empty">暂无 Stage，点击上方添加</p>';
    return;
  }
  
  container.innerHTML = state.stages.map(s => {
    const inUse = state.projects.some(p => p.stage === s.name);
    return `
      <div>
        <span>${s.name}${inUse ? ' <small>(已被使用)</small>' : ''}</span>
        <button onclick="deleteStage('${s.id}', ${inUse})" ${inUse ? 'disabled title="已被项目使用"' : ''}>删除</button>
      </div>
    `;
  }).join('');
}

async function deleteStage(id, inUse) {
  if (inUse) {
    alert('此 Stage 已被项目使用，无法删除');
    return;
  }
  
  if (!confirm('确定删除此 Stage？')) return;
  
  try {
    const result = await api(`/stages/${id}`, { method: 'DELETE', body: { actor: 'web-ui' } });
    if (!result.success) {
      alert(result.message);
    }
    await loadStageDialog();
    await loadStages();
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
}

// ========== 项目操作 ==========
async function completeProject(id) {
  if (!confirm('确定将此项目标记为完成？')) return;
  
  try {
    await api(`/projects/${id}/complete`, { method: 'POST', body: { actor: 'web-ui' } });
    await loadProjects();
    loadGantt();
    loadStats();
  } catch (e) {
    alert('操作失败: ' + e.message);
  }
}

async function archiveProject(id) {
  if (!confirm('确定归档此项目及其所有后代？')) return;
  
  try {
    const result = await api(`/projects/${id}/archive`, { method: 'POST', body: { actor: 'web-ui' } });
    if (!result.success) {
      alert('归档失败: ' + result.message);
    }
    await loadProjects();
    loadGantt();
    loadStats();
  } catch (e) {
    alert('归档失败: ' + e.message);
  }
}

async function deleteProject(id) {
  if (!confirm('确定删除此项目？子项目也会被删除。')) return;
  
  try {
    await api(`/projects/${id}`, { method: 'DELETE', body: { actor: 'web-ui' } });
    await loadProjects();
    loadGantt();
    loadStats();
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
}

async function loadStages() {
  if (!state.currentPortfolioId) return;
  try {
    state.stages = await api(`/portfolios/${state.currentPortfolioId}/stages`);
  } catch (e) {
    console.error('加载 Stage 失败:', e);
  }
}

// ========== 备份状态（WP-008 L2） ==========

/**
 * 从服务端获取隔离恢复库就绪状态。
 * false：禁用演练按钮，显示"等待管理员配置隔离恢复库"。
 * true：允许选择备份并执行演练。
 */
async function loadBackupStatus() {
  const drillBtn = document.getElementById('drillRestoreBtn');
  const container = document.getElementById('backupList');

  try {
    const status = await api('/backups/status');
    restoreDrillAvailable = !!status.restoreDrillAvailable;
  } catch {
    restoreDrillAvailable = false;
  }

  if (drillBtn) {
    if (!restoreDrillAvailable) {
      drillBtn.disabled = true;
      drillBtn.title = '等待管理员配置隔离恢复库';
    } else {
      // 有可用备份时才启用
      if (selectedBackupKey) {
        drillBtn.disabled = false;
        drillBtn.title = '';
      }
    }
  }

  if (container && !restoreDrillAvailable) {
    // 在备份列表上方显示警告
    const existingWarning = container.parentElement.querySelector('.drill-warning');
    if (!existingWarning) {
      const warning = document.createElement('div');
      warning.className = 'drill-warning';
      warning.innerHTML = '<strong>⚠ 恢复演练已禁用：</strong>隔离恢复库尚未由管理员配置（RESTORE_DRILL_DB 未绑定）。请联系管理员完成配置后再执行恢复演练。';
      container.parentElement.insertBefore(warning, container);
    }
  }
}
let selectedBackupKey = null;
let restoreDrillAvailable = false;

function setupBackupControls() {
  document.getElementById('refreshBackupsBtn')?.addEventListener('click', loadBackups);
  document.getElementById('createBackupBtn')?.addEventListener('click', createBackup);
  document.getElementById('drillRestoreBtn')?.addEventListener('click', runDrillRestore);
}

async function loadBackups() {
  const container = document.getElementById('backupList');
  const drillBtn = document.getElementById('drillRestoreBtn');
  if (!container) return;

  container.innerHTML = '<div class="loading">正在加载备份列表...</div>';
  selectedBackupKey = null;
  if (drillBtn) drillBtn.disabled = true;

  // 获取隔离恢复库就绪状态
  await loadBackupStatus();

  try {
    const backups = await api('/backups');

    if (backups.length === 0) {
      container.innerHTML = '<div class="empty">暂无备份记录。每天 UTC 03:00 会自动触发首次备份。</div>';
      return;
    }

    container.innerHTML = backups.map(b => `
      <div class="backup-item${selectedBackupKey === b.key ? ' selected' : ''}" data-key="${b.key}">
        <div class="backup-item-main">
          <span class="backup-key">${b.key}</span>
          <span class="backup-meta">
            ${b.createdAt ? new Date(b.createdAt).toLocaleString('zh-CN') : '未知时间'}
            · ${formatBytes(b.size || 0)}
            · SHA: ${(b.contentSha256 || '').slice(0, 12)}...
          </span>
        </div>
        <button class="backup-select-btn" data-key="${b.key}">选择</button>
      </div>
    `).join('');

    // 添加选择事件
    container.querySelectorAll('.backup-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('backup-select-btn')) {
          container.querySelectorAll('.backup-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          selectedBackupKey = item.dataset.key;
          if (drillBtn) drillBtn.disabled = false;
        }
      });
    });

  } catch (e) {
    container.innerHTML = `<div class="error">加载失败: ${e.message}</div>`;
  }
}

async function createBackup() {
  const btn = document.getElementById('createBackupBtn');
  const container = document.getElementById('backupList');
  if (!btn || !container) return;

  btn.disabled = true;
  btn.textContent = '备份中...';
  container.innerHTML = '<div class="loading">正在创建备份...</div>';

  try {
    const result = await api('/backups', { method: 'POST' });
    container.innerHTML = `<div class="success">备份成功！Key: ${result.key}<br>SHA-256: ${result.contentSha256}</div>`;
    // 延迟刷新列表
    setTimeout(loadBackups, 1500);
  } catch (e) {
    container.innerHTML = `<div class="error">备份失败: ${e.message}</div>`;
    btn.disabled = false;
    btn.textContent = '立即备份';
  }
}

async function runDrillRestore() {
  if (!selectedBackupKey) {
    alert('请先选择一个备份');
    return;
  }

  // 确认隔离库已就绪
  if (!restoreDrillAvailable) {
    alert('隔离恢复库尚未由管理员配置，无法执行恢复演练');
    return;
  }

  // 确认恢复演练只能恢复到隔离库
  if (!confirm(`确定执行恢复演练？\n备份: ${selectedBackupKey}\n\n演练将恢复到隔离 D1，绝不覆盖生产数据。`)) {
    return;
  }

  const btn = document.getElementById('drillRestoreBtn');
  const container = document.getElementById('backupList');
  if (!btn || !container) return;

  btn.disabled = true;
  btn.textContent = '恢复演练中...';
  container.innerHTML = '<div class="loading">正在执行恢复演练（恢复到隔离 D1）...</div>';

  try {
    // 恢复目标固定为隔离 D1（RESTORE_DRILL_DB），前端不传 targetDbBinding
    const result = await api('/backups/restore', {
      method: 'POST',
      body: { key: selectedBackupKey }
    });

    const tables = Object.entries(result.tableSummaries || {})
      .map(([t, s]) => `<li>${t}: ${s.rows} 行</li>`)
      .join('');

    container.innerHTML = `
      <div class="success">
        <h4>恢复演练完成</h4>
        <p>备份已恢复到隔离 D1（RESTORE_DRILL_DB）。</p>
        <p>验证结果：${result.verified ? '通过' : '未通过'}</p>
        <h5>各表行数摘要：</h5>
        <ul>${tables}</ul>
      </div>
    `;
  } catch (e) {
    // 503 = 隔离库未配置
    if (e.message && e.message.includes('隔离库')) {
      container.innerHTML = `<div class="error">${e.message}</div>`;
    } else {
      container.innerHTML = `<div class="error">恢复演练失败: ${e.message}</div>`;
    }
    btn.disabled = false;
    btn.textContent = '执行恢复演练';
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ========== 全局函数 ==========
window.editProject = editProject;
window.completeProject = completeProject;
window.archiveProject = archiveProject;
window.deleteProject = deleteProject;
window.deleteStage = deleteStage;
window.removeStepRow = removeStepRow;
window.removeLinkRow = removeLinkRow;

// 新增项目按钮
document.getElementById('addBtn')?.addEventListener('click', () => {
  document.getElementById('projectDialogTitle').textContent = '新增项目';
  document.getElementById('projectForm').reset();
  document.getElementById('projectId').value = '';
  document.getElementById('stepsForm').innerHTML = '';
  document.getElementById('linksForm').innerHTML = '';
  
  // 加载父项目选项
  const parentSelect = document.getElementById('parentId');
  parentSelect.innerHTML = '<option value="">无（顶级项目）</option>' +
    state.projects.map(p => `<option value="${p.id}">${p.title}</option>`).join('');
  
  // 加载 Stage 选项
  const stageSelect = document.getElementById('stage');
  stageSelect.innerHTML = '<option value="">未设置</option>' +
    state.stages.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
  
  document.getElementById('projectDialog').showModal();
});
