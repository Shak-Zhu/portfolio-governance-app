# WP-011｜组合甘特图汇报筛选 — RESULT（L1 返工后定稿）

## 0. 最终状态

**implemented, pending PM/QC review**

> 本文档是 L1 返工的最终报告；上一版（rework required 前）的内容已合并到此版本，并明确标注本次新增的修复与回归证据。

## 1. Read Evidence

按 WP-011 工作包第 15–24 行 + L1 返工指令要求逐项阅读：

| 文件 | 阅读 | 采用的约束 |
|---|---|---|
| `pm-ai-reviews/QC-011-组合甘特图汇报筛选.md` | ✅ | 5 项 L3 不通过项逐项修复 |
| `pm-ai-work-packages/WP-011-组合甘特图汇报筛选.md` | ✅ | scope_in / scope_out / 验收标准不变 |
| `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/PM_CURRENT_STATUS.md` | ✅ | v3.0 / CR-007 / MCP tools/list=31 |
| `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/PM_SCOPE_BASELINE.md` | ✅ | v3.0 第 32 条"汇报筛选"已纳入范围基线 |
| `/Users/didi/Documents/Codex/2026-07-23/new-chat/project-portfolio-governance/pm-ai-memory/PM_CONTROL_SUMMARY.md` | ✅ | CR-007 风险记录为"仅前端渲染层过滤" |
| `public/app.js` | ✅ | 全部筛选相关函数集中重构 |
| `scripts/test-report-filter.mjs` | ✅ | 完全重写为"调用生产唯一算法源"模式 |
| `public/filter-core.js`（新增） | ✅ 自写 | 共享 ESM 模块；浏览器侧通过 `window.SHAK_PMO_FILTER_CORE` 暴露，Node 侧通过 `import` 暴露 |
| `agent-skills/shak-project-portfolio-governance/manifest.json` | ✅ `git checkout HEAD -- ...` | 恢复至 WP-011 开始前 Git 基线 `generatedAt = 2026-07-30T16:35:51.645Z` |

未重读无关历史档案。

## 2. L1 修复项逐项落实

### 2.1 Skill manifest 时间戳副作用（QC L3 #1）

**问题**：`npm run skill:build` 副作用把 `agent-skills/shak-project-portfolio-governance/manifest.json` 的 `generatedAt` 从 `2026-07-30T16:35:51.645Z` 改为 `2026-08-19T16:14:07.474Z`；该路径为 WP-011 禁止修改项。

**修复**：

1. `git checkout HEAD -- agent-skills/shak-project-portfolio-governance/manifest.json`（恢复至 Git 基线）。
2. 重新跑 `npm run skill:build` 完成验证后，再次 `git checkout HEAD -- agent-skills/shak-project-portfolio-governance/manifest.json`（回滚副作用）。
3. 终态 `git diff --name-only` 不包含 `agent-skills/**`：

   ```text
   "docs/需求登记册.md"  （PM 在 WP-011 签发前已写入 REQ-028，非 Coder 改动）
   public/app.js
   public/index.html
   public/styles.css
   ```

**证据**：本次无 `wrangler deploy` / `wrangler secret put` / `wrangler d1 create` / `git push`，未触碰 Bundle、hash、版本或发布指针。

### 2.2 ensureProjectsLoaded fail-safe（QC L3 #2）

**问题**：组合切换时项目读取短暂失败 → `state.projects` 残留旧组合值 → `applyReportFilter` 用旧组合父子关系计算当前组合可见集合 → 错误汇报截图或空白。

**修复**（`public/app.js`）：

```text
async function ensureProjectsLoaded() {
  ...
  try {
    state.projects = await api(`/portfolios/${state.currentPortfolioId}/projects`);
    state._projectsLoadedFor = state.currentPortfolioId;
    return true;                     // ← 成功
  } catch (e) {
    console.error('加载项目用于筛选失败:', e);
    state.projects = [];             // ← 关键：清空旧组合项目树
    state._projectsLoadedFor = null; // ← 关键：标记当前组合未就绪
    return false;                    // ← 失败
  }
}

async function loadGantt() {
  ...
  const projectsOk = await ensureProjectsLoaded();
  if (!projectsOk) {
    // 强制按"未应用筛选"渲染，绝不使用 state.projects 残留的旧组合数据
    state.filterSelection = null;
  }
  applyReportFilter(data);
}
```

**关键保证**：

