// 甘特图生成器
import type { Project, Step, GanttRow } from '../types';

export interface GanttBar {
  stepId: string;
  stepName: string;
  status: string;
  startDate?: string;
  endDate?: string;
  colStart: number;
  colEnd: number;
  isTbd: boolean;
}

export interface TimelineCell {
  label: string;
  date: string;
  isWeekend: boolean;
  isCurrent: boolean;
}

export interface GanttData {
  rows: GanttRow[];
  timeline: TimelineCell[];
  config: {
    start: string;
    end: string;
    scale: 'day' | 'week' | 'month';
    daysCount: number;
  };
}

export function buildGanttData(
  projects: Project[],
  steps: Step[],
  startDate: string,
  endDate: string,
  scale: 'day' | 'week' | 'month' = 'week'
): GanttData {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // 生成时间轴单元格
  const timeline = generateTimeline(start, end, scale);
  
  // 按层级排序项目
  const sortedProjects = sortProjectsByHierarchy(projects);
  
  // 构建甘特行
  const rows: GanttRow[] = sortedProjects.map(project => ({
    project,
    steps: steps.filter(s => s.project_id === project.id).sort((a, b) => a.sort_order - b.sort_order),
    level: getProjectLevel(project, projects),
  }));
  
  return {
    rows,
    timeline,
    config: {
      start: startDate,
      end: endDate,
      scale,
      daysCount: timeline.length,
    },
  };
}

function generateTimeline(
  start: Date,
  end: Date,
  scale: 'day' | 'week' | 'month'
): TimelineCell[] {
  const cells: TimelineCell[] = [];
  const current = new Date(start);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    const dayOfWeek = current.getDay();
    
    let label: string;
    let isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    let isCurrent = false;
    
    switch (scale) {
      case 'day':
        label = `${current.getMonth() + 1}/${current.getDate()}`;
        isCurrent = current.toDateString() === today.toDateString();
        break;
      case 'week': {
        const weekNum = getWeekNumber(current);
        label = `W${weekNum}`;
        // 周视图下标记周一
        isWeekend = dayOfWeek === 0;
        isCurrent = current.toDateString() === today.toDateString();
        break;
      }
      case 'month':
        label = `${current.getMonth() + 1}月`;
        isWeekend = false;
        isCurrent = current.getMonth() === today.getMonth() && current.getFullYear() === today.getFullYear();
        break;
    }
    
    cells.push({ label, date: dateStr, isWeekend, isCurrent });
    
    // 前进到下一个时间单位
    switch (scale) {
      case 'day':
        current.setDate(current.getDate() + 1);
        break;
      case 'week':
        // 跳过一周
        current.setDate(current.getDate() + 7);
        break;
      case 'month':
        current.setMonth(current.getMonth() + 1);
        break;
    }
  }
  
  return cells;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function sortProjectsByHierarchy(projects: Project[]): Project[] {
  // 顶级项目排在前面，子项目跟在父项目后面
  const topLevel = projects.filter(p => !p.parent_id);
  const children = projects.filter(p => p.parent_id);
  
  const sorted: Project[] = [];
  
  for (const parent of topLevel) {
    sorted.push(parent);
    // 递归添加子项目
    addChildren(parent.id, children, sorted);
  }
  
  return sorted;
}

function addChildren(parentId: string, allChildren: Project[], sorted: Project[]): void {
  const children = allChildren.filter(c => c.parent_id === parentId);
  for (const child of children) {
    sorted.push(child);
    addChildren(child.id, allChildren, sorted);
  }
}

function getProjectLevel(project: Project, allProjects: Project[]): number {
  let level = 0;
  let current = project;
  
  while (current.parent_id) {
    level++;
    current = allProjects.find(p => p.id === current.parent_id) || current;
    if (level > 10) break; // 防止循环
  }
  
  return level;
}

export function calculateGanttBars(
  steps: Step[],
  timelineStart: string,
  timelineEnd: string,
  scale: 'day' | 'week' | 'month'
): GanttBar[] {
  const bars: GanttBar[] = [];
  const tStart = new Date(timelineStart).getTime();
  const tEnd = new Date(timelineEnd).getTime();
  const totalDays = Math.ceil((tEnd - tStart) / (1000 * 60 * 60 * 24)) + 1;
  
  for (const step of steps) {
    if (!step.start_date || !step.end_date) {
      // 无日期步骤 - TBD
      bars.push({
        stepId: step.id,
        stepName: step.name,
        status: 'tbd',
        isTbd: true,
        colStart: 0,
        colEnd: 0,
      });
      continue;
    }
    
    const stepStart = new Date(step.start_date).getTime();
    const stepEnd = new Date(step.end_date).getTime();
    
    let colStart: number, colEnd: number;
    
    switch (scale) {
      case 'day':
        colStart = Math.floor((stepStart - tStart) / (1000 * 60 * 60 * 24));
        colEnd = Math.floor((stepEnd - tStart) / (1000 * 60 * 60 * 24));
        break;
      case 'week':
        // 按周计算
        colStart = Math.floor((stepStart - tStart) / (1000 * 60 * 60 * 24 * 7));
        colEnd = Math.floor((stepEnd - tStart) / (1000 * 60 * 60 * 24 * 7));
        break;
      case 'month':
        // 按月计算
        colStart = Math.floor((stepStart - tStart) / (1000 * 60 * 60 * 24 * 30));
        colEnd = Math.floor((stepEnd - tStart) / (1000 * 60 * 60 * 24 * 30));
        break;
    }
    
    // 确保在范围内
    colStart = Math.max(0, colStart);
    colEnd = Math.min(totalDays - 1, colEnd);
    
    bars.push({
      stepId: step.id,
      stepName: step.name,
      status: step.status,
      startDate: step.start_date,
      endDate: step.end_date,
      colStart,
      colEnd,
      isTbd: false,
    });
  }
  
  return bars;
}
