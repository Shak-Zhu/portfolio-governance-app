# PM/QC 返工报告｜WP-007A Agent Skill 与安装链路一致性修复

- 审查日期：2026-07-30
- 审查人：Codex（PM / QC）
- Coder 报告状态：`implemented, pending PM/QC review`
- **QC 结论：L2 rework required（不通过）**

## 独立验证结果

| 验证 | 实际结果 | 判定 |
|---|---|---|
| `node --check scripts/mcp-test.mjs` | **失败**：`SyntaxError: Unexpected end of input`；`call()` 的 `if` 块未闭合 | P0 不通过 |
| `node scripts/validate-skill-consistency.mjs` | 27/27 通过，但规则不能识别 `--bearer-token <token>` 占位符，也未验证 README 当前指令 | P0 不通过 |
| `npm run lint` | 通过；只覆盖 `src/**/*.ts`，不能证明 `.mjs` 可运行 | 证据不足 |
| `npm test` | 12/12；只覆盖甘特核心，不覆盖本工作包 | 证据不足 |
| Scope 审计 | 新增 `public/agent/**` 静态 Skill 副本，违反不得将站点 `/agent/...` 作为生产 Skill 来源的明确边界 | P0 不通过 |
| README / docs | Cursor 未修改 README；README 仍有旧 `--bearer-token` / `--header` 指令 | P0 不通过 |

## 必须返工项

1. 修复 `scripts/mcp-test.mjs` 语法，`node --check scripts/mcp-test.mjs` 必须 exit 0；增加 JSON 与 SSE 的最小可执行解析测试。
2. 删除 `public/agent/**` 及所有生成/同步静态 Bundle 的逻辑；生产 Skill 的唯一下载来源仍是 Codex 在 QC 后固定的 GitHub raw commit 路径。
3. 修正 README 的旧 CLI；当前安装说明仅允许 `--bearer-token-env-var SHAK_PMO_MCP_TOKEN`，不得保留独立 `--bearer-token` 或 `--header` 指令。
4. 重写 `validate-skill-consistency.mjs`：必须扫描 Bundle、README 和当前执行脚本；拦截 `--bearer-token <token>`、`--bearer-token TOKEN`、真实值、以及 `--header "Authorization: Bearer ..."` 等全部旧形式。
5. `agent.config.json` 不得把目录（如 `references/`、`agents/`）声明为 raw 可下载文件 URL；每个条目必须是具体文件，或改为纯相对路径元数据并明确由 `get_capabilities` / 动态安装文案注入固定 commit。
6. `manifest.json` 只列实际受管文件；`npm run skill:build` 不得留下未跟踪的静态 Bundle 文件。
7. 重跑并如实报告：

```bash
node --check scripts/mcp-test.mjs
node scripts/validate-skill-consistency.mjs
npm run lint
npm test
npm run skill:build
npm run test:e2e
npm run build
git diff --check
git status --short
```

## 返工边界

- 继续遵守 WP-007A 的 scope_out：不部署、不写 Cloudflare secret、不写 D1/R2、不 Git push。
- 不修改 PM baseline、历史工作包、历史 RESULT 或历史 QC。
- 返工报告仍须为中文，并仅使用状态 `implemented, pending PM/QC review`。

---

## L3 二轮 QC 结论｜2026-07-30

- **QC 结论：L3 rework required（不通过）**

### 已通过的独立复验

`node --check scripts/mcp-test.mjs`、一致性脚本、`npm run lint`、`npm test`、`npm run skill:build`、`npm run test:e2e`、`npm run build` 与 `git diff --check` 均已由 PM/QC 独立运行通过；`public/agent/**` 当前也确实不存在。

### 仍未关闭的 P0 漂移

README 仍在多个当前位置将 `/agent/...` 描述为正式 Agent Skill 静态分发路径，具体包括：

- 本地路径清单中的 `/agent/manifest.json` 与 `/agent/skills/...`；
- `npm run agent:manifest` “同步 `public/agent/` 静态资产”的说明；
- “生产静态资产”段落及“重新生成并同步静态资产”的说明。

这与 WP-007A 的明确边界、以及 Human Owner 已确认的唯一规则冲突：**正式 Skill 下载来源只能是 Codex 在 QC 后固定的 GitHub raw commit 路径，不能是生产站点 `/agent/...`。** `src/index.ts` 仍保留 `/agent/*` 公共静态分支也应删除，防止未来误恢复或绕过该边界。

### L3 必须返工项

