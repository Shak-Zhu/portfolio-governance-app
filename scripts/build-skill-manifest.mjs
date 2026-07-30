// Generates agent-skills/shak-project-portfolio-governance/manifest.json
// covering ALL files in the bundle (SKILL.md, .mdc, references/*, agents/*).
// Output SHA-256 are computed from the actual files; the script must run
// after the bundle files are written and before publishing.
//
// Usage:
//   node scripts/build-skill-manifest.mjs
//
// The produced manifest does NOT carry placeholders for the production
// GitHub commit SHA — that is intentionally left null and overwritten by
// Codex at QC time. Cursor MUST NOT guess or commit the GitHub SHA.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const bundleDir = resolve(root, 'agent-skills/shak-project-portfolio-governance');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      out.push(...walk(p));
    } else {
      out.push(p);
    }
  }
  return out;
}

const files = {};
for (const full of walk(bundleDir).sort()) {
  if (full.endsWith('manifest.json')) continue;
  const rel = relative(bundleDir, full);
  const ext = full.slice(full.lastIndexOf('.'));
  const contentTypeMap = {
    '.md': 'text/markdown; charset=utf-8',
    '.yaml': 'application/yaml; charset=utf-8',
    '.yml': 'application/yaml; charset=utf-8',
    '.mdc': 'text/markdown; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };
  const contentType = contentTypeMap[ext] || 'text/plain; charset=utf-8';
  const bytes = readFileSync(full);
  files[rel] = { sha256: sha256(bytes), bytes: bytes.length, contentType };
}

const manifest = {
  schemaVersion: '1.0.0',
  skillName: 'shak-project-portfolio-governance',
  systemName: 'Shak 项目组合治理系统',
  skillVersion: '1.0.0',
  mcpName: 'shak-project-portfolio-governance',
  mcpUrl: 'https://pmo.pmoforms.com/mcp',
  productionBaseUrl: 'https://pmo.pmoforms.com',
  toolProtocolVersion: '2025-06-18',
  serverVersion: '1.0.0',
  // skillSourceCommit 由 Codex 在 QC 后从最终不可变 Git commit 写入；
  // Cursor 不得填写。生产文案与 get_capabilities 一律读取此字段。
  skillSourceCommit: null,
  generatedAt: new Date().toISOString(),
  files,
  installNotes: {
    codex: '参见网页 /api/agent/install (Codex tab)；下载到 ~/.codex/skills/shak-project-portfolio-governance/',
    cursor: '合并 ~/.cursor/mcp.json 并安装 .cursor/rules/shak-project-portfolio-governance.mdc',
    general: '通过任意兼容 MCP Streamable HTTP 客户端调用 https://pmo.pmoforms.com/mcp',
  },
  privacy: '本 manifest 不包含真实 Bearer Token、登录凭据、Session 信息或 GitHub PAT。',
};

import { writeFileSync } from 'node:fs';
const out = resolve(bundleDir, 'manifest.json');
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[build-skill-manifest] wrote ${out}`);
for (const [k, v] of Object.entries(files)) {
  console.log(`  ${k}  ${v.bytes} bytes  sha256=${v.sha256.slice(0, 16)}…`);
}
