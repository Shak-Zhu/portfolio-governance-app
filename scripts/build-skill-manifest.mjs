// 统一入口：调用 generate-agent-manifest.mjs 完成 manifest 生成。
// 产物：agent-skills/shak-project-portfolio-governance/manifest.json（含全部受管文件 SHA-256）。
// 不写入任何 token / secret。
import('./generate-agent-manifest.mjs');
