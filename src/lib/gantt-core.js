// 甘特时间轴核心逻辑（纯 ESM JavaScript，可被 Worker 与 Node 单元测试直接导入）
//
// 设计要点（WP-005）：
// - 时间轴按真实日历单元格生成：日=逐日、周=逐周（对齐周一）、月=逐月（对齐月首）。
// - 甘特条位置严格按 timeline 单元格边界匹配，不再用总天数错误换算周/月上限。
// - 无合法开始/结束日期或状态为 tbd 的步骤，不进入日期轴，交由未排期区域展示。

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * 校验 YYYY-MM-DD 日期字符串是否合法。
 * @param {string | undefined | null} dateStr
 * @returns {boolean}
 */
export function isValidDateStr(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d.getTime())) return false;
  // 防止 2026-02-31 之类的溢出日期
  return d.toISOString().slice(0, 10) === dateStr;
}

/**
 * 判断步骤是否为未排期（TBD）：缺少合法日期，或状态为 tbd。
 * @param {{start_date?: string, end_date?: string, status?: string}} step
 * @returns {boolean}
 */
export function isUnscheduled(step) {
  if (!step) return true;
  if (step.status === 'tbd') return true;
  if (!isValidDateStr(step.start_date) || !isValidDateStr(step.end_date)) return true;
  // 结束早于开始视为无效日期区间 -> 未排期
  if (utcMs(step.end_date) < utcMs(step.start_date)) return true;
  return false;
}

function utcMs(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getTime();
}

function toUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
}

function mondayOf(date) {
  const d = toUtc(date);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // 回退到本周周一
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

/**
 * 生成时间轴单元格。每个单元格带有：
 *  - label / date（显示用）
 *  - startMs / endMs（该格覆盖的真实日期区间，闭区间，用于条形落位）
 *  - isWeekend / isCurrent（样式）
 *
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate YYYY-MM-DD
 * @param {'day'|'week'|'month'} scale
 * @param {number} [nowMs] 可注入的“今天”时间戳（测试用）
 * @returns {Array<{label:string,date:string,startMs:number,endMs:number,isWeekend:boolean,isCurrent:boolean}>}
 */
export function generateTimeline(startDate, endDate, scale, nowMs = Date.now()) {
  const cells = [];
  if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) return cells;

  const rangeEndMs = utcMs(endDate);
  const today = new Date(nowMs);
  const todayUtcMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  if (scale === 'day') {
    let cursor = toUtc(new Date(`${startDate}T00:00:00Z`));
    while (cursor.getTime() <= rangeEndMs) {
      const cellStartMs = cursor.getTime();
      const cellEndMs = cellStartMs + MS_PER_DAY - 1;
      const dow = cursor.getUTCDay();
      cells.push({
        label: `${cursor.getUTCMonth() + 1}/${cursor.getUTCDate()}`,
        date: cursor.toISOString().slice(0, 10),
        startMs: cellStartMs,
        endMs: cellEndMs,
        isWeekend: dow === 0 || dow === 6,
        isCurrent: cellStartMs === todayUtcMs,
      });
      cursor = new Date(cellStartMs + MS_PER_DAY);
    }
    return cells;
  }

  if (scale === 'week') {
    let cursor = mondayOf(new Date(`${startDate}T00:00:00Z`));
    while (cursor.getTime() <= rangeEndMs) {
      const cellStartMs = cursor.getTime();
      const cellEndMs = cellStartMs + 7 * MS_PER_DAY - 1;
      const weekEnd = new Date(cellStartMs + 6 * MS_PER_DAY);
      cells.push({
        label: `W${isoWeekNumber(cursor)}`,
        date: cursor.toISOString().slice(0, 10),
        rangeLabel: `${cursor.getUTCMonth() + 1}/${cursor.getUTCDate()}–${weekEnd.getUTCMonth() + 1}/${weekEnd.getUTCDate()}`,
        startMs: cellStartMs,
        endMs: cellEndMs,
        isWeekend: false,
        isCurrent: todayUtcMs >= cellStartMs && todayUtcMs <= cellEndMs,
      });
      cursor = new Date(cellStartMs + 7 * MS_PER_DAY);
    }
    return cells;
  }

  // month
  const startD = new Date(`${startDate}T00:00:00Z`);
  let year = startD.getUTCFullYear();
  let month = startD.getUTCMonth();
  let cellStart = Date.UTC(year, month, 1);
  while (cellStart <= rangeEndMs) {
    const nextStart = Date.UTC(year, month + 1, 1);
    const cellEndMs = nextStart - 1;
    cells.push({
      label: `${year}年${month + 1}月`,
      date: new Date(cellStart).toISOString().slice(0, 10),
      startMs: cellStart,
      endMs: cellEndMs,
      isWeekend: false,
      isCurrent: todayUtcMs >= cellStart && todayUtcMs <= cellEndMs,
    });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    cellStart = Date.UTC(year, month, 1);
  }
  return cells;
}

