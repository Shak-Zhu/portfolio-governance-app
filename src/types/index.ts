// 类型定义
export interface Portfolio {
  id: string;
  name: string;
  description?: string;
  created_at: number;
  updated_at: number;
}

export interface Project {
  id: string;
  portfolio_id: string;
  parent_id?: string;
  title: string;
  owner: string;
  stage?: string;
  health: 'green' | 'blue' | 'amber' | 'red' | 'unknown';
  expectation?: string;
  risk?: string;
  gate: 'open' | 'closed';
  status: 'active' | 'completed' | 'archived';
  is_archived: number;
  archived_at?: number;
  created_at: number;
  updated_at: number;
  // 计算字段
  children?: Project[];
  steps?: Step[];
}

export type StepDependencyType = 'none' | 'finish_to_start' | 'input_required' | 'business_gate' | 'external_dependency';

export interface Step {
  id: string;
  project_id: string;
  name: string;
  start_date?: string;
  end_date?: string;
  status: 'done' | 'planned' | 'risk' | 'blocked' | 'tbd';
  dependency_type: StepDependencyType;
  dependency_detail?: string;
  blocked_impact?: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface Stage {
  id: string;
  portfolio_id: string;
  name: string;
  sort_order: number;
  created_at: number;
}

export interface AuditEvent {
  id: string;
  portfolio_id?: string;
  actor: string;
  action: string;
  object_type: 'portfolio' | 'project' | 'step' | 'stage' | 'archive' | 'project_link';
  object_id: string;
  summary?: string;
  details?: string;
  created_at: number;
}

export interface ProjectLink {
  id: string;
  project_id: string;
  title: string;
  url: string;
  created_at: number;
  updated_at: number;
}

// API 请求/响应类型
export interface CreatePortfolioRequest {
  name: string;
  description?: string;
}

export interface UpdatePortfolioRequest {
  name?: string;
  description?: string;
}

export interface CreateProjectRequest {
  parent_id?: string;
  title: string;
  owner: string;
  stage?: string;
  health?: string;
  expectation?: string;
  risk?: string;
}

export interface UpdateProjectRequest {
  parent_id?: string;
  title?: string;
  owner?: string;
  stage?: string;
  health?: string;
  expectation?: string;
  risk?: string;
  gate?: string;
  status?: string;
}

export interface CreateStepRequest {
  name: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  dependency_type?: StepDependencyType;
  dependency_detail?: string;
  blocked_impact?: string;
}

export interface UpdateStepRequest {
  name?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  sort_order?: number;
  dependency_type?: StepDependencyType;
  dependency_detail?: string;
  blocked_impact?: string;
}

export interface CreateStageRequest {
  name: string;
}

export interface GanttRow {
  project: Project;
  steps: Step[];
  level: number;
}

export interface GanttConfig {
  start: string;
  end: string;
  scale: 'day' | 'week' | 'month';
}
