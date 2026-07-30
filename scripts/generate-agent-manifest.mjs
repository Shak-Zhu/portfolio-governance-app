// 生成版本化 Agent Skill manifest。
// 权威源：agent-skills/shak-project-portfolio-governance/agent.config.json（仅含相对路径）
// 产物：agent-skills/.../manifest.json（含全部受管文件相对路径 + SHA-256）
// manifest 含 skillVersion、mcpUrl、相对 manifestPath、文件 SHA-256、工具协议版本、生成时间。
// 真实 GitHub raw URL 仅由 Codex 发布后写入 SHAK_PMO_SKILL_SOURCE_COMMIT。
// 不写入任何 token / secret。
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const skillDir = join(root, 'agent-skills', 'shak-project-portfolio-governance');

const config = JSON.parse(readFileSync(join(skillDir, 'agent.config.json'), 'utf8'));
const mcpName = config.mcpName;
const sha256Fn = (buf) => createHash('sha256').update(buf).digest('hex');

// manifest.files 是"六个内容文件的哈希校验清单"，不含 manifest.json 自身。
// 安装器先下载 manifest → 下载并校验 6 个内容文件 → 将 manifest 原样写入本地 Bundle。
// 这样避免 manifest 写入自身后再计算 SHA 的循环。
const BUNDLE_6 = [
  'SKILL.md',
  'shak-project-portfolio-governance.mdc',
  'references/tool-contract.md',
  'references/governance-rules.md',
  'agents/openai.yaml',
  'agent.config.json',
];

const files = {};
for (const rel of BUNDLE_6) {
  const fullPath = join(skillDir, rel);
  const buf = readFileSync(fullPath);
  files[rel] = { path: rel, sha256: sha256Fn(buf), bytes: buf.length };
}

// 构建 manifest（files 仅含相对路径，无 url）
const manifest = {
  schemaVersion: '1.0.0',
  skillName: mcpName,
  systemName: 'Shak 项目组合治理系统',
  skillVersion: config.skillVersion,
  mcpName,
  mcpUrl: config.mcpUrl,
  productionBaseUrl: 'https://pmo.pmoforms.com',
  toolProtocolVersion: config.toolProtocolVersion,
  serverVersion: config.serverVersion,
  // manifestPath：相对于 Bundle 根目录（仅相对路径）
  manifestPath: config.manifestPath || 'manifest.json',
  // skillSourceCommit 由 Codex 在 QC 后写入；Cursor 保留 null。
  skillSourceCommit: null,
  generatedAt: new Date().toISOString(),
  // manifest.files 是 6 个内容文件的哈希校验清单（不含 manifest.json 自身）
  files,
  installNotes: {
    codex: '参见网页 /api/agent/install（Codex tab，需登录）；安装文案含固定 GitHub commit 下的 SHA-256 校验。',
    cursor: '合并 ~/.cursor/mcp.json 并安装 .cursor/rules/shak-project-portfolio-governance.mdc',
    general: '通过任意兼容 MCP Streamable HTTP 客户端调用 https://pmo.pmoforms.com/mcp',
  },
  privacy: '本 manifest 不包含真实 Bearer Token、GitHub PAT 或 Session 信息。真实 GitHub raw URL 仅由 /api/agent/install 与 get_capabilities 在 Codex 发布后注入。',
};

const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
const gitManifestPath = join(skillDir, 'manifest.json');
writeFileSync(gitManifestPath, manifestJson);

console.log('Agent manifest 生成完成：');
console.log(`  skillVersion=${manifest.skillVersion} toolProtocol=${manifest.toolProtocolVersion}`);
console.log(`  manifestPath=${manifest.manifestPath}`);
console.log('  manifest.files (6 项):');
for (const [rel, meta] of Object.entries(files)) {
  console.log(`    ${rel}  ${meta.bytes} bytes  sha256=${meta.sha256.slice(0, 16)}…`);
}
console.log('  → agent-skills/shak-project-portfolio-governance/manifest.json');