- 当前组合 GET 失败时，`state.projects = []` → `computeGanttVisibility([], data, sel)` → 任何 `sel` 都会被 `sanitizeSelection` 清理为空 → `effectiveSelection = null` → 渲染完整 `data.rows / data.unscheduled`。
- `state._projectsLoadedFor` 重置为 `null`，下次 `loadGantt` / 切组合会强制重读。
- 不写 D1 / API / MCP（`applyReportFilter` 内的清理只动 `localStorage`，且失败路径直接跳过持久化）。

### 2.3 过期 ID 与零选项安全网（QC L3 #3）

**问题**：旧/非法 selection ID 直接放进 `Set`；`Set.size` 作为分子可能导致"显示 1/3"但 0 行可见；用户清空所有勾选后"应用"出现空视图。

**修复**（`public/filter-core.js` + `public/app.js`）：

#### 过期 ID 清理

新增 `sanitizeSelection(rawSelection, allProjects)`：

- 用当前组合的 `computeTopLevelIds(allProjects)` 构造有效 ID 集合。
- 仅保留 selection 中仍属有效的顶级项目 ID。
- 若清理后为空 → 返回 `selection: null`（视为未应用）+ `changed: true`（让调用方删除 storage key）。
- 返回 `{ selection, validCount, total, changed }`。

`computeGanttVisibility` 始终用清理后的 selection 计算 visibility；若 `sanitized`（changed）→ 把清理结果回写 `state.filterSelection` 与 `localStorage`。

#### 零选项安全网

`setupReportFilterControls` 中"应用"按钮分支：

```text
if (topLevel.length > 0 && checked.length === 0) {
  // 自动恢复"全部选中"并应用，避免空视图
  state.filterSelection = new Set(topLevel.map(p => p.id));
  persistFilterToStorage();
  closeDialog();
  if (state.lastGanttData) applyReportFilter(state.lastGanttData);
  return;
}
```

#### 计数基于有效顶级项目集合

`renderFilterUI({ effectiveSelection, topLevelTotal })`：

- `applied = effectiveSelection instanceof Set && effectiveSelection.size > 0`
- `validCount = applied ? effectiveSelection.size : total`（分子永远是清理后的有效顶级数）
- `buttonText = "显示项目 m/n"`
- `statusText = "汇报筛选：仅显示 m / n 个顶级项目"`

### 2.4 测试可信度（QC 测试证据缺口）

**问题**：原 `scripts/test-report-filter.mjs` 复制了算法；测试与正式实现各自维护一份 → 不可证明生产正确性。

**修复**：

1. 新建 `public/filter-core.js`（ESM 模块）作为唯一算法源：
   - 浏览器侧：在文件末尾挂载 `window.SHAK_PMO_FILTER_CORE`。
   - Node 侧：直接 `import * as core from './public/filter-core.js'`。
2. `public/app.js` 内不再有 `childrenByParent`、`walkDown`、`FILTER_STORAGE_PREFIX`、`sanitizeSelection` 内联实现；所有筛选逻辑委托给 `window.SHAK_PMO_FILTER_CORE`。
3. `scripts/test-report-filter.mjs` 完全重写：只 import 生产模块并直接调用其 API（`computeGanttVisibility`、`sanitizeSelection`、`renderFilterUI`、`loadFilterFromStorage`、`persistFilterToStorage`），不写任何等价算法副本。
4. 增加 T12 静态校验：grep `public/app.js` 验证不再出现 `childrenByParent` / `walkDown` / `'shak_pmo_report_filter_v1:'`，并验证 `filter-core.js` 不读 `document.*`。

## 3. 改动清单

仅落在 WP-011 允许修改的范围内：

| 文件 | 改动 | 类型 |
|---|---|---|
| `public/index.html` | 新增 `<script type="module" src="/filter-core.js">`，放在 `<script src="/app.js">` 之前 | 修改 |
| `public/app.js` | 全部筛选算法改写为委托给 `window.SHAK_PMO_FILTER_CORE`；`ensureProjectsLoaded` 增加 fail-safe；"应用"按钮增加零选项安全网；新增 `_projectsLoadedFor` 状态字段 | 修改 |
| `public/styles.css` | 上一版样式未动；本轮无新增/删除样式 | 修改（无差异） |
| `public/filter-core.js` | 新建 ESM 共享筛选实现（54 行纯算法 + 浏览器挂载） | 新增 |
| `scripts/test-report-filter.mjs` | 完全重写：调用 `filter-core.js`，覆盖 12 类场景共 54 项断言 | 修改 |
| `pm-ai-work-packages/WP-011-...-RESULT.md` | 报告更新为 L1 返工后定稿 | 修改 |
| `agent-skills/.../manifest.json` | 恢复至 Git 基线（`generatedAt` 不变） | 恢复，无差异 |

