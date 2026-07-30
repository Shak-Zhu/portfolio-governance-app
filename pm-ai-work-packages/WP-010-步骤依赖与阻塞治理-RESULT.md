# WP-010｜步骤依赖与阻塞治理｜实施结果

- 状态：**implemented, pending Human Owner acceptance**
- 批准变更：CR-006 / REQ-027
- 发布提交：`d1b253dea36b7c1736597ed0bf4e4b4c3ec4f3d0`

## 已交付

1. `steps` 新增 additive 字段：`dependency_type`、`dependency_detail`、`blocked_impact`；既有数据默认 `none`，不改变旧步骤行为。
2. 移除甘特条尾端白色竖线。当前 `blocked` 步骤在条下方显示“前置（关系类型）→ 阻塞（影响）”，不改变真实日期的 `colStart / colEnd`。
3. 步骤编辑器、REST 既有步骤接口、官方 MCP 既有 `create_step` / `update_step` 都可维护字段；MCP 工具总数仍为 31。
4. Skill Bundle 已更新并重新生成 SHA-256 manifest；生产 Skill 发布指针已固定到本提交。
5. 生产业务回填严格使用官方 MCP：Finance、CRM Gate、Contract Extractor、Monitoring、Copilot、Playbook 与 Drive/Transcript 的已确认依赖均已回读。

## 验证证据

- `npm run lint`：通过。
- `npm test`：13/13 通过，含依赖字段不改变真实甘特日期落位。
- `npm run test:e2e`：60/60 通过，含 MCP 依赖字段的拒绝/创建/更新/甘特回读。
- `node scripts/validate-skill-consistency.mjs`：22/22 通过。
- `npm run build`：dry-run 通过。
- 生产 D1 migration `0002_step_dependency_fields.sql`：远程执行成功。
- 生产 `/mcp`：tools/list 仍为 31，`update_step` 已返回三个依赖字段；生产 `get_gantt` 回读两个阻塞步骤的前置与影响。
