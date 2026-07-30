// MCP / Agent 接入单一配置源（single source of truth）。
// 网页接入中心、复制指令、manifest、MCP server 版本号全部从这里派生，防止漂移。
// 权威源文件：agent-skills/shak-project-portfolio-governance/agent.config.json
// WP-007A L4：files 仅含相对路径；真实 GitHub raw URL 由 /api/agent/install 与 get_capabilities 注入。
import agentConfig from '../../agent-skills/shak-project-portfolio-governance/agent.config.json';

export interface FileEntry {
  path: string;
}

export interface AgentConfig {
  mcpName: string;
  systemName: string;
  productionBaseUrl: string;
  mcpUrl: string;
  skillVersion: string;
  serverVersion: string;
  toolProtocolVersion: string;
  // 相对于 Bundle 根目录的 manifest 相对路径
  manifestPath: string;
  // 受管文件（仅含相对路径，无 URL）
  files: Record<string, FileEntry>;
}

function parseConfig(raw: unknown): AgentConfig {
  const o = raw as Record<string, unknown>;
  const filesObj = (o.files ?? {}) as Record<string, { path?: unknown }>;
  const files: Record<string, FileEntry> = {};
  for (const [k, v] of Object.entries(filesObj)) {
    if (v && typeof v === 'object') {
      files[k] = { path: String((v as { path?: unknown }).path ?? k) };
    }
  }
  return {
    mcpName: String(o.mcpName ?? ''),
    systemName: String(o.systemName ?? ''),
    productionBaseUrl: String(o.productionBaseUrl ?? ''),
    mcpUrl: String(o.mcpUrl ?? ''),
    skillVersion: String(o.skillVersion ?? '1.0.0'),
    serverVersion: String(o.serverVersion ?? '1.0.0'),
    toolProtocolVersion: String(o.toolProtocolVersion ?? '2025-06-18'),
    manifestPath: String(o.manifestPath ?? 'manifest.json'),
    files,
  };
}

export const AGENT_CONFIG: AgentConfig = parseConfig(agentConfig);

// 兼容导出
export const MCP_NAME = AGENT_CONFIG.mcpName;
export const MCP_PROTOCOL_VERSION = AGENT_CONFIG.toolProtocolVersion;
export const SERVER_VERSION = AGENT_CONFIG.serverVersion;
export const SKILL_VERSION = AGENT_CONFIG.skillVersion;