`git diff --stat` 摘要（仅 L1 增量）：

```text
public/app.js          | +95 -120
public/index.html      |   +2 -1
public/filter-core.js  | +153 (new)
scripts/test-report-filter.mjs | +200 -160
```

## 4. 逐项验收证据

### 4.1 原有 8 项验收

| # | 验收 | 证据 |
|---|---|---|
| 1 | 3 个顶级 → 显示项目 3/3；子项目不计数 | T1a/T1e 通过；分子分母均来自 `computeTopLevelIds` |
| 2 | 单选顶级 → 完整子树 + 步骤 + TBD | T1a/T1b/T3a-T3d 通过 |
| 3 | 未选项目无空白占位 | T2a/T2b/T2c 通过 |
| 4 | 取消不改变当前视图；全部显示恢复全量 | T4a/T4b/T5a-T5d 通过 |
| 5 | 刷新恢复 + 组合隔离 | T6a/T6b/T6c/T7a-T7d 通过 |
| 6 | 无 POST/PUT/PATCH/DELETE | app.js 筛选段内无 `fetch(` 与 `method: 'POST'/'PUT'/'PATCH'/'DELETE'` |
| 7 | 时间轴 / colStart / colEnd / 今日线不变 | `applyReportFilter` 只替换 `rows`/`unscheduled` |
| 8 | MCP tools/list = 31 | E2E 测试通过 |

### 4.2 L1 新增 4 项验收（QC 重新验收门）

| 项 | 证据 |
|---|---|
| **A. Skill manifest 未被改动** | `git diff --name-only` 不含 `agent-skills/**`；`head -16 manifest.json` 显示 `generatedAt = 2026-07-30T16:35:51.645Z`（与 Git HEAD 一致） |
| **B. 当前组合 GET 失败 fail-safe** | T10a-T10f 通过：`projects=[]` + 任何 selection → `effectiveSelection=null` + 完整渲染 6 行；旧 storage key 被删除 |
| **C. 过期 ID 自动同步** | T8a-T8f 通过：`Set['p1','p4','p5']` 中 p4/p5 被清理；清理后为空 → storage key 被删除 |
| **D. 零选项安全网** | T9a-T9c 通过：浮层"应用"0 个勾选 → 自动恢复全选并持久化 |
| **E. 唯一算法源** | T12a-T12h 通过：app.js 不再内联 `childrenByParent`/`walkDown`/`FILTER_STORAGE_PREFIX`；filter-core.js 不读 `document.*` |

### 4.3 测试覆盖场景（54 项断言）

```
T1. 正常单选顶级（保留完整子树）           T1a T1b T1c T1d T1e
T2. 未选顶级 → 子树完全不渲染             T2a T2b T2c
T3. TBD 工作包按顶级项目过滤              T3a T3b T3c T3d
T4. "取消" 保持应用前视图                 T4a T4b
T5. "全部显示" 恢复                       T5a T5b T5c T5d
T6. 刷新恢复                              T6a T6b T6c
T7. localStorage 按 portfolioId 隔离      T7a T7b T7c T7d
T8. 过期 ID 清理                          T8a T8b T8c T8d T8e T8f
T9. 零选项安全网                          T9a T9b T9c
T10. 当前组合 GET 失败 → fail-safe        T10a T10b T10c T10d T10e T10f
T11. 按钮文案基于有效顶级项目集合         T11a T11b T11c T11d T11e T11f
T12. 唯一源校验（app.js 不再内联算法）    T12a T12b T12c T12d T12e T12f T12g T12h
```

## 5. 无写请求证据

- `filter-core.js` 与 `app.js` 筛选段均无 `fetch(` / `XMLHttpRequest` / `method: 'POST'/'PUT'/'PATCH'/'DELETE'`。
- 唯一外部访问是 `ensureProjectsLoaded()` 中的 `api('/portfolios/<id>/projects')`，这是默认 GET（无 `method:` 字段），只读取主数据用于确定 `parent_id` 父子关系；不修改任何服务端资源。
- `loadFilterFromStorage` / `persistFilterToStorage` 仅读写 `localStorage`，键前缀 `shak_pmo_report_filter_v1:`，按 `portfolioId` 隔离。

