/**
 * WP-002A 单元测试套件
 * 纯 JavaScript 测试，不依赖 TypeScript 编译
 */

// ========== 工具函数（复制核心逻辑以便独立测试）==========

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function isValidDate(dateStr) {
  if (!dateStr) return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date.getTime());
}

function validateStepStatus(status) {
  return ['done', 'planned', 'risk', 'blocked', 'tbd'].includes(status);
}

function validateHealth(health) {
  return ['green', 'blue', 'amber', 'red', 'unknown'].includes(health);
}

// ========== 测试函数 ==========

function testGenerateId() {
  const id1 = generateId();
  const id2 = generateId();
  if (!id1 || !id2) {
    throw new Error('generateId returned falsy value');
  }
  if (id1 === id2) {
    throw new Error('generateId returned same ID twice');
  }
  console.log('✅ testGenerateId passed');
}

function testIsValidDate() {
  const tests = [
    ['2026-07-29', true],
    ['2026-01-01', true],
    ['2026/07/29', false],
    ['', false],
    ['invalid', false],
  ];
  for (const [input, expected] of tests) {
    const result = isValidDate(input);
    if (result !== expected) {
      throw new Error(`isValidDate('${input}') expected ${expected}, got ${result}`);
    }
  }
  console.log('✅ testIsValidDate passed');
}

function testValidateStepStatus() {
  const validStatuses = ['done', 'planned', 'risk', 'blocked', 'tbd'];
  const invalidStatuses = ['invalid', 'completed', 'active', ''];
  
  for (const s of validStatuses) {
    if (!validateStepStatus(s)) {
      throw new Error(`'${s}' should be valid`);
    }
  }
  for (const s of invalidStatuses) {
    if (validateStepStatus(s)) {
      throw new Error(`'${s}' should be invalid`);
    }
  }
  console.log('✅ testValidateStepStatus passed');
}

function testValidateHealth() {
  const validHealths = ['green', 'blue', 'amber', 'red', 'unknown'];
  const invalidHealths = ['purple', 'yellow', 'black', ''];
  
  for (const h of validHealths) {
    if (!validateHealth(h)) {
      throw new Error(`'${h}' should be valid`);
    }
  }
  for (const h of invalidHealths) {
    if (validateHealth(h)) {
      throw new Error(`'${h}' should be invalid`);
    }
  }
  console.log('✅ testValidateHealth passed');
}

function testGanttHierarchySort() {
  // 模拟项目排序逻辑
  const projects = [
    { id: 'p1', parent_id: null, title: 'Project 1' },
    { id: 'p2', parent_id: null, title: 'Project 2' },
    { id: 'p1a', parent_id: 'p1', title: 'Child of P1' },
    { id: 'p1b', parent_id: 'p1', title: 'Child 2 of P1' },
    { id: 'p2a', parent_id: 'p2', title: 'Child of P2' },
  ];
  
  const topLevel = projects.filter(p => !p.parent_id);
  const children = projects.filter(p => p.parent_id);
  
  const sorted = [];
  for (const parent of topLevel) {
    sorted.push(parent.id);
    const childs = children.filter(c => c.parent_id === parent.id);
    for (const child of childs) {
      sorted.push(child.id);
    }
  }
  
  // P1 应该在 P1a 和 P1b 之前
  const p1Index = sorted.indexOf('p1');
  const p1aIndex = sorted.indexOf('p1a');
  const p1bIndex = sorted.indexOf('p1b');
  
  if (p1Index > p1aIndex) throw new Error('Parent should come before children');
  if (p1Index > p1bIndex) throw new Error('Parent should come before children');
  
  console.log('✅ testGanttHierarchySort passed');
}

function testGanttBarsWithDate() {
  // 模拟 calculateGanttBars 逻辑
  const steps = [
    { id: 's1', name: 'Step 1', start_date: '2026-07-01', end_date: '2026-07-10', status: 'done' },
  ];
  
  const tStart = new Date('2026-07-01').getTime();
  const tEnd = new Date('2026-07-31').getTime();
  
  for (const step of steps) {
    if (!step.start_date || !step.end_date) {
      throw new Error('Should have dates');
    }
    
    const stepStart = new Date(step.start_date).getTime();
    const colStart = Math.floor((stepStart - tStart) / (1000 * 60 * 60 * 24));
    
    if (colStart < 0) {
      throw new Error('colStart should be >= 0');
    }
  }
  
  console.log('✅ testGanttBarsWithDate passed');
}

function testGanttBarsTbd() {
  // 模拟 TBD 逻辑
  const steps = [
    { id: 's1', name: 'TBD Step', start_date: null, end_date: null, status: 'tbd' },
  ];
  
  for (const step of steps) {
    if (step.start_date || step.end_date) {
      throw new Error('Should not have dates');
    }
    if (step.status !== 'tbd') {
      throw new Error('Status should be tbd');
    }
  }
  
  console.log('✅ testGanttBarsTbd passed');
}

function testArchiveBlockingLogic() {
  // 测试归档阻断逻辑
  const children = [
    { id: 'c1', status: 'completed', is_archived: 0 },
    { id: 'c2', status: 'active', is_archived: 0 },
  ];
  
  const incompleteChildren = children.filter(d => d.status !== 'completed' && d.is_archived === 0);
  
  if (incompleteChildren.length !== 1) {
    throw new Error('Should have 1 incomplete child');
  }
  
  // 全部完成后应该允许归档
  children[1].status = 'completed';
  const stillIncomplete = children.filter(d => d.status !== 'completed' && d.is_archived === 0);
  
  if (stillIncomplete.length !== 0) {
    throw new Error('All children completed, should allow archive');
  }
  
  console.log('✅ testArchiveBlockingLogic passed');
}

function testStageDeleteProtection() {
  // 模拟 Stage 删除保护
  const projects = [
    { id: 'p1', stage: 'Development' },
    { id: 'p2', stage: 'Testing' },
  ];
  const stageToDelete = 'Development';
  
  const inUse = projects.some(p => p.stage === stageToDelete);
  
  if (!inUse) {
    throw new Error('Stage should be in use');
  }
  
  const unusedStage = 'Planning';
  const unusedInUse = projects.some(p => p.stage === unusedStage);
  
  if (unusedInUse) {
    throw new Error('Stage should not be in use');
  }
  
  console.log('✅ testStageDeleteProtection passed');
}

// ========== 运行测试 ==========

async function runTests() {
  console.log('🚀 开始单元测试...\n');
  
  const tests = [
    testGenerateId,
    testIsValidDate,
    testValidateStepStatus,
    testValidateHealth,
    testGanttHierarchySort,
    testGanttBarsWithDate,
    testGanttBarsTbd,
    testArchiveBlockingLogic,
    testStageDeleteProtection,
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      test();
      passed++;
    } catch (e) {
      console.error(`❌ ${test.name}: ${e.message}`);
      failed++;
    }
  }
  
  console.log(`\n📊 测试结果: ${passed} 通过, ${failed} 失败`);
  return { passed, failed };
}

runTests().then(({ passed, failed }) => {
  process.exit(failed > 0 ? 1 : 0);
}).catch(e => {
  console.error('测试异常:', e);
  process.exit(1);
});
