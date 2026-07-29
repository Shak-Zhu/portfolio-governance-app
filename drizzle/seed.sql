-- Seed: 初始化样例数据
-- B2B Pain Point、CRM 总项目、Phase 0、Contract Extractor、Sales Monitoring、Sales Copilot

-- 初始化 portfolios
INSERT OR IGNORE INTO portfolios (id, name, description, created_at, updated_at) VALUES
('pf-001', 'B2B AI 转型组合', 'B2B 企业 AI 转型核心项目群', 1751232000000, 1751232000000);

-- 初始化 stages
INSERT OR IGNORE INTO stages (id, portfolio_id, name, sort_order, created_at) VALUES
('st-001', 'pf-001', 'Ideation', 1, 1751232000000),
('st-002', 'pf-001', 'Planning', 2, 1751232000000),
('st-003', 'pf-001', 'Development', 3, 1751232000000),
('st-004', 'pf-001', 'Testing', 4, 1751232000000),
('st-005', 'pf-001', 'Deployment', 5, 1751232000000),
('st-006', 'pf-001', 'Completed', 6, 1751232000000);

-- 初始化 projects (父子层级)
INSERT OR IGNORE INTO projects (id, portfolio_id, parent_id, title, owner, stage, health, expectation, risk, status, created_at, updated_at) VALUES
-- 顶级项目
('proj-001', 'pf-001', NULL, 'B2B Pain Point 分析', 'Shak', 'Completed', 'green', '识别核心业务痛点与 AI 改造机会', '', 'completed', 1751232000000, 1751318400000),
('proj-002', 'pf-001', NULL, 'CRM 系统集成', 'Shak', 'Development', 'blue', '完成 CRM 与 AI 系统对接', '依赖 Phase 0 完成', 'active', 1751232000000, 1751232000000),
-- 子项目
('proj-002a', 'pf-001', 'proj-002', 'Phase 0 - 基础设施准备', 'Dev Team A', 'Completed', 'green', '完成基础设施搭建', '', 'completed', 1751232000000, 1751923200000),
('proj-002b', 'pf-001', 'proj-002', 'Contract Extractor 开发', 'Dev Team B', 'Development', 'risk', '合同文档自动提取', '需要 Phase 0 完成', 'active', 1751923200000, 1751923200000),
('proj-002c', 'pf-001', 'proj-002', 'Sales Monitoring 开发', 'Dev Team C', 'Planning', 'risk', '销售数据实时监控', '等待资源分配', 'active', 1751923200000, 1751923200000),
('proj-002d', 'pf-001', 'proj-002', 'Sales Copilot 开发', 'Dev Team D', 'Ideation', 'unknown', 'AI 销售助手', '', 'active', 1752538800000, 1752538800000);

-- 初始化 steps (甘特条数据)
INSERT OR IGNORE INTO steps (id, project_id, name, start_date, end_date, status, sort_order, created_at, updated_at) VALUES
-- proj-001 的步骤
('step-001a', 'proj-001', '需求调研', '2026-06-01', '2026-06-15', 'done', 1, 1751232000000, 1751232000000),
('step-001b', 'proj-001', '痛点分析报告', '2026-06-16', '2026-06-30', 'done', 2, 1751232000000, 1751232000000),
-- proj-002a 的步骤
('step-002aa', 'proj-002a', '云资源申请', '2026-06-01', '2026-06-10', 'done', 1, 1751232000000, 1751232000000),
('step-002ab', 'proj-002a', '开发环境配置', '2026-06-11', '2026-06-25', 'done', 2, 1751232000000, 1751232000000),
('step-002ac', 'proj-002a', 'CI/CD 流水线', '2026-06-26', '2026-07-10', 'done', 3, 1751232000000, 1751232000000),
-- proj-002b 的步骤
('step-002ba', 'proj-002b', 'OCR 引擎集成', '2026-07-20', '2026-08-05', 'planned', 1, 1751923200000, 1751923200000),
('step-002bb', 'proj-002b', '合同解析模型', '2026-08-06', '2026-08-20', 'planned', 2, 1751923200000, 1751923200000),
('step-002bc', 'proj-002b', '界面集成', '2026-08-21', '2026-09-05', 'blocked', 3, 1751923200000, 1751923200000),
-- proj-002c 的步骤
('step-002ca', 'proj-002c', '需求评审', '2026-08-01', '2026-08-10', 'risk', 1, 1751923200000, 1751923200000),
('step-002cb', 'proj-002c', '数据源对接', NULL, NULL, 'tbd', 2, 1751923200000, 1751923200000),
-- proj-002d 的步骤
('step-002da', 'proj-002d', '技术方案设计', NULL, NULL, 'tbd', 1, 1752538800000, 1752538800000);