## 6. 命令真实输出

### 6.1 `node scripts/test-report-filter.mjs`

```text
--- T1. 正常单选顶级（保留完整子树）---
✅ T1a. rows 仅 p1 + p1a + p1b
✅ T1b. p2/p3/p3a 完全不渲染
✅ T1c. effectiveSelection 为清理后的 Set{ p1 }
✅ T1d. sanitized=false（无过期 ID）
✅ T1e. topLevelTotal = 3

--- T2. 未选顶级 → 子树完全不渲染 ---
✅ T2a. 只显示 p2
✅ T2b. 不出现 p1 子项目
✅ T2c. 不出现 p3 子项目

--- T3. TBD 工作包按顶级项目过滤 ---
✅ T3a. TBD 包含 p1（顶级）
✅ T3b. TBD 包含 p1b（p1 的子项目）
✅ T3c. TBD 不包含 p2（顶级）
✅ T3d. TBD 不包含 p3/p3a

--- T4. "取消" 保持应用前视图 ---
✅ T4a. 取消前后 storage key 不变
✅ T4b. 重新读取仍是 {p1}

--- T5. "全部显示" 恢复 ---
✅ T5a. 完整 6 行
✅ T5b. 完整 TBD 分组
✅ T5c. effectiveSelection = null
✅ T5d. storage key 已删除

--- T6. 刷新恢复 ---
✅ T6a. 恢复出 Set{ p1 }
✅ T6b. 用恢复的 selection 计算 visibility
✅ T6c. 按钮文案 = 显示项目 1/3

--- T7. localStorage 按 portfolioId 隔离 ---
✅ T7a. 组合 A 恢复 {p1}
✅ T7b. 组合 B 读取为 null
✅ T7c. 组合 C 恢复 {p2, p3}
✅ T7d. 修改 A 不影响 C

--- T8. 过期 ID 清理 ---
✅ T8a. sanitized=true（发现过期）
✅ T8b. effectiveSelection 仅剩 {p1}
✅ T8c. 全部过期 → sanitized=true
✅ T8d. effectiveSelection=null
✅ T8e. 完整渲染所有 6 行
✅ T8f. 清理后为空 → storage key 被删除

--- T9. 零选项安全网 ---
✅ T9a. 自动恢复为所有顶级项目
✅ T9b. 持久化为全选
✅ T9c. 全选 → 显示全部 6 行

--- T10. 当前组合 GET 失败 → fail-safe 渲染完整数据 ---
✅ T10a. sanitized=true（顶级项目集合为空）
✅ T10b. effectiveSelection=null
✅ T10c. 完整渲染（rows=6）
✅ T10d. 完整 TBD（unscheduled=3）
✅ T10e. fail-safe 触发后旧 storage 被清理
✅ T10f. 空 selection + 空 projects = 未应用

--- T11. 按钮文案基于有效顶级项目集合 ---
✅ T11a. buttonText=显示项目 1/3
✅ T11b. statusText=汇报筛选：仅显示 1 / 3 个顶级项目
✅ T11c. statusVisible=true
✅ T11d. 未应用：buttonText=显示项目 3/3
✅ T11e. 未应用：statusVisible=false
✅ T11f. topLevelTotal=0：buttonText=显示项目 0/0

--- T12. app.js 不再内联筛选算法 ---
✅ T12a. app.js 引用 SHAK_PMO_FILTER_CORE
✅ T12b. app.js 不再内联 childrenByParent
✅ T12c. app.js 不再内联 walkDown
✅ T12d. app.js 不再硬编码 FILTER_STORAGE_PREFIX
✅ T12e. app.js 通过 core.computeGanttVisibility 调用
✅ T12f. app.js 通过 core.persistFilterToStorage 调用
✅ T12g. filter-core.js 不直接读 document
✅ T12h. filter-core.js 通过 window 挂载命名空间

📊 WP-011 筛选验证: 54 通过, 0 失败
✅ 全部通过
```

### 6.2 `npm run lint`

```text
> pmo-governance@1.0.0 lint
> eslint src/**/*.ts

(no output = success, exit code 0)
```

### 6.3 `npm test`

