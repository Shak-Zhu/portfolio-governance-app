-- Migration: 0001_initial_schema
-- Description: 创建核心数据表（含 project_links）
-- Idempotent: YES (IF NOT EXISTS)

-- 1. 项目组合表
CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 2. 项目表（含父子层级）
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  owner TEXT NOT NULL,
  stage TEXT,
  health TEXT DEFAULT 'unknown',
  expectation TEXT,
  risk TEXT,
  gate TEXT DEFAULT 'open',
  status TEXT DEFAULT 'active',
  is_archived INTEGER DEFAULT 0,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- 3. 步骤计划表（甘特条来源）
CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'planned',
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 4. 自定义 Stage 表
CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
);

-- 5. 审计事件表
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  summary TEXT,
  details TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE SET NULL
);

-- 6. 项目关联资料表（一对多）
CREATE TABLE IF NOT EXISTS project_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_projects_portfolio ON projects(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id);
CREATE INDEX IF NOT EXISTS idx_steps_project ON steps(project_id);
CREATE INDEX IF NOT EXISTS idx_stages_portfolio ON stages(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_audit_portfolio ON audit_events(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_audit_object ON audit_events(object_type, object_id);
CREATE INDEX IF NOT EXISTS idx_project_links_project ON project_links(project_id);
