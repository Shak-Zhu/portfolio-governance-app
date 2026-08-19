// WP-011｜汇报筛选：纯算法层（唯一实现）
//
// 这是 app.js 与 scripts/test-report-filter.mjs 共同引用的唯一筛选实现。
// 不得在 app.js 或测试脚本内复制本文件的算法；只能从这一个源 import。
//
// 浏览器侧：
//   - 通过 <script type="module" src="/filter-core.js"> 加载；本文件末尾在浏览器侧
//     将导出挂到 window.SHAK_PMO_FILTER_CORE，供 app.js（普通脚本）直接使用。
//   - 不依赖任何 DOM；只接受 projects / rows / unscheduled / localStorage 引用。
//
// Node 侧：
//   - `import * as core from './public/filter-core.js'`（scripts/test-report-filter.mjs）。
//
// 关键约定：
//   - 所有函数都是纯函数（输入决定输出），便于单元测试。
//   - 任何"过期 ID"清理都在 apply/load 时按当前组合有效顶级项目集合执行；
//     清理后为空 → 删除 storage key → 视为"未应用筛选"。
//   - localStorage 通过参数传入，避免在测试中污染全局。

export const FILTER_STORAGE_PREFIX = 'shak_pmo_report_filter_v1:';

export function getFilterStorageKey(portfolioId) {
  return portfolioId ? `${FILTER_STORAGE_PREFIX}${portfolioId}` : null;
}

// ---- localStorage 读写（含 JSON 校验；不抛异常；无 storage 时返回 null） ----
export function loadFilterFromStorage(storage, portfolioId) {
  const key = getFilterStorageKey(portfolioId);
  if (!key || !storage) return null;
  let raw;
  try { raw = storage.getItem(key); } catch { return null; }
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((x) => typeof x === 'string'));
  } catch {}
  return null;
}

export function persistFilterToStorage(storage, portfolioId, sel) {
  const key = getFilterStorageKey(portfolioId);
  if (!key || !storage) return;
  try {
    if (sel === null || sel === undefined || (sel instanceof Set && sel.size === 0)) {
      storage.removeItem(key);
    } else if (sel instanceof Set) {
      storage.setItem(key, JSON.stringify(Array.from(sel)));
    }
  } catch {
    // localStorage 不可用（隐私模式 / 配额）时静默忽略。
  }
}

// ---- 计算有效顶级项目集合（依据当前组合全部项目） ----
export function computeTopLevelIds(allProjects) {
  const ids = [];
  for (const p of (allProjects || [])) {
    if (p && !p.parent_id && typeof p.id === 'string') ids.push(p.id);
  }
  return ids;
}

// ---- 校验 + 清理 selection ----
// 返回 { selection: Set|null, validCount: number, total: number, changed: boolean }
// - selection: 清理后的有效顶级项目 id 集合；若无任何有效顶级项目，返回 null（视为未应用）。
// - validCount: 清理后 selection 中的顶级项目数（用于按钮分子）。
// - total: 当前组合顶级项目总数（用于按钮分母）。
// - changed: 是否因清理而减少了元素（用于决定是否要回写 storage）。
export function sanitizeSelection(rawSelection, allProjects) {
  const topLevel = computeTopLevelIds(allProjects);
  const total = topLevel.length;
  const topLevelSet = new Set(topLevel);
  const raw = rawSelection instanceof Set ? rawSelection : null;
  if (!raw) {
    return { selection: null, validCount: 0, total, changed: false };
  }
  const cleaned = new Set();
  let changed = false;
  for (const id of raw) {
    if (topLevelSet.has(id)) cleaned.add(id);
    else changed = true;
  }
  if (cleaned.size === 0) {
    // 全部失效 → 视为未应用；调用方需删除 storage key
    return { selection: null, validCount: 0, total, changed: raw.size > 0 };
  }
  return { selection: cleaned, validCount: cleaned.size, total, changed };
}

// ---- 子树展开（自顶向下） ----
function expandSubtree(selectedTopIds, allProjects) {
  const childrenByParent = new Map();
  for (const p of (allProjects || [])) {
    if (p && p.parent_id) {
      const list = childrenByParent.get(p.parent_id) || [];
      list.push(p.id);
      childrenByParent.set(p.parent_id, list);
    }
  }
  const allowed = new Set();
  const walkDown = (id) => {
    allowed.add(id);
    for (const c of childrenByParent.get(id) || []) walkDown(c);
  };
  for (const id of selectedTopIds) walkDown(id);
  return allowed;
}

// ---- 核心：根据 rawSelection + 当前组合项目 + 原始甘特数据返回过滤结果 ----
// inputs:
//   - allProjects: 当前组合的全部项目（含顶级和子项目）
//   - ganttData: { rows: GanttRow[], unscheduled: UnscheduledGroup[], timeline, config, ... }
//   - rawSelection: Set<string> | null
// outputs:
//   - rows: 过滤后的项目行
//   - unscheduled: 过滤后的未排期工作包分组（按项目过滤）
//   - effectiveSelection: 清理后的顶级项目 id 集合；若清理后为空 → null
//   - topLevelTotal: 当前组合顶级项目总数
//   - sanitized: 是否因过期 ID / 非法值发生了清理（用于调用方决定是否回写 storage）
export function computeGanttVisibility(allProjects, ganttData, rawSelection) {
  const topLevelTotal = computeTopLevelIds(allProjects).length;
  const data = ganttData || { rows: [], unscheduled: [] };

  // 1) 清理 selection
  const { selection, changed } = sanitizeSelection(rawSelection, allProjects);

  if (!selection) {
    // 未应用筛选（含清理后为空）：完整返回，但标记 changed 让调用方回写 storage
    return {
      rows: data.rows || [],
      unscheduled: data.unscheduled || [],
      effectiveSelection: null,
      topLevelTotal,
      sanitized: changed,
    };
  }

  // 2) 应用筛选：基于清理后的 selection 展开子树
  const allowed = expandSubtree(selection, allProjects);
  const rows = (data.rows || []).filter((r) => r && r.project && allowed.has(r.project.id));
  const unscheduled = (data.unscheduled || []).filter((g) => g && g.project && allowed.has(g.project.id));
  return {
    rows,
    unscheduled,
    effectiveSelection: selection,
    topLevelTotal,
    sanitized: changed,
  };
}

// ---- 计算按钮文案 "显示项目 m/n" 与状态条文案（仅基于有效顶级项目集合） ----
// 返回：{ buttonText, statusText, statusVisible, applied, validCount, total }
export function renderFilterUI({ effectiveSelection, topLevelTotal }) {
  const applied = effectiveSelection instanceof Set && effectiveSelection.size > 0;
  const total = topLevelTotal || 0;
  const validCount = applied ? effectiveSelection.size : total;
  const buttonText = `显示项目 ${validCount}/${total}`;
  const statusVisible = applied;
  const statusText = applied
    ? `汇报筛选：仅显示 ${validCount} / ${total} 个顶级项目`
    : '';
  return { buttonText, statusText, statusVisible, applied, validCount, total };
}

// ---- 浏览器侧挂载：让 app.js（普通脚本）可通过 window.SHAK_PMO_FILTER_CORE 访问 ----
if (typeof window !== 'undefined') {
  window.SHAK_PMO_FILTER_CORE = {
    FILTER_STORAGE_PREFIX,
    getFilterStorageKey,
    loadFilterFromStorage,
    persistFilterToStorage,
    computeTopLevelIds,
    sanitizeSelection,
    computeGanttVisibility,
    renderFilterUI,
  };
}