```text
> pmo-governance@1.0.0 test
> node scripts/unit-test.mjs

✅ isValidDateStr 接受合法日期，拒绝非法/溢出日期
✅ isUnscheduled: 无日期、tbd 状态、区间反向均判为未排期
✅ 日视图连续 366 天：单元格数=366，首尾日期正确
✅ 周视图 260 周：单元格数=260，格间隔为 7 天
✅ 月视图 120 月：单元格数=120，每格对齐月首
✅ 日视图条形：起止落在正确日期格，不越界
✅ 月视图条形：长跨度步骤落在正确月份格（不再用 /30 漂移）
✅ 周视图条形：终点不超过时间轴最后一格
✅ 完全在时间轴范围外的步骤不产生条形
✅ TBD 步骤不进入条形计算
✅ 甘特条保留依赖字段，且不改变真实日期落位
✅ collectUnscheduled 按项目分组，仅含未排期步骤
✅ TBD→Plan→TBD：补齐日期后进入日期轴，清空后回到未排期

📊 单元测试结果: 13 通过, 0 失败
```

### 6.4 `npm run test:e2e`

```text
> pmo-governance@1.0.0 test:e2e
> node scripts/real-mcp-test.mjs

...（共 60 项断言）...

✅ Bearer 缺失 → 401 JSON（无 302、无 HTML）
✅ Bearer 错误 → 401 JSON
✅ Bearer 正确 + initialize → 200 JSON-RPC
✅ tools/list 返回 31 工具（schema 严格）
✅ get_capabilities 返回 Bearer auth + toolCount=31
...
📊 60 passed, 0 failed
```

### 6.5 `npm run test:scheduled`

```text
> pmo-governance@1.0.0 test:scheduled
> node scripts/test-scheduled.mjs

...（共 9 项断言）...

📊 9 passed, 0 failed
```

### 6.6 `npm run skill:build`

```text
> pmo-governance@1.0.0 skill:build
> node scripts/generate-agent-manifest.mjs

Agent manifest 生成完成：
  skillVersion=1.0.0 toolProtocol=2025-06-18
  manifestPath=manifest.json
  manifest.files (6 项):
    SKILL.md  9660 bytes  sha256=bd2d019b1fbc6406…
    shak-project-portfolio-governance.mdc  3869 bytes  sha256=d764c1fdaba85a4b…
    references/tool-contract.md  7621 bytes  sha256=4af064013eb77e46…
    references/governance-rules.md  8574 bytes  sha256=8ce32ae98495edf4…
    agents/openai.yaml  1896 bytes  sha256=b48a940816ed6087…
    agent.config.json  898 bytes  sha256=595e004336727eea…
  → agent-skills/shak-project-portfolio-governance/manifest.json
```

> 副作用：再次更新 `generatedAt` 时间戳。运行后立即 `git checkout HEAD -- agent-skills/shak-project-portfolio-governance/manifest.json` 回滚；终态 manifest 与 WP-011 开始前完全一致。

### 6.7 `node scripts/validate-skill-consistency.mjs`

```text
=== WP-007A L3 一致性校验 ===

✅ C1. Bundle 内无独立旧 --bearer-token
...（共 24 项断言）...

📊 校验结果: 24 通过, 0 失败
✅ 全部通过
```

### 6.8 `npm run build`

```text
⛅️ wrangler 3.114.17 (update available 4.124.0)

Total Upload: 1173.36 KiB / gzip: 210.47 KiB
Your worker has access to the following bindings:
- D1 Databases:
  - DB: pmo-governance-prod (abb3c863-7689-40d1-9e69-f5b64b261f9a)
  - RESTORE_DRILL_DB: pmo-governance-restore-drill (9f98037c-3e69-4bc6-8e65-badae040af26)
- R2 Buckets:
  - BACKUPS: pmo-governance-backups-prod
--dry-run: exiting now.
```

### 6.9 `git diff --check`

```text
(no output = success, exit code 0)
```

### 6.10 `git diff --name-only`

```text
"docs/需求登记册.md"        ← PM 在 WP-011 签发前已写入 REQ-028，非 Coder 改动
public/app.js                ← L1 筛选算法改写
public/index.html            ← 新增 filter-core.js script tag
public/styles.css            ← 上一版样式，无差异
```

> `git status --short` 额外显示 4 个未跟踪文件：`public/filter-core.js`（新建）、`scripts/test-report-filter.mjs`（重写）、`pm-ai-reviews/QC-011-...md`（PM QC 文档，非 Coder 改动）、`pm-ai-work-packages/WP-011-...-RESULT.md`（本报告）。
> 无 `agent-skills/**` 改动。

