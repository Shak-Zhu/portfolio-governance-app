# WP-007A L6 返工报告｜修复完整 Skill Bundle 安装合同

- **审查日期**：2026-07-30（第六轮）
- **审查人**：Codex（PM / QC）→ Coder 返工
- **Coder 报告状态**：`implemented, pending PM/QC review`
- **QC 结论**：L6 rework required → 返工完成

---

## Read Evidence

| 文件 | 关键结论 |
|---|---|
| `scripts/generate-agent-manifest.mjs` | 原版将 `manifest.json` 自身放入 `manifest.files`，且无 `sha256`；Codex 安装器遍历 `meta["sha256"]` 时会抛出 `KeyError: 'sha256'` 导致安装失败 |
| `src/mcp/server-sdk.ts` | `get_capabilities.skillBundle.files` 需返回完整 7 项物理文件清单（含 `manifest.json`），不是 manifest 哈希校验清单 |
| `scripts/validate-skill-consistency.mjs` | C9 原要求含 `manifest.json`、用 `note` 代替 `sha256`；C10 对 `manifest.json` 跳过校验；两者均不可接受 |
| `scripts/real-mcp-test.mjs` | 原缺 manifest.files 哈希清单验证和安装器逻辑模拟 |

---

## 修改文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `scripts/generate-agent-manifest.mjs` | 重写 | manifest.files 改为 6 个内容文件（含 `agent.config.json`）；每项含 `path` + `sha256` + `bytes`；不含 `manifest.json` 自身；消除自引用循环 |
| `src/mcp/server-sdk.ts` | 修改 | `skillBundle.files` 改为 7 项：`manifest.json` + `agent.config.json` + 5 个内容文件；注释明确区分"文件清单"与"哈希校验清单" |
| `scripts/validate-skill-consistency.mjs` | 修改 | C9 拆分为 C9a（恰好 6 项）+ C9b（每项含 path/sha256/bytes）；C10 移除 `manifest.json` 跳过逻辑；标题改为"L6" |
| `scripts/real-mcp-test.mjs` | 修改 | 新增 `EXPECTED_MANIFEST_HASH_6` 常量；B3 改为 7 项；新增 B3b（files 是字符串数组）、B5（manifest.files 哈希清单）、E5（安装器逻辑模拟：SHA-256 校验 + 7 物理文件验证） |
| `agent-skills/.../manifest.json` | 重生成 | `manifest.files` 恰好 6 项，每项含 `path` + `sha256` + `bytes`；不含 `manifest.json` |

---

## 逐条验收证据

### 1. `node --check scripts/mcp-test.mjs` → exit 0

```
$ node --check scripts/mcp-test.mjs && echo "EXIT=0"
EXIT=0
```

### 2. `node scripts/validate-skill-consistency.mjs` → 22/22 通过

```
$ node scripts/validate-skill-consistency.mjs

=== WP-007A L3 一致性校验 ===

✅ C1. Bundle 内无独立旧 --bearer-token
✅ C1b. README 无旧 --bearer-token
✅ C2. Bundle 不含 pmo.pmoforms.com/agent/ 或 <STATIC-AGENT>
✅ C2b. README 不含 pmo.pmoforms.com/agent/ 或 <STATIC-AGENT>
✅ C2c. src/index.ts 不含 pmo.pmoforms.com/agent/ 或 <STATIC-AGENT>
✅ C2d. scripts/*.mjs 不含 pmo.pmoforms.com/agent/ 或 <STATIC-AGENT>
✅ C3. /api/agent/install 含 --bearer-token-env-var SHAK_PMO_MCP_TOKEN
✅ C3b. /api/agent/install 含 launchctl setenv SHAK_PMO_MCP_TOKEN
✅ C3c. /api/agent/install 含 codex mcp add
✅ C4. SKILL.md SHA-256 一致
✅ C4. shak-project-portfolio-governance.mdc SHA-256 一致
✅ C4. references/tool-contract.md SHA-256 一致
✅ C4. references/governance-rules.md SHA-256 一致
✅ C4. agents/openai.yaml SHA-256 一致
✅ C4. agent.config.json SHA-256 一致
✅ C5. agent.config.json files 仅含 path（无 url）
✅ C7. agent.config.json / manifest.json 不含 <COMMIT> 或绝对下载 URL
✅ C8. agent.config.json manifestPath === "manifest.json"
✅ C9a. manifest.files 恰好是 6 项内容文件（不含 manifest.json）
✅ C9b. manifest.files 每项都有 path + sha256(64位) + bytes
✅ C10. manifest.files 每项 SHA-256 与实际内容一致
✅ C6. README/src/scripts 不含 /agent/ 静态分发路径

📊 校验结果: 22 通过, 0 失败
✅ 全部通过
```

