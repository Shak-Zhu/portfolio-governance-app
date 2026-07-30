// MCP / Agent 接入单一配置源（single source of truth）。
// 网页接入中心、复制指令、manifest、MCP server 版本号全部从这里派生，防止漂移。
// 权威源文件：agent-skills/shak-project-portfolio-governance/agent.config.json
// WP-006：单一 Bearer Token 模型（不再有 scope），对应字段保留以兼容其它字段，
// 但 agent.config.json 必须删除 oauthScopes（见 WP-006 文档清理清单）。
import agentConfig from '../../agent-skills/shak-project-portfolio-governance/agent.config.json';

export interface AgentConfig {
  mcpName: string;
  systemName: string;
  productionBaseUrl: string;
  mcpUrl: string;
  skillVersion: string;
  serverVersion: string;
  toolProtocolVersion: string;
  manifestUrl: string;
  files: {
    skill: { path: string; url: string };
    rule: { path: string; url: string };
  };
}

// 兼容：agent.config.json 在迁移过程中可能仍含 oauthScopes 字段；不依赖该字段。
function stripOAuthScopes(raw: unknown): AgentConfig {
  const o = raw as Record<string, unknown>;
  const filesObj = (o.files ?? {}) as Record<string, { path?: string; url?: string }>;
  return {
    mcpName: String(o.mcpName ?? ''),
    systemName: String(o.systemName ?? ''),
    productionBaseUrl: String(o.productionBaseUrl ?? ''),
    mcpUrl: String(o.mcpUrl ?? ''),
    skillVersion: String(o.skillVersion ?? '1.0.0'),
    serverVersion: String(o.serverVersion ?? '1.0.0'),
    toolProtocolVersion: String(o.toolProtocolVersion ?? '2025-06-18'),
    manifestUrl: String(o.manifestUrl ?? ''),
    files: {
      skill: {
        path: String(filesObj.skill?.path ?? 'SKILL.md'),
        url: String(filesObj.skill?.url ?? ''),
      },
      rule: {
        path: String(filesObj.rule?.path ?? ''),
        url: String(filesObj.rule?.url ?? ''),
      },
    },
  };
}

export const AGENT_CONFIG: AgentConfig = stripOAuthScopes(agentConfig);

export const MCP_NAME = AGENT_CONFIG.mcpName;
export const MCP_PROTOCOL_VERSION = AGENT_CONFIG.toolProtocolVersion;
export const SERVER_VERSION = AGENT_CONFIG.serverVersion;
export const SKILL_VERSION = AGENT_CONFIG.skillVersion;
