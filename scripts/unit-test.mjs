// WP-005 单元测试：直接导入 src/lib/gantt-core.js 的真实实现进行验证，
// 不再复制业务逻辑。覆盖：时间轴单元格数量、条形按真实格边界落位、
// 长区间（366 天 / 260 周 / 120 月）无截断、TBD 分离与 TBD→Plan→TBD 迁移。
import {
  isValidDateStr,
  isUnscheduled,
  generateTimeline,
  calculateBars,
  collectUnscheduled,
} from '../src/lib/gantt-core.js';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
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

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || ''} 期望 ${expected}，实际 ${actual}`);
  }
}

// ===== 日期校验 =====
check('isValidDateStr 接受合法日期，拒绝非法/溢出日期', () => {
  assert(isValidDateStr('2026-07-29'), '合法日期应通过');
  assert(isValidDateStr('2026-01-01'), '合法日期应通过');
  assert(!isValidDateStr('2026/07/29'), '斜杠格式应拒绝');
  assert(!isValidDateStr('2026-02-31'), '溢出日期 2026-02-31 应拒绝');
  assert(!isValidDateStr(''), '空串应拒绝');
  assert(!isValidDateStr(null), 'null 应拒绝');
  assert(!isValidDateStr('invalid'), '非日期应拒绝');
});

// ===== TBD 判定 =====
check('isUnscheduled: 无日期、tbd 状态、区间反向均判为未排期', () => {
  assert(isUnscheduled({ status: 'tbd' }), 'tbd 状态应未排期');
  assert(isUnscheduled({ start_date: '2026-01-01' }), '缺 end 应未排期');
  assert(isUnscheduled({ end_date: '2026-01-01' }), '缺 start 应未排期');
  assert(isUnscheduled({ start_date: '2026-05-10', end_date: '2026-05-01', status: 'planned' }), '区间反向应未排期');
  assert(!isUnscheduled({ start_date: '2026-05-01', end_date: '2026-05-10', status: 'planned' }), '完整日期+非tbd 应已排期');
});

// ===== 时间轴单元格数量：长区间无静默截断 =====
check('日视图连续 366 天：单元格数=366，首尾日期正确', () => {
  const cells = generateTimeline('2026-01-01', '2027-01-01', 'day', Date.UTC(2026, 6, 1));
  eq(cells.length, 366, '2026-01-01..2027-01-01 含 366 天');
  eq(cells[0].date, '2026-01-01', '首格日期');
  eq(cells[cells.length - 1].date, '2027-01-01', '尾格日期');
  // 单元格连续：相邻格开始时间差正好一天
  for (let i = 1; i < cells.length; i++) {
    const diff = cells[i].startMs - cells[i - 1].startMs;
    eq(diff, 24 * 3600 * 1000, `第 ${i} 格应比前一格晚一天`);
  }
});

check('周视图 260 周：单元格数=260，格间隔为 7 天', () => {
  // 从周一开始，步进 260*7 天减 1 天作为区间结束，确保正好 260 格
  const start = '2026-01-05'; // 周一
  const endMs = new Date(`${start}T00:00:00Z`).getTime() + (260 * 7 - 1) * 24 * 3600 * 1000;
  const end = new Date(endMs).toISOString().slice(0, 10);
  const cells = generateTimeline(start, end, 'week', Date.UTC(2026, 6, 1));
  eq(cells.length, 260, '应有 260 周');
  for (let i = 1; i < cells.length; i++) {
    const diff = cells[i].startMs - cells[i - 1].startMs;
    eq(diff, 7 * 24 * 3600 * 1000, `第 ${i} 周应比前一周晚 7 天`);
  }
});

check('月视图 120 月：单元格数=120，每格对齐月首', () => {
  const cells = generateTimeline('2026-01-01', '2035-12-31', 'month', Date.UTC(2026, 6, 1));
  eq(cells.length, 120, '2026-01..2035-12 共 120 个月');
  eq(cells[0].date, '2026-01-01', '首月');
  eq(cells[cells.length - 1].date, '2035-12-01', '末月');
  // 每格开始必须是某月 1 号
  for (const cell of cells) {
    assert(cell.date.endsWith('-01'), `月格应对齐 1 号: ${cell.date}`);
  }
});

// ===== 条形按真实单元格边界落位 =====
check('日视图条形：起止落在正确日期格，不越界', () => {
  const cells = generateTimeline('2026-08-01', '2026-08-31', 'day', Date.UTC(2026, 7, 15));
  const steps = [{ id: 's1', name: 'A', start_date: '2026-08-05', end_date: '2026-08-10', status: 'planned' }];
  const bars = calculateBars(steps, cells);
  eq(bars.length, 1, '应产生 1 根条');
  eq(cells[bars[0].colStart].date, '2026-08-05', '起点格应为 08-05');
  eq(cells[bars[0].colEnd].date, '2026-08-10', '终点格应为 08-10');
  assert(bars[0].colStart >= 0 && bars[0].colEnd < cells.length, '列索引应在范围内');
});

check('月视图条形：长跨度步骤落在正确月份格（不再用 /30 漂移）', () => {
  const cells = generateTimeline('2026-01-01', '2035-12-31', 'month', Date.UTC(2026, 6, 1));
  // 跨越多年的步骤：2028-03-15 到 2030-09-20
  const steps = [{ id: 's1', name: 'Long', start_date: '2028-03-15', end_date: '2030-09-20', status: 'planned' }];
  const bars = calculateBars(steps, cells);
  eq(bars.length, 1, '应产生 1 根条');
  eq(cells[bars[0].colStart].date, '2028-03-01', '起点应落在 2028-03 月格');
  eq(cells[bars[0].colEnd].date, '2030-09-01', '终点应落在 2030-09 月格');
});

check('周视图条形：终点不超过时间轴最后一格', () => {
  const cells = generateTimeline('2026-01-05', '2026-03-30', 'week', Date.UTC(2026, 0, 20));
  const steps = [{ id: 's1', name: 'W', start_date: '2026-01-10', end_date: '2026-12-31', status: 'planned' }];
  const bars = calculateBars(steps, cells);
  eq(bars.length, 1, '部分重叠应产生 1 根条');
  assert(bars[0].colEnd <= cells.length - 1, '终点列不得越过最后一格');
  assert(bars[0].colEnd >= bars[0].colStart, '终点不得早于起点');
});

check('完全在时间轴范围外的步骤不产生条形', () => {
  const cells = generateTimeline('2026-08-01', '2026-08-31', 'day', Date.UTC(2026, 7, 15));
  const steps = [
    { id: 's1', name: '过去', start_date: '2026-06-01', end_date: '2026-06-10', status: 'planned' },
    { id: 's2', name: '未来', start_date: '2026-10-01', end_date: '2026-10-10', status: 'planned' },
  ];
  const bars = calculateBars(steps, cells);
  eq(bars.length, 0, '范围外步骤不应绘制');
});

check('TBD 步骤不进入条形计算', () => {
  const cells = generateTimeline('2026-08-01', '2026-08-31', 'day', Date.UTC(2026, 7, 15));
  const steps = [
    { id: 's1', name: '有日期', start_date: '2026-08-05', end_date: '2026-08-10', status: 'planned' },
    { id: 's2', name: 'TBD', status: 'tbd' },
    { id: 's3', name: '缺日期', start_date: '2026-08-05', status: 'planned' },
  ];
  const bars = calculateBars(steps, cells);
  eq(bars.length, 1, '只有完整日期且非 tbd 的步骤产生条形');
  eq(bars[0].stepId, 's1', '应为 s1');
});

check('甘特条保留依赖字段，且不改变真实日期落位', () => {
  const cells = generateTimeline('2026-08-01', '2026-08-10', 'day', Date.UTC(2026, 7, 1));
  const bars = calculateBars([{
    id: 'dep-1', name: '受阻步骤', start_date: '2026-08-03', end_date: '2026-08-05', status: 'blocked',
    dependency_type: 'business_gate', dependency_detail: '业务字段范围确认', blocked_impact: '阻塞监控配置',
  }], cells);
  eq(bars.length, 1, '有依赖的已排期步骤仍只产生一根真实日期条');
  eq(cells[bars[0].colStart].date, '2026-08-03', '依赖说明不得移动开始日期');
  eq(cells[bars[0].colEnd].date, '2026-08-05', '依赖说明不得延长结束日期');
  eq(bars[0].dependencyType, 'business_gate', '保留依赖类型');
  eq(bars[0].dependencyDetail, '业务字段范围确认', '保留前置说明');
  eq(bars[0].blockedImpact, '阻塞监控配置', '保留阻塞影响');
});

check('周视图保留格内日期位置：同周但前后分离的步骤不再误画为重叠', () => {
  const cells = generateTimeline('2026-08-03', '2026-08-09', 'week', Date.UTC(2026, 7, 1));
  const bars = calculateBars([
    { id: 'early', name: '早期步骤', start_date: '2026-08-03', end_date: '2026-08-03', status: 'planned' },
    { id: 'later', name: '后续步骤', start_date: '2026-08-06', end_date: '2026-08-06', status: 'planned' },
  ], cells);
  eq(bars[0].colStart, bars[1].colStart, '两项都在同一周格');
  assert(bars[0].endOffset < bars[1].startOffset, '真实日期间隔应保留为格内空隙');
  eq(bars[0].startOffset, 0, '周一从格首开始');
  assert(bars[1].startOffset > 0.4 && bars[1].startOffset < 0.5, '周四应位于周格中后段');
});

// ===== 未排期分组 =====
check('collectUnscheduled 按项目分组，仅含未排期步骤', () => {
  const projects = [
    { id: 'p1', title: 'Alpha', owner: 'Amy', stage: 'Build' },
    { id: 'p2', title: 'Beta', owner: 'Ben', stage: 'Plan' },
  ];
  const steps = [
    { id: 's1', project_id: 'p1', name: '已排期', start_date: '2026-08-01', end_date: '2026-08-05', status: 'planned' },
    { id: 's2', project_id: 'p1', name: 'TBD-1', status: 'tbd' },
    { id: 's3', project_id: 'p1', name: 'TBD-2', status: 'tbd' },
    { id: 's4', project_id: 'p2', name: 'TBD-3', status: 'tbd' },
  ];
  const groups = collectUnscheduled(projects, steps);
  eq(groups.length, 2, '两个项目各有未排期步骤');
  const alpha = groups.find(g => g.project.id === 'p1');
  eq(alpha.steps.length, 2, 'Alpha 有 2 个 TBD');
  eq(alpha.project.owner, 'Amy', '分组保留 Owner');
  eq(alpha.project.stage, 'Build', '分组保留 Stage');
});

// ===== TBD → Plan → TBD 迁移 =====
check('TBD→Plan→TBD：补齐日期后进入日期轴，清空后回到未排期', () => {
  const projects = [{ id: 'p1', title: 'Alpha', owner: 'Amy', stage: 'Build' }];
  const cells = generateTimeline('2026-08-01', '2026-08-31', 'day', Date.UTC(2026, 7, 15));

  // 初始 TBD
  let step = { id: 's1', project_id: 'p1', name: 'WP', status: 'tbd' };
  let bars = calculateBars([step], cells);
  let groups = collectUnscheduled(projects, [step]);
  eq(bars.length, 0, 'TBD 时不出现在日期轴');
  eq(groups.length, 1, 'TBD 时出现在未排期区');

  // 补齐日期并转为 planned
  step = { ...step, start_date: '2026-08-05', end_date: '2026-08-12', status: 'planned' };
  bars = calculateBars([step], cells);
  groups = collectUnscheduled(projects, [step]);
  eq(bars.length, 1, '补齐后进入日期轴');
  eq(groups.length, 0, '补齐后离开未排期区');
  eq(cells[bars[0].colStart].date, '2026-08-05', '条形落在 08-05');

  // 清空开始日期（改回 TBD 语义）
  step = { ...step, start_date: undefined, status: 'tbd' };
  bars = calculateBars([step], cells);
  groups = collectUnscheduled(projects, [step]);
  eq(bars.length, 0, '清空日期后离开日期轴');
  eq(groups.length, 1, '清空日期后回到未排期区');
});

// ===== 汇总 =====
console.log(`\n📊 单元测试结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  console.log('\n❌ 失败项:');
  failures.forEach(f => console.log(`   - ${f}`));
  process.exit(1);
}
process.exit(0);
