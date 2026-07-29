// 甘特图生成器（TypeScript 类型包装）
// 核心时间轴/条形计算逻辑在 ./gantt-core.js（纯 ESM），Worker 与单元测试共享同一实现。
import type { Project, Step, GanttRow } from '../types';
// @ts-expect-error - gantt-core.js 为纯 JS 模块，运行时由 esbuild 打包
import { generateTimeline, calculateBars, collectUnscheduled, isUnscheduled } from './gantt-core.js';

export interface GanttBar {
  stepId: string;
  stepName: string;
  status: string;
  startDate: string;
  endDate: string;
  colStart: number;
  colEnd: number;
}

export interface TimelineCell {
  label: string;
  date: string;
  rangeLabel?: string;
  startMs: number;
  endMs: number;
  isWeekend: boolean;
  isCurrent: boolean;
}

export interface UnscheduledGroup {
  project: Project;
  steps: Step[];
}

export interface GanttData {
  rows: (GanttRow & { bars: GanttBar[] })[];
  timeline: TimelineCell[];
  unscheduled: UnscheduledGroup[];
  config: {
    start: string;
    end: string;
    scale: 'day' | 'week' | 'month';
    cellCount: number;
  };
}

export function buildGanttData(
  projects: Project[],
  steps: Step[],
  startDate: string,
  endDate: string,
  scale: 'day' | 'week' | 'month' = 'week'
): GanttData {
  const timeline = generateTimeline(startDate, endDate, scale) as TimelineCell[];

  // 按层级排序项目（父项目在前，子项目紧随其后）
  const sortedProjects = sortProjectsByHierarchy(projects);

  const rows = sortedProjects.map(project => {
    const projectSteps = steps
      .filter(s => s.project_id === project.id)
      .sort((a, b) => a.sort_order - b.sort_order);
    return {
      project,
      steps: projectSteps,
      level: getProjectLevel(project, projects),
      bars: calculateBars(projectSteps, timeline) as GanttBar[],
    };
  });

  const unscheduled = collectUnscheduled(sortedProjects, steps) as UnscheduledGroup[];

  return {
    rows,
    timeline,
    unscheduled,
    config: {
      start: startDate,
      end: endDate,
      scale,
      cellCount: timeline.length,
    },
  };
}

function sortProjectsByHierarchy(projects: Project[]): Project[] {
  const topLevel = projects.filter(p => !p.parent_id);
  const children = projects.filter(p => p.parent_id);

  const sorted: Project[] = [];
  for (const parent of topLevel) {
    sorted.push(parent);
    addChildren(parent.id, children, sorted);
  }

  // 兜底：父项目缺失（孤儿子项目）也要出现，避免丢行
  for (const orphan of children) {
    if (!sorted.includes(orphan)) sorted.push(orphan);
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
    const parent = allProjects.find(p => p.id === current.parent_id);
    if (!parent) break;
    current = parent;
    if (level > 10) break; // 防止循环
  }

  return level;
}

export { isUnscheduled };
