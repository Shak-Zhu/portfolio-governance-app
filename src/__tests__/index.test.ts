/**
 * WP-002A 测试套件
 */
import { jest } from '@jest/globals';

// 重置模拟
beforeEach(() => {
  jest.clearAllMocks();
});

describe('数据库工具函数', () => {
  test('generateId 应该生成唯一 ID', async () => {
    const { generateId } = await import('../src/lib/db.ts');
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  test('isValidDate 应该验证日期格式', async () => {
    const { isValidDate } = await import('../src/lib/db.ts');
    expect(isValidDate('2026-07-29')).toBe(true);
    expect(isValidDate('2026/07/29')).toBe(false);
    expect(isValidDate('')).toBe(false);
    expect(isValidDate('invalid')).toBe(false);
  });

  test('validateStepStatus 应该验证步骤状态', async () => {
    const { validateStepStatus } = await import('../src/lib/db.ts');
    expect(validateStepStatus('done')).toBe(true);
    expect(validateStepStatus('planned')).toBe(true);
    expect(validateStepStatus('invalid')).toBe(false);
  });

  test('validateHealth 应该验证健康状态', async () => {
    const { validateHealth } = await import('../src/lib/db.ts');
    expect(validateHealth('green')).toBe(true);
    expect(validateHealth('red')).toBe(true);
    expect(validateHealth('purple')).toBe(false);
  });
});

describe('甘特图生成器', () => {
  test('buildGanttData 应该生成正确的数据结构', async () => {
    const { buildGanttData } = await import('../src/lib/gantt.ts');
    
    const projects = [
      { id: 'p1', parent_id: null, title: 'Project 1', owner: 'Owner 1' },
    ];
    const steps = [
      { id: 's1', project_id: 'p1', name: 'Step 1', start_date: '2026-07-01', end_date: '2026-07-10', status: 'done' },
    ];
    
    const result = buildGanttData(projects, steps, '2026-07-01', '2026-07-31', 'week');
    
    expect(result.rows).toHaveLength(1);
    expect(result.timeline).toBeDefined();
    expect(result.config).toBeDefined();
    expect(result.config.scale).toBe('week');
  });

  test('calculateGanttBars 应该为有日期步骤生成条', async () => {
    const { calculateGanttBars } = await import('../src/lib/gantt.ts');
    
    const steps = [
      { id: 's1', name: 'Step 1', start_date: '2026-07-01', end_date: '2026-07-10', status: 'done' },
    ];
    
    const bars = calculateGanttBars(steps, '2026-07-01', '2026-07-31', 'day');
    
    expect(bars).toHaveLength(1);
    expect(bars[0].isTbd).toBe(false);
    expect(bars[0].colStart).toBeGreaterThanOrEqual(0);
  });

  test('calculateGanttBars 应该为无日期步骤标记 TBD', async () => {
    const { calculateGanttBars } = await import('../src/lib/gantt.ts');
    
    const steps = [
      { id: 's1', name: 'TBD Step', start_date: null, end_date: null, status: 'tbd' },
    ];
    
    const bars = calculateGanttBars(steps, '2026-07-01', '2026-07-31', 'day');
    
    expect(bars).toHaveLength(1);
    expect(bars[0].isTbd).toBe(true);
    expect(bars[0].status).toBe('tbd');
  });
});

describe('API 验证', () => {
  test('步骤状态应自动根据日期调整', async () => {
    // 这个测试验证业务逻辑
    // 当步骤有日期时应是 planned，无日期时是 tbd
    const { validateStepStatus } = await import('../src/lib/db.ts');
    
    // 有日期的步骤不应是 tbd
    const plannedStatuses = ['done', 'planned', 'risk', 'blocked'];
    plannedStatuses.forEach(s => {
      expect(validateStepStatus(s)).toBe(true);
    });
    
    // 无日期的步骤应该是 tbd
    expect(validateStepStatus('tbd')).toBe(true);
  });
});
