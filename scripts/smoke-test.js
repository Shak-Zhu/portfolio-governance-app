#!/usr/bin/env node
/**
 * Shak 项目组合治理系统 Smoke Test（WP-002A + WP-005）
 * 覆盖：组合/项目/步骤/关联资料/Stage/归档/审计，以及
 * WP-005 的 TBD 未排期分组、TBD→Plan→TBD 迁移、日/周/月长区间时间轴可靠性。
 * 运行方式: API_URL=http://127.0.0.1:8789/api node scripts/smoke-test.js
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

  // ===== WP-005：TBD 未排期工作包与时间轴可靠性 =====

  // 28. 创建专用项目 + 两个 TBD 步骤
  let tbdProjectId, tbdStepId;
  r = await test('28. WP-005 创建 TBD 场景项目与两个未排期步骤', async () => {
    const p = await api(`/portfolios/${portfolioId}/projects`, {
      method: 'POST',
      body: { title: 'TBD 场景项目', owner: 'PM', stage: 'Test Stage', health: 'blue', actor: 'smoke-test' }
    });
    if (p.status !== 201) throw new Error(`项目创建失败: ${p.status}`);
    tbdProjectId = p.data.id;

    const s1 = await api(`/projects/${tbdProjectId}/steps`, {
      method: 'POST', body: { name: 'TBD 工作包 A', actor: 'smoke-test' }
    });
    if (s1.status !== 201 || s1.data.status !== 'tbd') throw new Error('TBD A 应为 tbd 状态');
    tbdStepId = s1.data.id;

    const s2 = await api(`/projects/${tbdProjectId}/steps`, {
      method: 'POST', body: { name: 'TBD 工作包 B', actor: 'smoke-test' }
    });
    if (s2.status !== 201 || s2.data.status !== 'tbd') throw new Error('TBD B 应为 tbd 状态');
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: 'WP-005 创建 TBD 场景', passed: r.passed });

  // 29. TBD 步骤出现在 unscheduled 分组，且不在任何日期轴条形中
  r = await test('29. WP-005 TBD 步骤进入未排期分组，不进日期轴', async () => {
    const { status, data } = await api(`/portfolios/${portfolioId}/gantt?start=2026-08-01&end=2026-08-31&scale=day`);
    if (status !== 200) throw new Error(`甘特获取失败: ${status}`);
    if (!Array.isArray(data.unscheduled)) throw new Error('缺少 unscheduled 字段');
    const group = data.unscheduled.find(g => g.project.id === tbdProjectId);
    if (!group) throw new Error('未排期分组应含 TBD 项目');
    if (group.steps.length !== 2) throw new Error(`该项目应有 2 个未排期步骤，实际 ${group.steps.length}`);
    if (group.project.owner !== 'PM' || group.project.stage !== 'Test Stage') {
      throw new Error('未排期分组应保留 Owner 和 Stage');
    }
    // 该项目在日期轴行内不得出现任何条形
    const row = data.rows.find(x => x.project.id === tbdProjectId);
    if (row && row.bars.length !== 0) throw new Error('TBD 项目不应有日期轴条形');
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: 'WP-005 TBD 分组隔离', passed: r.passed });

  // 30. TBD → Plan：补齐日期并改状态后进入日期轴，离开未排期区
  r = await test('30. WP-005 TBD→Plan 后进入日期轴', async () => {
    const upd = await api(`/steps/${tbdStepId}`, {
      method: 'PUT',
      body: { start_date: '2026-08-05', end_date: '2026-08-12', status: 'planned', actor: 'smoke-test' }
    });
    if (upd.status !== 200) throw new Error(`更新失败: ${upd.status}`);

    const { data } = await api(`/portfolios/${portfolioId}/gantt?start=2026-08-01&end=2026-08-31&scale=day`);
    const group = data.unscheduled.find(g => g.project.id === tbdProjectId);
    // A 已排期，B 仍是 TBD -> 组内应剩 1 个
    if (!group || group.steps.length !== 1) throw new Error(`未排期应剩 1 个，实际 ${group ? group.steps.length : 0}`);
    const row = data.rows.find(x => x.project.id === tbdProjectId);
    if (!row || row.bars.length !== 1) throw new Error('应产生 1 根条形');
    // 条形应落在 08-05 格
    const cell = data.timeline[row.bars[0].colStart];
    if (cell.date !== '2026-08-05') throw new Error(`条形起点应为 08-05，实际 ${cell.date}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: 'WP-005 TBD→Plan 落位', passed: r.passed });

  // 31. Plan → TBD：清空日期后回到未排期区，离开日期轴
  r = await test('31. WP-005 Plan→TBD 后回到未排期区', async () => {
    const upd = await api(`/steps/${tbdStepId}`, {
      method: 'PUT',
      body: { start_date: '', end_date: '', actor: 'smoke-test' }
    });
    if (upd.status !== 200) throw new Error(`更新失败: ${upd.status}`);
    if (upd.data.status !== 'tbd') throw new Error(`清空日期后状态应回到 tbd，实际 ${upd.data.status}`);

    const { data } = await api(`/portfolios/${portfolioId}/gantt?start=2026-08-01&end=2026-08-31&scale=day`);
    const group = data.unscheduled.find(g => g.project.id === tbdProjectId);
    if (!group || group.steps.length !== 2) throw new Error(`清空后未排期应恢复 2 个，实际 ${group ? group.steps.length : 0}`);
    const row = data.rows.find(x => x.project.id === tbdProjectId);
    if (row && row.bars.length !== 0) throw new Error('清空日期后不应有条形');
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: 'WP-005 Plan→TBD 回退', passed: r.passed });

  // 32. 日视图 366 天：timeline 连续无截断
  r = await test('32. WP-005 日视图 366 天连续无截断', async () => {
    const { status, data } = await api(`/portfolios/${portfolioId}/gantt?start=2026-01-01&end=2027-01-01&scale=day`);
    if (status !== 200) throw new Error(`获取失败: ${status}`);
    if (data.timeline.length !== 366) throw new Error(`应有 366 天，实际 ${data.timeline.length}`);
    if (data.timeline[0].date !== '2026-01-01') throw new Error('首格错误');
    if (data.timeline[365].date !== '2027-01-01') throw new Error('尾格错误');
    if (data.config.cellCount !== 366) throw new Error('cellCount 不一致');
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: 'WP-005 日视图 366 天', passed: r.passed });

  // 33. 周视图 260 周
  r = await test('33. WP-005 周视图 260 周连续无截断', async () => {
    const startMs = new Date('2026-01-05T00:00:00Z').getTime();
    const endMs = startMs + (260 * 7 - 1) * 24 * 3600 * 1000;
    const end = new Date(endMs).toISOString().slice(0, 10);
    const { status, data } = await api(`/portfolios/${portfolioId}/gantt?start=2026-01-05&end=${end}&scale=week`);
    if (status !== 200) throw new Error(`获取失败: ${status}`);
    if (data.timeline.length !== 260) throw new Error(`应有 260 周，实际 ${data.timeline.length}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: 'WP-005 周视图 260 周', passed: r.passed });

  // 34. 月视图 120 月
  r = await test('34. WP-005 月视图 120 月连续无截断', async () => {
    const { status, data } = await api(`/portfolios/${portfolioId}/gantt?start=2026-01-01&end=2035-12-31&scale=month`);
    if (status !== 200) throw new Error(`获取失败: ${status}`);
    if (data.timeline.length !== 120) throw new Error(`应有 120 月，实际 ${data.timeline.length}`);
    if (data.timeline[0].date !== '2026-01-01') throw new Error('首月错误');
    if (data.timeline[119].date !== '2035-12-01') throw new Error('末月错误');
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: 'WP-005 月视图 120 月', passed: r.passed });

  // 35. 长跨度步骤按真实月格落位（不再 /30 漂移）
  r = await test('35. WP-005 长跨度步骤按真实月格落位', async () => {
    // 新建一个带长跨度步骤的项目
    const p = await api(`/portfolios/${portfolioId}/projects`, {
      method: 'POST', body: { title: '长跨度项目', owner: 'PM', actor: 'smoke-test' }
    });
    await api(`/projects/${p.data.id}/steps`, {
      method: 'POST',
      body: { name: '跨年步骤', start_date: '2028-03-15', end_date: '2030-09-20', status: 'planned', actor: 'smoke-test' }
    });
    const { data } = await api(`/portfolios/${portfolioId}/gantt?start=2026-01-01&end=2035-12-31&scale=month`);
    const row = data.rows.find(x => x.project.id === p.data.id);
    if (!row || row.bars.length !== 1) throw new Error('应有 1 根条形');
    const startCell = data.timeline[row.bars[0].colStart];
    const endCell = data.timeline[row.bars[0].colEnd];
    if (startCell.date !== '2028-03-01') throw new Error(`起点应落在 2028-03，实际 ${startCell.date}`);
    if (endCell.date !== '2030-09-01') throw new Error(`终点应落在 2030-09，实际 ${endCell.date}`);
  });
  if (r.passed) passed++; else failed++;
  results.push({ name: 'WP-005 长跨度月格落位', passed: r.passed });

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
