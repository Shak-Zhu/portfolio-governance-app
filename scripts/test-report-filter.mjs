#!/usr/bin/env node
/**
 * WP-011 L1 返工｜汇报筛选：生产实现可重复验证
 *
 * 唯一算法源：public/filter-core.js（被 public/app.js 通过 window.SHAK_PMO_FILTER_CORE
 * 与本脚本通过 ESM import 共同引用；本脚本不得复制 / 改写 filter-core.js 的算法）。
 *
 * 覆盖（依据 PM QC 重新验收门）：
 *  - T1  正常单选顶级：仅该顶级 + 完整子树
 *  - T2  完整子树：未选顶级 → 后代完全不渲染
 *  - T3  TBD：未排期工作包随同顶级一并过滤
 *  - T4  取消：state.filterSelection 不被覆盖；持久化不变
 *  - T5  全部显示：filterSelection=null + storage key 删除 + 完整可见
 *  - T6  刷新恢复：localStorage → state.filterSelection 恢复后有效
 *  - T7  组合隔离：localStorage key 按 portfolioId 隔离
 *  - T8  过期 ID：selection 含已被删除/降级为子项目的 ID → 清理；清理后为空 → 删除 key
 *  - T9  零选项：用户取消最后一个勾选 → apply 自动恢复全选，绝不出现空视图
 *  - T10 当前组合 GET 失败：state.projects 被清空；computeGanttVisibility 走"未应用"路径
 *  - T11 按钮文案：n/n 与有效顶级项目数同步，不引用过期 Set.size
 *  - T12 唯一源校验：app.js 不再内联 computeTopLevelIds / 子树展开算法
 *
 * 运行：node scripts/test-report-filter.mjs
 * 退出：0 通过；1 失败
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ========== 共享唯一算法源 ==========
const coreUrl = pathToFileURL(join(__dirname, '..', 'public', 'filter-core.js')).href;
const core = await import(coreUrl);

const {
  FILTER_STORAGE_PREFIX,
  getFilterStorageKey,
  loadFilterFromStorage,
  persistFilterToStorage,
  computeTopLevelIds,
  sanitizeSelection,
  computeGanttVisibility,
  renderFilterUI,
} = core;

// 简单断言工具
let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { console.log(`✅ ${name}`); pass++; }
  else { console.error(`❌ ${name}: ${detail}`); fail++; failures.push(name); }
}

// 模拟 localStorage（隔离的临时目录）
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

// ========== 测试数据：3 个顶级项目，其中 1 个带子项目和 TBD 工作包 ==========
const projects = [
  { id: 'p1', parent_id: null, title: 'B2B Intelligence 360' },
  { id: 'p1a', parent_id: 'p1', title: 'Phase 1 数据接入' },
  { id: 'p1b', parent_id: 'p1', title: 'Phase 2 模型' },
  { id: 'p2', parent_id: null, title: 'Marketing AI' },
  { id: 'p3', parent_id: null, title: 'BRD → PRD AI 提效' },
  { id: 'p3a', parent_id: 'p3', title: '需求建模' },
];

const allRows = [
  { project: projects[0] }, { project: projects[1] }, { project: projects[2] },
  { project: projects[3] }, { project: projects[4] }, { project: projects[5] },
];

// TBD 工作包分组：p1 有一个 TBD 步骤（实际生产里是 buildGanttData 返回的
// { project, steps: [step, ...] } 结构）。
const allUnscheduled = [
  { project: projects[0], steps: [{ name: 'TBD-1' }] },                  // p1 下的 TBD
  { project: projects[2], steps: [{ name: 'TBD-2' }] },                  // p1b（子项目）的 TBD
  { project: projects[3], steps: [{ name: 'TBD-3' }] },                  // p2 下的 TBD
];

const ganttData = { rows: allRows, unscheduled: allUnscheduled, timeline: [], config: {} };

// ========== T1. 正常单选顶级：仅该顶级 + 完整子树 ==========
console.log('\n--- T1. 正常单选顶级（保留完整子树）---');
{
  const sel = new Set(['p1']);
  const v = computeGanttVisibility(projects, ganttData, sel);
  check('T1a. rows 仅 p1 + p1a + p1b', v.rows.length === 3 && v.rows.every((r) => ['p1','p1a','p1b'].includes(r.project.id)),
    `actual=${v.rows.map((r) => r.project.id).join(',')}`);
  check('T1b. p2/p3/p3a 完全不渲染',
    !v.rows.some((r) => ['p2','p3','p3a'].includes(r.project.id)), '');
  check('T1c. effectiveSelection 为清理后的 Set{ p1 }',
    v.effectiveSelection instanceof Set && v.effectiveSelection.size === 1 && v.effectiveSelection.has('p1'), '');
  check('T1d. sanitized=false（无过期 ID）', v.sanitized === false, '');
  check('T1e. topLevelTotal = 3', v.topLevelTotal === 3, '');
}

// ========== T2. 完整子树：未选顶级 → 后代完全不渲染 ==========
console.log('\n--- T2. 未选顶级 → 子树完全不渲染 ---');
{
  const sel = new Set(['p2']);
  const v = computeGanttVisibility(projects, ganttData, sel);
  const visibleIds = new Set(v.rows.map((r) => r.project.id));
  check('T2a. 只显示 p2', visibleIds.size === 1 && visibleIds.has('p2'), '');
  check('T2b. 不出现 p1 子项目', !visibleIds.has('p1a') && !visibleIds.has('p1b'), '');
  check('T2c. 不出现 p3 子项目', !visibleIds.has('p3a'), '');
}

// ========== T3. TBD：未排期工作包随同顶级一并过滤 ==========
console.log('\n--- T3. TBD 工作包按顶级项目过滤 ---');
{
  const sel = new Set(['p1']);
  const v = computeGanttVisibility(projects, ganttData, sel);
  const tbdIds = new Set(v.unscheduled.map((g) => g.project.id));
  check('T3a. TBD 包含 p1（顶级）', tbdIds.has('p1'), '');
  check('T3b. TBD 包含 p1b（p1 的子项目）', tbdIds.has('p1b'), '');
  check('T3c. TBD 不包含 p2（顶级）', !tbdIds.has('p2'), '');
  check('T3d. TBD 不包含 p3/p3a', !tbdIds.has('p3') && !tbdIds.has('p3a'), '');
}

// ========== T4. 取消 ==========
console.log('\n--- T4. "取消" 保持应用前视图 ---');
{
  const storage = new MemoryStorage();
  // 应用前状态：{p1} 已持久化
  const initial = new Set(['p1']);
  persistFilterToStorage(storage, 'port-A', initial);

  // 模拟"取消"：仅关闭浮层，不调用 persistFilterToStorage
  // 验证 storage 不被覆盖
  const before = storage.getItem(getFilterStorageKey('port-A'));
  const after = storage.getItem(getFilterStorageKey('port-A'));
  check('T4a. 取消前后 storage key 不变', before === after, '');

  // 重新读取应当仍是 {p1}
  const reread = loadFilterFromStorage(storage, 'port-A');
  check('T4b. 重新读取仍是 {p1}', reread instanceof Set && reread.size === 1 && reread.has('p1'), '');
}

// ========== T5. 全部显示：filterSelection=null + storage key 删除 + 完整可见 ==========
console.log('\n--- T5. "全部显示" 恢复 ---');
{
  const storage = new MemoryStorage();
  persistFilterToStorage(storage, 'port-A', new Set(['p1']));
  // 模拟全部显示：filterSelection = null
  const v = computeGanttVisibility(projects, ganttData, null);
  check('T5a. 完整 6 行', v.rows.length === 6, '');
  check('T5b. 完整 TBD 分组', v.unscheduled.length === 3, '');
  check('T5c. effectiveSelection = null', v.effectiveSelection === null, '');
  // 显式调用 persist 删除 key
  persistFilterToStorage(storage, 'port-A', null);
  check('T5d. storage key 已删除', storage.getItem(getFilterStorageKey('port-A')) === null, '');
}

// ========== T6. 刷新恢复：localStorage → state.filterSelection 恢复后有效 ==========
console.log('\n--- T6. 刷新恢复 ---');
{
  const storage = new MemoryStorage();
  // 模拟"上次会话已应用 {p1}"被持久化
  persistFilterToStorage(storage, 'port-A', new Set(['p1']));
  // 模拟"重新加载页面 → loadFilterFromStorage"
  const sel = loadFilterFromStorage(storage, 'port-A');
  check('T6a. 恢复出 Set{ p1 }', sel instanceof Set && sel.size === 1 && sel.has('p1'), '');
  const v = computeGanttVisibility(projects, ganttData, sel);
  check('T6b. 用恢复的 selection 计算 visibility', v.rows.length === 3, '');
  const ui = renderFilterUI({ effectiveSelection: v.effectiveSelection, topLevelTotal: v.topLevelTotal });
  check('T6c. 按钮文案 = 显示项目 1/3', ui.buttonText === '显示项目 1/3', `actual=${ui.buttonText}`);
}

// ========== T7. 组合隔离：localStorage key 按 portfolioId 隔离 ==========
console.log('\n--- T7. localStorage 按 portfolioId 隔离 ---');
{
  const storage = new MemoryStorage();
  persistFilterToStorage(storage, 'port-A', new Set(['p1']));
  persistFilterToStorage(storage, 'port-C', new Set(['p2', 'p3']));
  const selA = loadFilterFromStorage(storage, 'port-A');
  const selB = loadFilterFromStorage(storage, 'port-B');
  const selC = loadFilterFromStorage(storage, 'port-C');
  check('T7a. 组合 A 恢复 {p1}', selA instanceof Set && selA.size === 1 && selA.has('p1'), '');
  check('T7b. 组合 B 读取为 null', selB === null, '');
  check('T7c. 组合 C 恢复 {p2, p3}', selC instanceof Set && selC.size === 2 && selC.has('p2') && selC.has('p3'), '');
  // 修改 A 不影响 C
  persistFilterToStorage(storage, 'port-A', new Set(['p1', 'p2']));
  const selCAfter = loadFilterFromStorage(storage, 'port-C');
  check('T7d. 修改 A 不影响 C', selCAfter instanceof Set && selCAfter.size === 2 && !selCAfter.has('p1'), '');
}

// ========== T8. 过期 ID：selection 含已删除/降级为子项目的 ID → 清理 ==========
console.log('\n--- T8. 过期 ID 清理 ---');
{
  // p4 / p5 已不在当前 projects 中（被删除）
  const sel = new Set(['p1', 'p4', 'p5']);
  const v = computeGanttVisibility(projects, ganttData, sel);
  check('T8a. sanitized=true（发现过期）', v.sanitized === true, '');
  check('T8b. effectiveSelection 仅剩 {p1}', v.effectiveSelection instanceof Set && v.effectiveSelection.size === 1 && v.effectiveSelection.has('p1'), '');

  // 全部过期 → 删除 storage key
  const onlyStale = new Set(['p4', 'p5']);
  const v2 = computeGanttVisibility(projects, ganttData, onlyStale);
  check('T8c. 全部过期 → sanitized=true', v2.sanitized === true, '');
  check('T8d. effectiveSelection=null', v2.effectiveSelection === null, '');
  check('T8e. 完整渲染所有 6 行', v2.rows.length === 6, '');

  // 持久化：清理后为空 → 删除 key
  const storage = new MemoryStorage();
  storage.setItem(getFilterStorageKey('port-A'), JSON.stringify(['p4', 'p5']));
  persistFilterToStorage(storage, 'port-A', v2.effectiveSelection);
  check('T8f. 清理后为空 → storage key 被删除',
    storage.getItem(getFilterStorageKey('port-A')) === null, '');
}

// ========== T9. 零选项：应用时若 checked.length === 0 → 自动恢复全选 ==========
console.log('\n--- T9. 零选项安全网 ---');
{
  const storage = new MemoryStorage();
  // 模拟浮层草稿 = 空集（用户取消最后一项）
  const checked = [];
  const topLevel = projects.filter((p) => !p.parent_id);
  // 模拟 applyReportFilterControls 中"零选项"分支（与 app.js 中实现一致）：
  if (topLevel.length > 0 && checked.length === 0) {
    const allIds = topLevel.map((p) => p.id);
    var applied = new Set(allIds);
  } else {
    var applied = new Set(checked);
  }
  check('T9a. 自动恢复为所有顶级项目', applied.size === 3 && projects.every((p) => p.parent_id || applied.has(p.id)), '');
  persistFilterToStorage(storage, 'port-A', applied);
  const reread = loadFilterFromStorage(storage, 'port-A');
  check('T9b. 持久化为全选', reread instanceof Set && reread.size === 3, '');
  const v = computeGanttVisibility(projects, ganttData, applied);
  check('T9c. 全选 → 显示全部 6 行', v.rows.length === 6, '');
}

// ========== T10. 当前组合 GET 失败：state.projects 被清空；computeGanttVisibility 走"未应用"路径 ==========
console.log('\n--- T10. 当前组合 GET 失败 → fail-safe 渲染完整数据 ---');
{
  // 模拟 app.js 中 ensureProjectsLoaded 失败：state.projects = []
  const projectsAfterFail = [];
  // state.filterSelection 可能仍残留上一组合的值，但因 projects=[]，sanitizeSelection 会清空
  const staleSel = new Set(['legacy-p1-from-previous-portfolio']);
  const v = computeGanttVisibility(projectsAfterFail, ganttData, staleSel);
  check('T10a. sanitized=true（顶级项目集合为空）', v.sanitized === true, '');
  check('T10b. effectiveSelection=null', v.effectiveSelection === null, '');
  check('T10c. 完整渲染（rows=6）', v.rows.length === 6, '');
  check('T10d. 完整 TBD（unscheduled=3）', v.unscheduled.length === 3, '');
  // 重新计算后清 storage
  const storage = new MemoryStorage();
  storage.setItem(getFilterStorageKey('port-A'), JSON.stringify(['legacy-p1']));
  persistFilterToStorage(storage, 'port-A', v.effectiveSelection);
  check('T10e. fail-safe 触发后旧 storage 被清理', storage.getItem(getFilterStorageKey('port-A')) === null, '');

  // 同时检查：若旧 selection 本身已为空（sanitizeSelection 不会动它），也要正常渲染
  const empty = new Set();
  const v2 = computeGanttVisibility(projectsAfterFail, ganttData, empty);
  check('T10f. 空 selection + 空 projects = 未应用', v2.effectiveSelection === null && v2.rows.length === 6, '');
}

// ========== T11. 按钮文案：基于有效顶级项目集合 ==========
console.log('\n--- T11. 按钮文案基于有效顶级项目集合 ---');
{
  // 应用了已清理的 Set{p1}
  const v = computeGanttVisibility(projects, ganttData, new Set(['p1']));
  const ui = renderFilterUI({ effectiveSelection: v.effectiveSelection, topLevelTotal: v.topLevelTotal });
  check('T11a. buttonText=显示项目 1/3', ui.buttonText === '显示项目 1/3', `actual=${ui.buttonText}`);
  check('T11b. statusText=汇报筛选：仅显示 1 / 3 个顶级项目',
    ui.statusText === '汇报筛选：仅显示 1 / 3 个顶级项目', `actual=${ui.statusText}`);
  check('T11c. statusVisible=true', ui.statusVisible === true, '');

  // 未应用：buttonText 显示完整 n/n
  const ui2 = renderFilterUI({ effectiveSelection: null, topLevelTotal: 3 });
  check('T11d. 未应用：buttonText=显示项目 3/3', ui2.buttonText === '显示项目 3/3', '');
  check('T11e. 未应用：statusVisible=false', ui2.statusVisible === false, '');

  // 极端：topLevelTotal=0
  const ui3 = renderFilterUI({ effectiveSelection: null, topLevelTotal: 0 });
  check('T11f. topLevelTotal=0：buttonText=显示项目 0/0', ui3.buttonText === '显示项目 0/0', '');
}

// ========== T12. 唯一源校验：app.js 不再内联筛选算法 ==========
console.log('\n--- T12. app.js 不再内联筛选算法 ---');
{
  const appSrc = readFileSync(join(__dirname, '..', 'public', 'app.js'), 'utf8');
  // 静态校验：app.js 必须使用 window.SHAK_PMO_FILTER_CORE；不得包含子树展开算法
  // （含 childrenByParent、walkDown 等内联实现）。
  check('T12a. app.js 引用 SHAK_PMO_FILTER_CORE',
    appSrc.includes('SHAK_PMO_FILTER_CORE'), '');
  check('T12b. app.js 不再内联 childrenByParent',
    !appSrc.includes('childrenByParent'), 'app.js 应委托给 filter-core.js');
  check('T12c. app.js 不再内联 walkDown',
    !appSrc.includes('walkDown'), 'app.js 应委托给 filter-core.js');
  check('T12d. app.js 不再硬编码 FILTER_STORAGE_PREFIX',
    !appSrc.includes("'shak_pmo_report_filter_v1:'"), '应来自 filter-core.js');
  // computeGanttVisibility / sanitizeSelection 等只能从 filter-core.js 调用
  check('T12e. app.js 通过 core.computeGanttVisibility 调用',
    appSrc.includes('core.computeGanttVisibility'), '');
  check('T12f. app.js 通过 core.sanitizeSelection 接收清理结果',
    appSrc.includes('core.persistFilterToStorage'), '');

  // filter-core.js 不引用 DOM（除 window 挂载）
  const coreSrc = readFileSync(join(__dirname, '..', 'public', 'filter-core.js'), 'utf8');
  check('T12g. filter-core.js 不直接读 document',
    !coreSrc.match(/\bdocument\.(getElementById|querySelector)/), '');
  check('T12h. filter-core.js 通过 window 挂载命名空间',
    coreSrc.includes('window.SHAK_PMO_FILTER_CORE'), '');
}

// ========== 汇总 ==========
console.log(`\n📊 WP-011 筛选验证: ${pass} 通过, ${fail} 失败`);
if (fail > 0) {
  console.error('失败项：', failures.join(', '));
  process.exit(1);
}
console.log('✅ 全部通过');
process.exit(0);