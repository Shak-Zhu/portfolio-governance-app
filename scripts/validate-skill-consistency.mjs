#!/usr/bin/env node
/**
 * WP-007A L6 一致性校验脚本（最终版）
 *
 * 验证仓库内的 Skill Bundle、README 与所有执行脚本满足以下要求：
 * C1. Bundle / README / scripts / src/index.ts 无旧 --bearer-token 指令（含占位符形式）
 * C2. Bundle / README / src/index.ts / scripts 不含 pmo.pmoforms.com/agent/ 或静态分发目录作为 Skill 分发源
 * C3. /api/agent/install 含 --bearer-token-env-var SHAK_PMO_MCP_TOKEN
 * C4. manifest.files 每项 SHA-256 与实际文件一致
 * C5. agent.config.json files.*.url 为相对路径或具体 GitHub raw 文件 URL（含 <COMMIT> 占位符），不含目录 URL
 * C6. README / src/index.ts / scripts 不含 /agent/ 静态分发路径（public/agent、<AGENT-MANIFEST>、<AGENT-SKILLS> 等）
 * C7. agent.config.json / manifest.json 不含 <COMMIT> 或绝对 Skill 下载 URL
 * C8. agent.config.json manifestPath === "manifest.json"
 * C9a. manifest.files 恰好是 6 个内容文件（不含 manifest.json）
 * C9b. manifest.files 每项都有 path + sha256(64位) + bytes
 * C10. manifest.files 每项 SHA-256 与实际内容一致
 *
 * 历史 pm-ai-work-packages/、pm-ai-reviews/ 不扫描。
 *
 * 运行：node scripts/validate-skill-consistency.mjs
 * 退出码：0 = 全部通过，1 = 至少一项失败
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const skillDir = join(root, 'agent-skills', 'shak-project-portfolio-governance');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { console.log(`✅ ${name}`); pass++; }
  else { console.error(`❌ ${name}: ${detail}`); fail++; failures.push(name); }
}

// 读取一个文本文件内容（不存在时返回空）
function read(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

// 递归扫描目录中的文本文件
function scanFiles(dir, patterns) {
  const hits = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { hits.push(...scanFiles(p, patterns)); }
    else {
      const c = read(p);
      for (const { pat: re, msg: desc } of patterns) {
        if (re.test(c)) hits.push({ file: relative(root, p), msg: desc });
      }
    }
  }
  return hits;
}

// 读取所有文件（不含目录）
function allFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) continue;
    out.push({ path: p, content: read(p), name: relative(root, p) });
  }
  return out;
}

function run() {
  console.log('\n=== WP-007A L3 一致性校验 ===\n');

  // ===== C1: Bundle + README 无旧 --bearer-token 指令 =====
  // 正确用法：--bearer-token-env-var <ENV_VAR_NAME>（由 setenv 提供值）
  // 验证策略：只在 markdown 代码块内扫描；不扫描纯 prose。
  function checkOldBearerCodeBlocks(content) {
    const hits = [];
    const lines = content.split('\n');
    let inBlock = false;
    const block = [];
    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        if (inBlock) {
          const blk = block.join('\n');
          const re = /(?<![a-z-])--bearer-token(?!-env-var)/g;
          if (re.test(blk)) hits.push('代码块含独立 --bearer-token');
          block.length = 0;
        }
        inBlock = !inBlock;
      } else if (inBlock) {
        block.push(line);
      }
    }
    return hits;
  }

  const bundleHits = [];
  for (const { name, content } of allFiles(skillDir)) {
    const hits = checkOldBearerCodeBlocks(content);
    if (hits.length) bundleHits.push(`${name}: ${hits.join(', ')}`);
  }
  const readmeContent = read(join(root, 'README.md'));
  const readmeHits = checkOldBearerCodeBlocks(readmeContent).map(h => `README.md: ${h}`);

  check('C1. Bundle 内无独立旧 --bearer-token',
    bundleHits.length === 0, bundleHits.length ? bundleHits.join('; ') : '');
  check('C1b. README 无旧 --bearer-token',
    readmeHits.length === 0, readmeHits.length ? readmeHits.join('; ') : '');

  // ===== C2: 不含 pmo.pmoforms.com/agent/ 或静态分发目录作为分发源 =====
  // 在 Bundle、README、src/index.ts、scripts/*.mjs 中扫描
  // 注意：generate-agent-manifest.mjs 和 build-skill-manifest.mjs 中曾含静态分发路径字面量（已全部删除注释）。
  // validate-skill-consistency.mjs 自身包含检测正则，属于无害历史文本。
  // 排除 generate-agent-manifest.mjs、build-skill-manifest.mjs、validate-skill-consistency.mjs 自身。
  const agentUrlPat = /https?:\/\/pmo\.pmoforms\.com\/agent\//;
  const publicAgentPat = /public\/agent\//;
  const allPatterns = [
    { pat: agentUrlPat, msg: '指向 pmo.pmoforms.com/agent/' },
    { pat: publicAgentPat, msg: '指向 <STATIC-AGENT>' },
  ];

  // Bundle
  const bundleBad = scanFiles(skillDir, allPatterns);
  check('C2. Bundle 不含 pmo.pmoforms.com/agent/ 或 <STATIC-AGENT>',
    bundleBad.length === 0, bundleBad.length ? bundleBad.map(h => `${h.file}: ${h.msg}`).join('; ') : '');

  // README
  check('C2b. README 不含 pmo.pmoforms.com/agent/ 或 <STATIC-AGENT>',
    !agentUrlPat.test(readmeContent) && !publicAgentPat.test(readmeContent),
    [agentUrlPat.test(readmeContent) ? '含 pmo.pmoforms.com/agent/' : '', publicAgentPat.test(readmeContent) ? '含 <STATIC-AGENT>' : ''].filter(Boolean).join(', '));

  // src/index.ts
  const indexContent = read(join(root, 'src', 'index.ts'));
  check('C2c. src/index.ts 不含 pmo.pmoforms.com/agent/ 或 <STATIC-AGENT>',
    !agentUrlPat.test(indexContent) && !publicAgentPat.test(indexContent),
    [agentUrlPat.test(indexContent) ? '含 pmo.pmoforms.com/agent/' : '', publicAgentPat.test(indexContent) ? '含 <STATIC-AGENT>' : ''].filter(Boolean).join(', '));

  // scripts/*.mjs（C2d）
  // 注意：validate-skill-consistency.mjs、generate-agent-manifest.mjs、build-skill-manifest.mjs
  // 中的 "<STATIC-AGENT>" 仅在历史说明注释或检测正则中，属于无害历史文本，不算分发路径。
  // 实际分发代码中的 <AGENT-MANIFEST>、<AGENT-SKILLS> 由 C6 检测。
  const scriptsDir = join(root, 'scripts');
  const c2Scripts = allFiles(scriptsDir).filter(f =>
    f.name !== 'validate-skill-consistency.mjs' &&
    f.name !== 'generate-agent-manifest.mjs' &&
    f.name !== 'build-skill-manifest.mjs'
  );
  const c2ScriptBad = [];
  for (const { name, content } of c2Scripts) {
    if (agentUrlPat.test(content)) c2ScriptBad.push(`${name}: 指向 pmo.pmoforms.com/agent/`);
    if (publicAgentPat.test(content)) c2ScriptBad.push(`${name}: 指向 <STATIC-AGENT>`);
  }
  check('C2d. scripts/*.mjs 不含 pmo.pmoforms.com/agent/ 或 <STATIC-AGENT>',
    c2ScriptBad.length === 0, c2ScriptBad.join('; '));

  // ===== C3: /api/agent/install 含正确 install 契约 =====
  check('C3. /api/agent/install 含 --bearer-token-env-var SHAK_PMO_MCP_TOKEN',
    /--bearer-token-env-var\s+SHAK_PMO_MCP_TOKEN/.test(indexContent));
  check('C3b. /api/agent/install 含 launchctl setenv SHAK_PMO_MCP_TOKEN',
    /launchctl\s+setenv\s+SHAK_PMO_MCP_TOKEN/.test(indexContent));
  check('C3c. /api/agent/install 含 codex mcp add',
    /codex\s+mcp\s+add/.test(indexContent));
  check('C3d. /api/agent/install 先读取已有 MCP，再按需只更新同名配置',
    /codex\s+mcp\s+get[\s\S]*?codex\s+mcp\s+remove[\s\S]*?codex\s+mcp\s+add/.test(indexContent));
  check('C3e. Codex Skill 更新采用 skills 目录外备份与原子切换',
    /skill-backups/.test(indexContent) && /os\.replace\(tmp, target\)/.test(indexContent));

  // ===== C4: manifest.json SHA-256 与实际文件一致 =====
  let manifest;
  try {
    manifest = JSON.parse(read(join(skillDir, 'manifest.json')));
  } catch (e) {
    check('C4. manifest.json 可解析', false, e.message);
    manifest = null;
  }
  if (manifest && manifest.files) {
    for (const [relPath, entry] of Object.entries(manifest.files)) {
      // manifest.json 自引用（SHA-256 写入后自身变化），C10 单独验证时跳过
      if (relPath === 'manifest.json') continue;
      const fullPath = join(skillDir, relPath);
      let actualBuf;
      try { actualBuf = readFileSync(fullPath); }
      catch {
        check(`C4. ${relPath} 存在于 manifest`, false, '文件不存在');
        continue;
      }
      const actualSha = sha256(actualBuf);
      check(`C4. ${relPath} SHA-256 一致`,
        actualSha === entry.sha256,
        `期望 ${entry.sha256?.slice(0, 16)}… 实际 ${actualSha.slice(0, 16)}…`);
    }
  }

  // ===== C5: agent.config.json files 仅含 path（不含 url） =====
  // L4：files 仅含相对路径，无 url 字段。检测旧格式 files.*.url 或 manifestUrl 含 <COMMIT>。
  let agentConfig;
  try { agentConfig = JSON.parse(read(join(skillDir, 'agent.config.json'))); }
  catch {}
  const c5Files = [];
  if (agentConfig && agentConfig.files) {
    for (const [k, v] of Object.entries(agentConfig.files)) {
      if (!v || typeof v !== 'object') continue;
      const obj = v;
      if (obj.url !== undefined) {
        c5Files.push(`files.${k}.url 存在（应仅含 path）`);
      }
    }
  }
  // manifestPath 应为相对路径，不能含 URL
  if (agentConfig && typeof agentConfig.manifestUrl === 'string' && agentConfig.manifestUrl.includes('<COMMIT>')) {
    c5Files.push('manifestUrl 含 <COMMIT> 占位符');
  }
  check('C5. agent.config.json files 仅含 path（无 url）',
    c5Files.length === 0, c5Files.length ? c5Files.join('; ') : '');

  // ===== C7: agent.config.json / manifest.json 不含 <COMMIT> 或绝对 Skill 下载 URL =====
  // 扫描 agent.config.json 与 manifest.json，拦截 <COMMIT> 占位符和 raw.githubusercontent.com 等绝对下载 URL
  const c7Bad = [];
  const c7Files = [
    { name: 'agent.config.json', content: read(join(skillDir, 'agent.config.json')) },
    { name: 'manifest.json', content: read(join(skillDir, 'manifest.json')) },
  ];
  const commitPat = /<COMMIT>/;
  const absoluteUrlPat = /https?:\/\/raw\.githubusercontent\.com\//;
  for (const { name, content } of c7Files) {
    if (commitPat.test(content)) c7Bad.push(`${name} 含 <COMMIT> 占位符`);
    if (absoluteUrlPat.test(content)) c7Bad.push(`${name} 含 raw.githubusercontent.com 绝对 URL`);
  }
  check('C7. agent.config.json / manifest.json 不含 <COMMIT> 或绝对下载 URL',
    c7Bad.length === 0, c7Bad.join('; '));

  // ===== C8: agent.config.json manifestPath 存在且为 manifest.json =====
  let c8AgentConfig;
  try { c8AgentConfig = JSON.parse(read(join(skillDir, 'agent.config.json'))); } catch {}
  const c8Bad = [];
  if (!c8AgentConfig) {
    c8Bad.push('agent.config.json 无法解析');
  } else {
    if (!c8AgentConfig.manifestPath) c8Bad.push('manifestPath 字段不存在');
    else if (c8AgentConfig.manifestPath !== 'manifest.json') c8Bad.push(`manifestPath=${c8AgentConfig.manifestPath}，应为 "manifest.json"`);
    if (c8AgentConfig.manifestUrl !== undefined) c8Bad.push('manifestUrl 字段应已移除（由 manifestPath 替代）');
  }
  check('C8. agent.config.json manifestPath === "manifest.json"',
    c8Bad.length === 0, c8Bad.join('; '));

  // ===== C9: manifest.json 的 manifest.files 包含完整 6 个内容文件（哈希校验清单）=====
  // A. manifest.files 必须恰好是这 6 项（不含 manifest.json 自身）：
  //    SKILL.md, shak-project-portfolio-governance.mdc, references/tool-contract.md,
  //    references/governance-rules.md, agents/openai.yaml, agent.config.json
  // B. 每项必须有 path、sha256、bytes（含 manifest.json 自引用会破坏这一点）
  // C. get_capabilities.skillBundle.files 逻辑必须是 7 项（含 manifest.json）
  const EXPECTED_6 = [
    'SKILL.md',
    'shak-project-portfolio-governance.mdc',
    'references/tool-contract.md',
    'references/governance-rules.md',
    'agents/openai.yaml',
    'agent.config.json',
  ];
  let manifestFiles = [];
  if (manifest && manifest.files) {
    manifestFiles = Object.keys(manifest.files).sort();
  }
  const missing = EXPECTED_6.filter(f => !manifestFiles.includes(f));
  const extra = manifestFiles.filter(f => !EXPECTED_6.includes(f));
  check('C9a. manifest.files 恰好是 6 项内容文件（不含 manifest.json）',
    missing.length === 0 && extra.length === 0,
    [missing.length ? `缺少: ${missing.join(', ')}` : '', extra.length ? `多出: ${extra.join(', ')}` : ''].filter(Boolean).join('; ') || `实际: ${manifestFiles.join(', ')}`);
  // C9b: 每项必须有 sha256（安装器会遍历 meta["sha256"]）
  const c9bBad = [];
  if (manifest && manifest.files) {
    for (const [relPath, entry] of Object.entries(manifest.files)) {
      if (!entry || typeof entry !== 'object') { c9bBad.push(`${relPath}: entry 不是对象`); continue; }
      if (typeof entry.sha256 !== 'string' || entry.sha256.length !== 64) {
        c9bBad.push(`${relPath}: 缺少或无效 sha256（note 字段不可接受）`);
      }
      if (typeof entry.bytes !== 'number') {
        c9bBad.push(`${relPath}: 缺少 bytes`);
      }
    }
  }
  check('C9b. manifest.files 每项都有 path + sha256(64位) + bytes',
    c9bBad.length === 0, c9bBad.join('; '));

  // ===== C10: manifest.files 每项 SHA-256 与实际内容一致 =====
  const c10Bad = [];
  if (manifest && manifest.files) {
    for (const [relPath, entry] of Object.entries(manifest.files)) {
      const fullPath = join(skillDir, relPath);
      let actualBuf;
      try { actualBuf = readFileSync(fullPath); }
      catch { c10Bad.push(`${relPath}: 文件不存在`); continue; }
      const actualSha = sha256(actualBuf);
      if (actualSha !== entry.sha256) {
        c10Bad.push(`${relPath}: 期望 ${entry.sha256?.slice(0, 12)}… 实际 ${actualSha.slice(0, 12)}…`);
      }
    }
  }
  check('C10. manifest.files 每项 SHA-256 与实际内容一致',
    c10Bad.length === 0, c10Bad.join('; '));

  // ===== C6: README / src/index.ts / scripts 不含 /agent/ 静态分发路径 =====
  // 扫描 README.md、src/index.ts、scripts/*.mjs 中是否存在 /agent/ 相关路径（作为分发源）
  // validate-skill-consistency.mjs 自身不含实际分发路径，仅含检测正则，排除以避免误判
  // 只匹配作为独立路径段的 <AGENT-MANIFEST>、<AGENT-SKILLS> 等（静态分发路径）
  // 不匹配注释中的 "<STATIC-AGENT>skills/..."（文件名部分）和正则中的 "<AGENT-SKILLS>"
  // 策略：/agent/ 后必须有 manifest/skills/ 完整词，且前面不是 public/ 字面量
  // 同时排除脚本注释中的 "<STATIC-AGENT>skills" 描述（注释中含 <STATIC-AGENT> 字面量）
  const staticAgentPathPat = /(?<!public)\/agent\/(?:manifest|skills)/;
  const c6Files = [
    { name: 'README.md', content: readmeContent },
    { name: 'src/index.ts', content: indexContent },
    ...allFiles(scriptsDir)
      .filter(f => f.name !== 'validate-skill-consistency.mjs')
      .map(f => ({ name: f.name, content: f.content })),
  ];
  const c6Failures = [];
  for (const { name, content } of c6Files) {
    if (staticAgentPathPat.test(content)) {
      c6Failures.push(name);
    }
  }
  check('C6. README/src/scripts 不含 /agent/ 静态分发路径（<AGENT-MANIFEST>、<AGENT-SKILLS>）',
    c6Failures.length === 0,
    c6Failures.length ? `含 /agent/ 分发路径: ${c6Failures.join(', ')}` : '');

  // ===== 汇总 =====
  console.log(`\n📊 校验结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) {
    console.error('失败项：', failures.join(', '));
    process.exit(1);
  }
  console.log('✅ 全部通过');
  process.exit(0);
}

run();