/**
 * 找到第一个结束时间 >= 目标时间的单元格索引（用于条形起点）。
 */
function findStartCell(cells, ms) {
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].endMs >= ms) return i;
  }
  return -1;
}

/**
 * 找到最后一个开始时间 <= 目标时间的单元格索引（用于条形终点）。
 */
function findEndCell(cells, ms) {
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i].startMs <= ms) return i;
  }
  return -1;
}

/**
 * 依据真实 timeline 单元格边界计算步骤条形。
 * 仅处理已排期步骤；未排期步骤请用 collectUnscheduled 单独处理。
 *
 * @param {Array} steps
 * @param {Array} cells generateTimeline 的返回值
 * @returns {Array<{stepId:string,stepName:string,status:string,startDate:string,endDate:string,colStart:number,colEnd:number,startOffset:number,endOffset:number,dependencyType:string,dependencyDetail:string,blockedImpact:string}>}
 */
export function calculateBars(steps, cells) {
  const bars = [];
  if (!cells || cells.length === 0) return bars;

  const timelineStartMs = cells[0].startMs;
  const timelineEndMs = cells[cells.length - 1].endMs;

  for (const step of steps) {
    if (isUnscheduled(step)) continue;

    const stepStartMs = utcMs(step.start_date);
    const stepEndMs = utcMs(step.end_date);

    // 完全落在时间轴之外则不绘制
    if (stepEndMs < timelineStartMs || stepStartMs > timelineEndMs) continue;

    let colStart = findStartCell(cells, stepStartMs);
    let colEnd = findEndCell(cells, stepEndMs);

    // 边界裁剪：部分重叠时夹到时间轴范围内
    if (colStart === -1) colStart = 0;
    if (colEnd === -1) colEnd = cells.length - 1;
    if (colEnd < colStart) colEnd = colStart;

    // 周/月视图虽然以时间格聚合，但条形本身仍需保留格内的真实日期位置。
    // 否则同一周/月内前后相隔几天的两个步骤会被误画为完全重叠。
    const startCell = cells[colStart];
    const endCell = cells[colEnd];
    const startDuration = startCell.endMs - startCell.startMs + 1;
    const endDuration = endCell.endMs - endCell.startMs + 1;
    const visibleStartMs = Math.max(stepStartMs, startCell.startMs);
    const visibleEndExclusiveMs = Math.min(stepEndMs + MS_PER_DAY, endCell.endMs + 1);
    const startOffset = Math.max(0, Math.min(1, (visibleStartMs - startCell.startMs) / startDuration));
    const endOffset = Math.max(0, Math.min(1, (visibleEndExclusiveMs - endCell.startMs) / endDuration));

    bars.push({
      stepId: step.id,
      stepName: step.name,
      status: step.status,
      startDate: step.start_date,
      endDate: step.end_date,
      dependencyType: step.dependency_type || 'none',
      dependencyDetail: step.dependency_detail || '',
      blockedImpact: step.blocked_impact || '',
      colStart,
      colEnd,
      startOffset,
      endOffset,
    });
  }

  return bars;
}

/**
 * 收集未排期（TBD）步骤，按项目分组。
 *
 * @param {Array} projects
 * @param {Array} steps
 * @returns {Array<{project:Object, steps:Array}>}
 */
export function collectUnscheduled(projects, steps) {
  const projectById = new Map(projects.map(p => [p.id, p]));
  const groups = new Map();

  for (const step of steps) {
    if (!isUnscheduled(step)) continue;
    const project = projectById.get(step.project_id);
    if (!project) continue; // 步骤所属项目不在当前（未归档）列表中则跳过
    if (!groups.has(project.id)) {
      groups.set(project.id, { project, steps: [] });
    }
    groups.get(project.id).steps.push(step);
  }

  // 按项目在 projects 中的顺序输出，保证展示稳定
  const ordered = [];
  for (const project of projects) {
    if (groups.has(project.id)) ordered.push(groups.get(project.id));
  }
  return ordered;
}
