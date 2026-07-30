// 生成版本化 Agent Skill manifest 并同步生产静态资产。
// 权威源：agent-skills/shak-project-portfolio-governance/{SKILL.md, *.mdc, agent.config.json}
// 产物：
//   - agent-skills/shak-project-portfolio-governance/manifest.json（Git 权威 manifest）
//   - public/agent/manifest.json（生产静态资产 /agent/manifest.json）
//   - public/agent/skills/shak-project-portfolio-governance/{SKILL.md, *.mdc}
// manifest 含 skillVersion、mcpUrl、文件 URL、SHA-256、工具协议版本、生成时间。
// 不写入任何 token / secret。
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const skillDir = join(root, 'agent-skills', 'shak-project-portfolio-governance');

const config = JSON.parse(readFileSync(join(skillDir, 'agent.config.json'), 'utf8'));
const mcpName = config.mcpName;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const skillPath = join(skillDir, 'SKILL.md');
const rulePath = join(skillDir, `${mcpName}.mdc`);
const skillBuf = readFileSync(skillPath);
const ruleBuf = readFileSync(rulePath);

// 同步到生产静态资产目录
const publicSkillDir = join(root, 'public', 'agent', 'skills', mcpName);
mkdirSync(publicSkillDir, { recursive: true });
copyFileSync(skillPath, join(publicSkillDir, 'SKILL.md'));
copyFileSync(rulePath, join(publicSkillDir, `${mcpName}.mdc`));

const manifest = {
  skillVersion: config.skillVersion,
  mcpName,
  mcpUrl: config.mcpUrl,
  toolProtocolVersion: config.toolProtocolVersion,
  serverVersion: config.serverVersion,
  generatedAt: new Date().toISOString(),
  files: {
    skill: {
      path: `skills/${mcpName}/SKILL.md`,
      url: config.files.skill.url,
      sha256: sha256(skillBuf),
      bytes: skillBuf.length,
    },
    rule: {
      path: `skills/${mcpName}/${mcpName}.mdc`,
      url: config.files.rule.url,
      sha256: sha256(ruleBuf),
      bytes: ruleBuf.length,
    },
  },
};

const manifestJson = JSON.stringify(manifest, null, 2) + '\n';

// Git 权威 manifest
writeFileSync(join(skillDir, 'manifest.json'), manifestJson);

// 生产静态资产 /agent/manifest.json
const publicAgentDir = join(root, 'public', 'agent');
mkdirSync(publicAgentDir, { recursive: true });
writeFileSync(join(publicAgentDir, 'manifest.json'), manifestJson);

console.log('Agent manifest 生成完成：');
console.log(`  skillVersion=${manifest.skillVersion} toolProtocol=${manifest.toolProtocolVersion}`);
console.log(`  SKILL.md sha256=${manifest.files.skill.sha256} (${manifest.files.skill.bytes} bytes)`);
console.log(`  ${mcpName}.mdc sha256=${manifest.files.rule.sha256} (${manifest.files.rule.bytes} bytes)`);
console.log('  写入：agent-skills/.../manifest.json, public/agent/manifest.json, public/agent/skills/...');