1. 从 README 删除或改写所有将 `/agent/...`、`public/agent/`、静态同步描述为生产或安装来源的内容；改为“固定 GitHub raw commit + manifest SHA-256 校验”。
2. `scripts/build-skill-manifest.mjs` 的注释不得再声称会同步 `public/agent/`。
3. 删除 `src/index.ts` 的 `PUBLIC_STATIC_PREFIXES = ['/agent/']` 与 Worker default export 的 `/agent/*` 特例；这不是网页登录/MCP 必要路径。
4. 扩展 `scripts/validate-skill-consistency.mjs`：扫描 Bundle、README、`src/index.ts` 与执行脚本；任何当前执行/安装说明中的 `/agent/` 或 `public/agent/` 作为 Skill 分发路径必须失败。允许历史工作包和历史 QC 不扫描。
5. 重跑并报告：`node --check scripts/mcp-test.mjs`、`node scripts/validate-skill-consistency.mjs`、`npm run lint`、`npm test`、`npm run skill:build`、`npm run test:e2e`、`npm run build`、`git diff --check`、`git status --short`。

仍禁止 deploy、secret、D1/R2、Git push，且结果只能写 `implemented, pending PM/QC review`。

---

## L4 三轮 QC 结论｜2026-07-30

- **QC 结论：L4 rework required（不通过）**

### 已通过的独立复验

L3 的静态 `/agent` 分发残留已实际移除：README 已改写、`public/agent/**` 不存在，`/agent/*` 被显式返回 JSON 404；`node --check scripts/mcp-test.mjs`、31 项一致性校验、12 项单测、25 项 Worker E2E、构建与 diff 检查均已由 PM/QC 再次独立执行通过。

### 仍未关闭的 P0 准确性缺陷

下载后的 `agent-skills/.../agent.config.json` 仍将 `manifestUrl` 和所有 `files.*.url` 写成包含字面量 `<COMMIT>` 的 URL，同时公共 `/api/agent/config` 原样返回这些不可访问地址。注释声称“Codex 在 QC 后替换”，但正式设计实际是由 Worker Secret `SHAK_PMO_SKILL_SOURCE_COMMIT` 在 `getSkillDistribution()` 动态计算固定 URL；因此该配置会误导任何直接读取 Bundle 或公共配置的 Agent。

### L4 必须返工项

1. `agent.config.json` 的 `manifestUrl` 和全部 `files.*.url` 改为 Bundle 内相对路径（例如 `manifest.json`、`SKILL.md`、`references/tool-contract.md`）；不再出现 `<COMMIT>`。
2. 改写该配置的 note：固定 GitHub raw commit URL 只由登录后的 `/api/agent/install` 或 MCP `get_capabilities` 的 `skillBundle.bundleRoot` 提供，Agent 使用相对路径和该 root 拼接下载地址。
3. `src/mcp/config.ts` 与 `/api/agent/config` 保持相对路径契约，不能再向公网返回 `<COMMIT>` 伪 URL。
4. `scripts/validate-skill-consistency.mjs` 新增明确校验：Bundle 配置与 `/api/agent/config` 的配置来源不得含 `<COMMIT>`；所有 files URL 必须是相对具体文件路径，且与 manifest 文件表相匹配。
5. 在 `scripts/real-mcp-test.mjs` 新增 E2E 断言：`/api/agent/config` 不含 `<COMMIT>`；`get_capabilities` 返回 40 位 sourceCommit 与可用固定 GitHub raw `bundleRoot`（测试环境须注入合法测试 SHA）；登录后的安装文案用该 bundleRoot。

禁止 deploy、secret、D1/R2、Git push，且必须重跑完整 WP-007A 验收命令；最终状态只能为 `implemented, pending PM/QC review`。

---

## L5 四轮 QC 结论｜2026-07-30

- **QC 结论：L5 rework required（不通过）**

### 已通过的独立复验

L4 已把 Bundle 配置改为相对路径，`<COMMIT>` 伪 URL 已消失；完整命令回归（语法、18 项一致性、单测、E2E、构建、diff）均通过。

### 仍未关闭的 P0 缺陷

1. `get_capabilities.skillBundle.files` 从 `AGENT_CONFIG.files` 映射，现只返回 5 个内容文件，**遗漏 `manifest.json`**。完整 Bundle 明确定义为 6 个受管文件加 manifest；Agent 无法据此完成完整下载和校验。
2. `scripts/real-mcp-test.mjs` 虽注入了合法测试 SHA，却没有断言：`/api/agent/config` 无 `<COMMIT>`、`get_capabilities` 返回该 40 位 SHA 与固定 raw `bundleRoot`、登录安装文案包含同一 root。L4 要求的动态发布链路 E2E 未实际交付。

### L5 必须返工项

