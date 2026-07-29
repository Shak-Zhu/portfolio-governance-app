#!/usr/bin/env node
/**
 * WP-002A Smoke Test - 完整功能测试
 * 运行方式: API_URL=http://localhost:8787/api node scripts/smoke-test.js
 */

const API_BASE = process.env.API_URL || 'http://localhost:8787/api';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function api(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data, ok: res.ok };
}

async function test(name, fn) {
  try {
    const result = await fn();
    console.log(`✅ ${name}`);
    return { passed: true, result };
  } catch (e) {
    console.error(`❌ ${name}: ${e.message}`);
    return { passed: false, error: e.message };
  }
}

async function runTests() {
  console.log('🚀 开始 Smoke Test...\n');
  let passed = 0;
  let failed = 0;
  const results = [];

  // 1. 健康检查
  let r = await test('1. 健康检查', async () => {
    const { status, data } = await api('/health');
    if (status !== 200 || data.status !== 'ok') throw new Error(`状态: ${status}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '健康检查', passed: r.passed });

  // 2. 创建组合
  let portfolioId;
  r = await test('2. 创建组合', async () => {
    const { status, data } = await api('/portfolios', {
      method: 'POST',
      body: { name: 'Test Portfolio', description: 'Smoke Test', actor: 'smoke-test' }
    });
    if (status !== 201) throw new Error(`创建失败: ${status}`);
    portfolioId = data.id;
    if (!portfolioId) throw new Error('无返回 ID');
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '创建组合', passed: r.passed });

  if (!portfolioId) {
    console.log('\n⏭️  跳过后续测试（无法创建组合）');
    return { passed, failed, results };
  }

  // 3. 创建 Stage
  let stageId;
  r = await test('3. 创建 Stage', async () => {
    const { status, data } = await api(`/portfolios/${portfolioId}/stages`, {
      method: 'POST',
      body: { name: 'Test Stage', actor: 'smoke-test' }
    });
    if (status !== 201) throw new Error(`创建失败: ${status}`);
    stageId = data.id;
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '创建 Stage', passed: r.passed });

  // 4. 创建顶级项目
  let projectId;
  r = await test('4. 创建顶级项目', async () => {
    const { status, data } = await api(`/portfolios/${portfolioId}/projects`, {
      method: 'POST',
      body: {
        title: 'Test Parent Project',
        owner: 'Test Owner',
        stage: 'Test Stage',
        health: 'green',
        expectation: 'Test expectation',
        actor: 'smoke-test'
      }
    });
    if (status !== 201) throw new Error(`创建失败: ${status}`);
    projectId = data.id;
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '创建顶级项目', passed: r.passed });

  if (!projectId) {
    console.log('\n⏭️  跳过后续测试（无法创建项目）');
    return { passed, failed, results };
  }

  // 4.1 Stage 删除保护 - 活动项目引用时拒绝
  r = await test('4.1 Stage 删除保护 - 活动项目引用时拒绝', async () => {
    const res = await api(`/stages/${stageId}`, { method: 'DELETE', body: { actor: 'smoke-test' } });
    if (res.status !== 400) throw new Error(`应为 400，实际: ${res.status}`);
    if (res.data.success !== false) throw new Error('应返回失败');
    if (!res.data.message.includes('使用')) throw new Error(`消息应包含"使用": ${res.data.message}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: 'Stage 删除保护 - 活动项目引用', passed: r.passed });

  // 5. 创建子项目
  let childProjectId;
  r = await test('5. 创建子项目', async () => {
    const { status, data } = await api(`/portfolios/${portfolioId}/projects`, {
      method: 'POST',
      body: {
        title: 'Test Child Project',
        owner: 'Test Owner',
        parent_id: projectId,
        actor: 'smoke-test'
      }
    });
    if (status !== 201) throw new Error(`创建失败: ${status}`);
    childProjectId = data.id;
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '创建子项目', passed: r.passed });

  // 6. 创建步骤
  let stepId;
  r = await test('6. 创建步骤（周视图）', async () => {
    const { status, data } = await api(`/projects/${projectId}/steps`, {
      method: 'POST',
      body: {
        name: 'Test Step Week',
        start_date: '2026-08-01',
        end_date: '2026-08-07',
        status: 'planned',
        actor: 'smoke-test'
      }
    });
    if (status !== 201) throw new Error(`创建失败: ${status}`);
    stepId = data.id;
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '创建步骤（周视图）', passed: r.passed });

  // 7. 创建步骤（日视图）
  r = await test('7. 创建步骤（日视图）', async () => {
    const { status, data } = await api(`/projects/${projectId}/steps`, {
      method: 'POST',
      body: {
        name: 'Test Step Day',
        start_date: '2026-08-03',
        end_date: '2026-08-05',
        status: 'done',
        actor: 'smoke-test'
      }
    });
    if (status !== 201) throw new Error(`创建失败: ${status}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '创建步骤（日视图）', passed: r.passed });

  // 8. 创建 TBD 步骤
  r = await test('8. 创建 TBD 步骤', async () => {
    const { status, data } = await api(`/projects/${projectId}/steps`, {
      method: 'POST',
      body: {
        name: 'Test TBD Step',
        actor: 'smoke-test'
      }
    });
    if (status !== 201) throw new Error(`创建失败: ${status}`);
    if (data.status !== 'tbd') throw new Error(`状态应为 tbd: ${data.status}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '创建 TBD 步骤', passed: r.passed });

  // 9. 获取甘特图数据 - 周视图
  r = await test('9. 甘特图 - 周视图', async () => {
    const { status, data } = await api(`/portfolios/${portfolioId}/gantt?start=2026-07-27&end=2026-09-30&scale=week`);
    if (status !== 200) throw new Error(`获取失败: ${status}`);
    if (!data.rows || !data.timeline) throw new Error('甘特图数据结构不完整');
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '甘特图 - 周视图', passed: r.passed });

  // 10. 获取甘特图数据 - 日视图
  r = await test('10. 甘特图 - 日视图', async () => {
    const { status, data } = await api(`/portfolios/${portfolioId}/gantt?start=2026-08-01&end=2026-08-10&scale=day`);
    if (status !== 200) throw new Error(`获取失败: ${status}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '甘特图 - 日视图', passed: r.passed });

  // 11. 获取甘特图数据 - 月视图
  r = await test('11. 甘特图 - 月视图', async () => {
    const { status, data } = await api(`/portfolios/${portfolioId}/gantt?start=2026-07-01&end=2026-12-31&scale=month`);
    if (status !== 200) throw new Error(`获取失败: ${status}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '甘特图 - 月视图', passed: r.passed });

  // 12. 归档阻断逻辑
  r = await test('12. 归档阻断 - 未完成子项目存在', async () => {
    const res = await api(`/projects/${projectId}/archive`, {
      method: 'POST',
      body: { actor: 'smoke-test' }
    });
    if (res.status === 200) throw new Error('未完成的子项目存在时不应允许归档');
    if (!res.data.message.includes('后代')) throw new Error(`错误消息不正确: ${res.data.message}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '归档阻断 - 未完成子项目存在', passed: r.passed });

  // 13. 完成子项目
  r = await test('13. 完成子项目', async () => {
    const { status } = await api(`/projects/${childProjectId}/complete`, {
      method: 'POST',
      body: { actor: 'smoke-test' }
    });
    if (status !== 200) throw new Error(`完成失败: ${status}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '完成子项目', passed: r.passed });

  // 14. 完成父项目
  r = await test('14. 完成父项目', async () => {
    const { status } = await api(`/projects/${projectId}/complete`, {
      method: 'POST',
      body: { actor: 'smoke-test' }
    });
    if (status !== 200) throw new Error(`完成失败: ${status}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '完成父项目', passed: r.passed });

  // 15. 归档放行
  r = await test('15. 归档放行 - 全部后代完成', async () => {
    const res = await api(`/projects/${projectId}/archive`, {
      method: 'POST',
      body: { actor: 'smoke-test' }
    });
    if (res.status !== 200 || !res.data.success) throw new Error(`归档失败: ${JSON.stringify(res.data)}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '归档放行', passed: r.passed });

  // 16. Stage 删除保护 - 已归档项目引用时仍拒绝
  r = await test('16. Stage 删除保护 - 已归档项目引用时拒绝', async () => {
    const res = await api(`/stages/${stageId}`, { method: 'DELETE', body: { actor: 'smoke-test' } });
    if (res.status !== 400) throw new Error(`应为 400，实际: ${res.status}`);
    if (res.data.success !== false) throw new Error('应返回失败');
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: 'Stage 删除保护 - 已归档项目引用', passed: r.passed });

  // 17. 审计事件记录
  r = await test('17. 审计事件记录', async () => {
    const { status, data } = await api(`/portfolios/${portfolioId}/audit?limit=20`);
    if (status !== 200) throw new Error(`获取失败: ${status}`);
    if (!data.events || data.events.length < 10) throw new Error(`审计事件不足: ${data.events?.length}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '审计事件记录', passed: r.passed });

  // 18. 创建关联资料 - 有效 URL
  let linkId1, linkId2, linkId3;
  r = await test('18. 创建关联资料 #1', async () => {
    const { status, data } = await api(`/projects/${childProjectId}/links`, {
      method: 'POST',
      body: { title: '项目文档', url: 'https://example.com/doc1', actor: 'smoke-test' }
    });
    if (status !== 201) throw new Error(`创建失败: ${status}`);
    linkId1 = data.id;
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '创建关联资料 #1', passed: r.passed });

  r = await test('19. 创建关联资料 #2', async () => {
    const { status, data } = await api(`/projects/${childProjectId}/links`, {
      method: 'POST',
      body: { title: '设计稿', url: 'http://example.com/design', actor: 'smoke-test' }
    });
    if (status !== 201) throw new Error(`创建失败: ${status}`);
    linkId2 = data.id;
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '创建关联资料 #2', passed: r.passed });

  r = await test('20. 创建关联资料 #3', async () => {
    const { status, data } = await api(`/projects/${childProjectId}/links`, {
      method: 'POST',
      body: { title: 'API 文档', url: 'https://example.com/api', actor: 'smoke-test' }
    });
    if (status !== 201) throw new Error(`创建失败: ${status}`);
    linkId3 = data.id;
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '创建关联资料 #3', passed: r.passed });

  // 21. 关联资料持久化验证
  r = await test('21. 关联资料持久化 - 刷新后仍在', async () => {
    const { status, data } = await api(`/projects/${childProjectId}/links`);
    if (status !== 200) throw new Error(`获取失败: ${status}`);
    if (data.length !== 3) throw new Error(`应有 3 条资料: ${data.length}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '关联资料持久化', passed: r.passed });

  // 22. 非法协议拒绝
  r = await test('22. 关联资料 URL 校验 - 非法协议拒绝', async () => {
    const res = await api(`/projects/${childProjectId}/links`, {
      method: 'POST',
      body: { title: '非法链接', url: 'ftp://example.com/file', actor: 'smoke-test' }
    });
    if (res.status !== 400) throw new Error(`应为 400，实际: ${res.status}`);
    if (!res.data.error.includes('http')) throw new Error(`应包含 http 提示: ${res.data.error}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: 'URL 校验 - 非法协议拒绝', passed: r.passed });

  // 23. 修改关联资料
  r = await test('23. 修改关联资料', async () => {
    const { status } = await api(`/links/${linkId1}`, {
      method: 'PUT',
      body: { title: '更新后的项目文档', actor: 'smoke-test' }
    });
    if (status !== 200) throw new Error(`修改失败: ${status}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '修改关联资料', passed: r.passed });

  // 24. 删除关联资料
  r = await test('24. 删除关联资料', async () => {
    const { status } = await api(`/links/${linkId1}`, {
      method: 'DELETE',
      body: { actor: 'smoke-test' }
    });
    if (status !== 200) throw new Error(`删除失败: ${status}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '删除关联资料', passed: r.passed });

  // 25. 关联资料审计
  r = await test('25. 关联资料审计记录', async () => {
    const { status, data } = await api(`/audit/project_link/${linkId2}`);
    if (status !== 200) throw new Error(`获取失败: ${status}`);
    if (data.length < 1) throw new Error('应有审计记录');
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '关联资料审计记录', passed: r.passed });

  // 26. 更新步骤（改日期）
  r = await test('26. 更新步骤 - 改日期', async () => {
    const { status } = await api(`/steps/${stepId}`, {
      method: 'PUT',
      body: { start_date: '2026-08-15', end_date: '2026-08-21', actor: 'smoke-test' }
    });
    if (status !== 200) throw new Error(`更新失败: ${status}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '更新步骤 - 改日期', passed: r.passed });

  // 27. 删除步骤
  r = await test('27. 删除步骤', async () => {
    const { status } = await api(`/steps/${stepId}`, {
      method: 'DELETE',
      body: { actor: 'smoke-test' }
    });
    if (status !== 200) throw new Error(`删除失败: ${status}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: '删除步骤', passed: r.passed });

  // 清理测试数据
  console.log('\n🧹 清理测试数据...');
  await api(`/portfolios/${portfolioId}`, { method: 'DELETE', body: { actor: 'smoke-test' } });

  console.log(`\n📊 测试结果: ${passed}/${passed + failed} 通过`);
  
  // 打印失败项
  const failedTests = results.filter(r => !r.passed);
  if (failedTests.length > 0) {
    console.log('\n❌ 失败项:');
    failedTests.forEach(t => console.log(`   - ${t.name}`));
  }
  
  return { passed, failed, results };
}

runTests().then(({ passed, failed }) => {
  process.exit(failed > 0 ? 1 : 0);
}).catch(e => {
  console.error('测试异常:', e);
  process.exit(1);
});