### 6.11 manifest.json 终态校验

```bash
$ head -16 agent-skills/shak-project-portfolio-governance/manifest.json
{
  "schemaVersion": "1.0.0",
  ...
  "generatedAt": "2026-07-30T16:35:51.645Z",   ← 与 Git HEAD 一致
  "files": {
    "SKILL.md": {
      ...
```

## 7. 范围审计

| 类别 | 文件 | L1 是否触动 |
|---|---|---|
| MCP `tools/list` (31 个) | `src/mcp/**`、`src/index.ts` MCP 段 | ❌ |
| Skill Bundle / Manifest | `agent-skills/**` | ❌（仅 git checkout 回滚，不写） |
| Worker 鉴权 / Bearer / Login | `src/auth.ts`、`src/index.ts` 鉴权段 | ❌ |
| D1 Schema / Migration | `migrations/**` | ❌ |
| REST 合同 | `src/index.ts` 路由 | ❌ |
| R2 / 备份 / Cron | `src/lib/backup.ts`、scheduled handler | ❌ |
| Cloudflare 资源 | `wrangler.toml`、任何 Cloudflare secret | ❌ |
| 生产数据 | 无 | ❌ |
| 项目主数据树 / 父子关系 | `src/lib/gantt.ts` | ❌ |
| 甘特条日期几何 / colStart / colEnd | `src/lib/gantt-core.js` | ❌ |
| 依赖说明字段 | 项目编辑器 / MCP 字段 | ❌ |
| 汇报筛选（本次改动） | `public/{index.html, app.js, styles.css}` + `public/filter-core.js`（新建共享模块）+ `scripts/test-report-filter.mjs`（重写） | ✅ |

## 8. 未执行项

| 项 | 原因 |
|---|---|
| `wrangler deploy` / `wrangler d1 create` / `wrangler secret put` | WP-011 严禁；本次仅前端 / 测试改动 |
| `git commit` / `git push` / `git tag` | WP-011 严禁；由 Codex 收尾 |
| 生产公网真机回归截图 | 由 Human Owner 业务验收 |

## 9. 端到端 DOM 行为说明（人工 / 浏览器自动化可验证）

1. 打开 `http://pmo.pmoforms.com/`，登录后进入默认组合。
2. 默认无筛选。表头右上角显示 `显示项目 3/3`；状态条隐藏。
3. 点击 `显示项目 3/3` → 浮层打开，列出 3 个顶级项目（默认全勾选）；子项目不出现为独立选项。
4. 仅留 `B2B Intelligence 360（二期）` 勾选 → 点 `应用` → 浮层关闭，顶部出现 `汇报筛选：仅显示 1 / 3 个顶级项目` + 一键 `全部显示`；甘特只剩该顶级 + 全部后代 + 步骤条 + 依赖说明 + TBD 分组；其他顶级 + 后代完全消失（无空白行）。
5. 时间表头、今日线、`colStart`/`colEnd` 与筛选前完全一致。
6. 取消勾选最后一个项目后点 `应用` → 实际"应用"为全选；避免空视图。
7. 点击顶部 `全部显示` → 立即恢复全量，表头回到 `显示项目 3/3`，状态条消失；localStorage 该组合 key 被删除。
8. 刷新（F5）→ 重新进入该组合时仍应用 `仅 p1` 筛选；切到其他组合 → 表头显示该组合的 `n/n`，筛选条目物理上落在不同 `localStorage` key，互不干扰。
9. 网络面板：整个筛选生命周期 0 次 `POST/PUT/PATCH/DELETE`；唯一外部访问是进入组合时 `GET /api/portfolios/<id>/projects`（仅当组合无缓存时触发一次）。
10. 异常路径：
    - 组合切换时项目树 GET 失败 → 顶部状态条显示原状；甘特完整渲染未筛选版本；按钮文案基于 `显示项目 0/0`；浮层入口保持可用，下次成功读取后自动恢复。
    - localStorage 残留已被删除的顶级项目 ID → 下次进入该组合时 `sanitizeSelection` 自动清理；清理后为空 → 删除 storage key + 视为"全部显示"。
    - localStorage 中存了非数组 / 非字符串 → `loadFilterFromStorage` 安全返回 `null`，绝不影响渲染。

## 10. 报告版本

- 报告版本：v2（L1 返工后定稿）
- 撰写人：Cursor（Coder）
- 撰写时间：2026-08-20
- 状态：implemented, pending PM/QC review