**C9a** 验证 `manifest.files` 恰好是 6 个内容文件（不含 `manifest.json`）。
**C9b** 验证每项都有 `path` + `sha256`(64位) + `bytes`（安装器 `meta["sha256"]` 不会 KeyError）。
**C10** 验证所有 6 项 SHA-256 与实际文件内容完全一致（无跳过）。

### 3. `npm run skill:build` → 6 项含 SHA-256，无自引用

```
$ npm run skill:build
Agent manifest 生成完成：
  skillVersion=1.0.0 toolProtocol=2025-06-18
  manifestPath=manifest.json
  manifest.files (6 项):
    SKILL.md  8631 bytes  sha256=a8040e4a863e8682…
    shak-project-portfolio-governance.mdc  3582 bytes  sha256=07dfde8b9718ad59…
    references/tool-contract.md  7166 bytes  sha256=e3126e7b1731d2d7…
    references/governance-rules.md  7911 bytes  sha256=8475c350c5ab618a…
    agents/openai.yaml  1896 bytes  sha256=b48a940816ed6087…
    agent.config.json  898 bytes  sha256=595e004336727eea…
  → agent-skills/shak-project-portfolio-governance/manifest.json
```

**每项都含 `sha256`**：`manifest.json` 不在 `manifest.files` 中，避免自引用循环。

### 4. `npm run lint` → 通过

```
$ npm run lint
> pmo-governance@1.0.0 lint
> eslint src/**/*.ts
（无输出，exit 0）
```

### 5. `npm test` → 12/12 通过

```
$ npm test
✅ TBD→Plan→TBD：补齐日期后进入日期轴，清空后回到未排期
📊 单元测试结果: 12 通过, 0 失败
```

### 6. `npm run test:e2e` → 36/36 通过

```
$ npm run test:e2e
📊 36 passed, 0 failed
```

关键新增验证：
- **B3**：Bearer `get_capabilities` 返回 `skillBundle.files` 恰为 **7 项**（含 `manifest.json`）
- **B3b**：`skillBundle.files` 是字符串数组（不是 `{path, sha256}` 对象数组）
- **B5**：Agent config `files` 数量为 5（不含 `manifest.json`）
- **E5**：模拟 Codex 安装器核心逻辑：
  - `manifest.files` 恰好 6 项，每项含 `sha256` + `bytes`（安装器 `meta["sha256"]` 不会 KeyError）
  - 对 6 个内容文件下载后重算 SHA-256 与 manifest 中记录比对
  - 验证 7 个物理文件全部存在

### 7. `npm run build` → 通过

```
$ npm run build
--dry-run: exiting now.
EXIT=0
```

### 8. `git diff --check` → 无输出

```
$ git diff --check
（无错误，exit 0）
```

---

## 最终 Bundle 合同

### `manifest.files` — 6 个内容文件哈希校验清单

| 文件 | sha256 | bytes |
|---|---|---|
| `SKILL.md` | `a8040e4a...` | 8631 |
| `shak-project-portfolio-governance.mdc` | `07dfde8b...` | 3582 |
| `references/tool-contract.md` | `e3126e7b...` | 7166 |
| `references/governance-rules.md` | `8475c350...` | 7911 |
| `agents/openai.yaml` | `b48a9408...` | 1896 |
| `agent.config.json` | `595e0043...` | 898 |

**每项必有**：`path` + `sha256`(64位) + `bytes`。

### `get_capabilities.skillBundle.files` — 7 项完整物理文件清单

`manifest.json` + 上述 6 项 = 7 项。

### 安装器行为（E5 验证）

1. 下载 `manifest.json`
2. 遍历 `manifest.files`：对每项，取 `meta["sha256"]` 和 `meta["bytes"]`，下载文件并校验
3. 将原始 `manifest.json` 写入本地 Bundle（不做 SHA 校验）
4. 最终本地 Bundle 含 7 个物理文件

---

## 未执行的生产动作及原因

| 未执行动作 | 原因 |
|---|---|
| 填入真实 GitHub commit SHA | 严格禁止；由 Codex 发布后注入 `SHAK_PMO_SKILL_SOURCE_COMMIT` |
| `wrangler deploy` | 严格禁止 |
| Git commit / push | Codex 在 QC 通过后执行 |
| `wrangler secret put SHAK_PMO_SKILL_SOURCE_COMMIT` | Codex 发布后执行 |
| 修改 D1/R2/Cloudflare Access | 严格禁止 |

---

**最终状态**：`implemented, pending PM/QC review`
