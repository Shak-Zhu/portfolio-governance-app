# Cloudflare 资源清单｜生产环境

| 资源 | 名称 / 入口 | 当前用途 | 维护边界 |
|---|---|---|---|
| 自定义域名 | `https://pmo.pmoforms.com` | 正式网站入口 | Codex 负责域名与 Route |
| Worker | `pmo-governance` | 承载正式 Web App、API、后续 MCP | Cursor 开发；Codex 审核后部署 |
| D1 | `pmo-governance-prod`，Worker binding `DB` | 项目主数据与审计事件 | Codex 负责资源；Cursor 维护 migration 与应用绑定 |
| R2 | `pmo-governance-backups-prod`，预留 binding `BACKUPS` | 每日逻辑备份与恢复校验 | Codex 负责资源与策略；Cursor 在 WP-002B 实现备份任务 |

## 安全约束

- 不把 OAuth token、API token、密钥、`.dev.vars` 或 `.env` 提交到 Git。
- 不创建匿名公开写入接口。
- 生产 deploy 只能由 Codex 在 PM/QC 通过后执行。
- Cursor 不创建、删除、重命名 Worker、域名、D1 或 R2 资源。