1. 在 `get_capabilities.skillBundle.files` 中显式包含 `AGENT_CONFIG.manifestPath`，并确保去重、排序后恰为 6 个路径。
2. 在 `scripts/real-mcp-test.mjs` 增加可见的独立断言：
   - `/api/agent/config` 不含 `<COMMIT>`，且 `manifestPath === 'manifest.json'`；
   - `get_capabilities` 返回注入的 40 位测试 SHA、以该 SHA 为路径段的 raw GitHub `bundleRoot`、以及含 manifest 的 6 文件清单；
   - 登录后的 `/api/agent/install` 三段文案至少 Codex/Cursor 含同一 `bundleRoot` 与 `manifestUrl`。
3. 一致性脚本必须断言 `manifestPath` 存在于生成 manifest 且 `manifest.files` 仍含完整 6 项。
4. 重跑完整验收命令。不得 deploy、secret、D1/R2、Git push；最终状态只能为 `implemented, pending PM/QC review`。

---

## L6 五轮 QC 结论｜2026-07-30

- **QC 结论：L6 rework required（不通过）**

### 发现的真实安装阻断

L5 将 `manifest.json` 加入 `manifest.files`，但该条目只有 `note`、没有 `sha256`。现有 Codex 与 Cursor 一键安装脚本遍历 `manifest['files']`，对每项执行 `meta['sha256']`；因此下载到 `manifest.json` 这一项时将抛 `KeyError: 'sha256'`，安装必然失败。L5 E2E 仅检查文案字符串，没有执行该安装脚本，因此未发现该问题。

同时，L5 将 `agent.config.json` 排除出 Bundle 受管文件，与 WP-007A 原 scope 明确要求“完整 Bundle 包含 `agent.config.json`”冲突。

### 不可变的最终 Bundle 合同（后续不得再自行改口径）

1. **内容清单 `manifest.files` 只能包含 6 个可 SHA-256 校验的内容文件：**
   `SKILL.md`、`agent.config.json`、`shak-project-portfolio-governance.mdc`、`references/tool-contract.md`、`references/governance-rules.md`、`agents/openai.yaml`。
2. `manifest.json` 是第 7 个元数据文件，不得放进其自身的 `files` 哈希清单；安装器先下载 manifest、下载并校验上述 6 项，再将已下载 manifest 原样写入安装目录。
3. `get_capabilities.skillBundle.files` 可另行列出安装包的 7 个物理文件（6 内容文件 + `manifest.json`），但必须明确其为 package 文件清单，不能被安装器当作 hash 清单使用。
4. Bundle 内所有路径继续使用相对路径；真实固定 raw root 只由 `SHAK_PMO_SKILL_SOURCE_COMMIT` 动态生成，Cursor 不填真实 SHA。

### L6 必须返工项

1. 恢复 `agent.config.json` 为受管、可校验内容文件。
2. 从 `manifest.files` 删除 `manifest.json` 自引用条目；恢复其余 6 项均含 `path`、`sha256`、`bytes`。
3. `get_capabilities.skillBundle.files` 返回完整 7 项（六内容文件加 manifest），并在字段或注释中清楚说明 `manifest.files` 仅为六项内容校验清单。
4. 更新校验脚本：断言 manifest 哈希清单恰为六项且全有 SHA-256；断言 `get_capabilities` 的 package 清单恰为七项。
5. 在真实 E2E 中**实际执行或等效执行**安装器下载/校验逻辑，至少覆盖“遍历 manifest.files 的每项均存在 sha256”及“manifest 原样写入本地目录”，不得仅检查文案包含字符串。
6. 重跑完整命令并报告。不得 deploy、secret、D1/R2、Git push；最终状态只能为 `implemented, pending PM/QC review`。

---

## L6 最终 QC 通过｜2026-07-30

- **QC 结论：accepted, pending Human Owner / production release**

PM/QC 已独立复验：`node --check scripts/mcp-test.mjs`、22 项一致性校验、`npm run lint`、12 项单测、`npm run skill:build`、36 项真实 Worker E2E、`npm run build` 与 `git diff --check` 全部通过。

最终合同已满足：manifest 哈希清单恰有 6 个可校验内容文件（含 `agent.config.json`、不含 manifest 自身）；`get_capabilities` 物理安装包清单恰有 7 项；测试注入的固定 SHA、raw Bundle root、安装文案、Bearer、登录与实际安装器遍历逻辑均已验证。

后续由 Codex 执行 Git commit/push、以新不可变 commit 更新 Worker `SHAK_PMO_SKILL_SOURCE_COMMIT`、生产部署及真机安装回归。Cursor 不再返工。
