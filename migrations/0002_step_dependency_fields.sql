-- Migration: 0002_step_dependency_fields
-- Description: 为步骤增加可维护的依赖关系与阻塞影响字段。
-- 说明：这是 additive migration；既有步骤默认 dependency_type=none，行为保持不变。

ALTER TABLE steps ADD COLUMN dependency_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE steps ADD COLUMN dependency_detail TEXT;
ALTER TABLE steps ADD COLUMN blocked_impact TEXT;
