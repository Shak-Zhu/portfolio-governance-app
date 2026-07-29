# 工作包 WP-005 结果报告｜TBD 未排期工作包、时间轴可靠性与系统命名

- 工作包：WP-005
- 接收人：Cursor（Coder）
- 对应需求：REQ-017、REQ-018、REQ-019
- 最终状态：**implemented, pending PM/QC review**

## 一、Read Evidence（阅读证据与关键结论）

| # | 文件 | 关键结论 |
|---|------|----------|
| 1 | `pm-ai-work-packages/WP-005-TBD规划包与时间轴可靠性.md` | 三大交付：系统统一命名、TBD 未排期区、长时间轴可靠性；禁止 deploy 与改生产资源；状态只能写 implemented, pending PM/QC review |
| 2 | `pm-ai-work-packages/WP-002A-WebApp-D1-核心-QC.md` | 既有 QC 关注点：migration 幂等、Stage 保护、步骤去重、静态资源服务；WP-005 需保持不回退 |
| 3 | `docs/项目章程.md` | 系统正式名称为“Shak 项目组合治理系统”；以用户维护的项目主数据自动生成组合甘特图 |
| 4 | `docs/生产架构.md` | 生产资源标识：Worker `pmo-governance`、D1 `pmo-governance-prod`、域名 `pmo.pmoforms.com`、R2 `pmo-governance-backups-prod`（这些不得改名） |
| 5 | `docs/需求登记册.md` | REQ-017 TBD 未排期区、REQ-018 时间轴可靠性、REQ-019 系统命名，均为 approved |
| 6 | `PM_CURRENT_STATUS.md` | 命名变更为已批准 CR；WP-005 为当前 P0 开发包 |
| 7 | `PM_SCOPE_BASELINE.md` | 命名统一属批准范围；技术资源标识不随命名变更 |

## 二、修改 / 新增文件清单

### 新增
- `src/lib/gantt-core.js` — 甘特核心逻辑纯 ESM 模块（时间轴生成、条形落位、未排期收集），供 Worker 与单元测试共用同一份真实实现。
- `scripts/unit-test.mjs` — ESM 单元测试，直接 import `gantt-core.js` 的真实实现。
- `pm-ai-work-packages/WP-005-TBD规划包与时间轴可靠性-RESULT.md` — 本报告。

### 修改
- `public/index.html` — title/H1 改为“Shak 项目组合治理系统”；新增甘特图下方“未排期工作包”独立区域；甘特头部增加 `col-project`/`col-status` 固定列结构。
- `public/app.js` — `renderGantt` 重构支持新数据结构；条形改用 CSS Grid `grid-column` 落位（修复双重偏移）；新增 `renderUnscheduled` 渲染按项目分组的 TBD 卡；新增 `escapeHtml`。
- `public/styles.css` — 甘特网格与固定列、Grid 条形样式；新增未排期区/分组/TBD 卡样式。
- `src/lib/gantt.ts` — 改为 `gantt-core.js` 的 TypeScript 封装，`buildGanttData` 调用真实核心逻辑并返回 `timeline`/`rows`/`unscheduled`。
- `src/index.ts` — gantt 端点直接返回 `buildGanttData` 结果（含未排期分组）。
- `src/api/steps.ts` — 更新步骤时的状态自动迁移逻辑：补齐完整日期且原为 `tbd` → `planned`；任一日期被清空（含空串 `''`）→ `tbd`。修复了空串清空日期不回退状态的缺陷。
- `scripts/smoke-test.js` — 新增 WP-005 测试 28–35：TBD 分组、TBD→Plan、Plan→TBD、日 366 / 周 260 / 月 120 长区间连续性、长跨度月格落位。
- `package.json` — description 更名；`test` 指向 `scripts/unit-test.mjs`；移除 jest 相关 devDependencies。
- `tsconfig.json` — types 移除 `jest`。
- `README.md` — 更名与命名说明；新增“未排期工作包（TBD）”业务语义与转 Plan 规则；甘特图规则更新为真实 cell 边界、支持长区间；目录结构同步。
- `docs/项目章程.md`、`docs/需求登记册.md` — 系统命名与需求登记同步。

### 删除
- `jest.config.js`、`scripts/unit-test.cjs` — 迁移到 ESM 单测后不再需要。

## 三、验收项逐条证据

### A. TBD 未排期工作包
- **A1/A2 只显示合法排期步骤，TBD 不进日期轴**：`gantt-core.js` 的 `calculateBars` 只处理非未排期步骤；`isUnscheduled` 判定 tbd/缺日期/非法/反向区间。smoke #29 断言 TBD 步骤出现在 `unscheduled` 分组且不产生 bar。✅
- **A3 按项目分组显示项目名/Owner/Stage + 卡内再标注**：`collectUnscheduled` 按项目分组；`renderUnscheduled` 输出分组头（项目名·Owner·Stage）与固定尺寸灰色虚线卡（卡内含项目归属+工作包名）。✅
- **A4 固定尺寸灰色虚线、不占日期格、不遮挡**：`.tbd-card` 固定尺寸 + `border: dashed` 灰色；未排期区为甘特卡下方独立 `section`，与时间轴 DOM 完全分离。✅
- **A5 补齐日期并转 planned/done/risk/blocked → 进日期轴**：`steps.ts` 补齐完整日期且原 tbd 时自动置 `planned`；smoke #30 断言迁移后进入时间轴 bar、离开未排期。✅
- **A6 清空日期或改回 tbd → 回未排期**：`steps.ts` 任一日期清空（含空串）自动置 `tbd`；smoke #31 断言回退后重新出现在 `unscheduled`、不在 bar 中。✅
- **A7 无 TBD 时整个区域隐藏**：`renderUnscheduled` 无分组时对 `#unscheduledSection` 设置 `hidden`。✅

### B. 日/周/月时间轴可靠性
- **B1 删除静默截断**：`portfolio-governance-app` 内已无 `length < 90` 等硬上限（grep 仅命中工作包说明文本与 out-of-scope 的 `governance-demo`）。✅
- **B2/B3 条形按真实 cell 边界计算**：`generateTimeline` 生成带 `startMs`/`endMs` 的日历单元格（日；周对齐周一；月对齐月首）；`calculateBars` 用 `findStartCell`/`findEndCell` 匹配重叠单元格，`colEnd` 以 `cells.length - 1` 收敛，不再用 /7、/30 与 totalDays 上限。✅
- **B4 366 天 / 260 周 / 120 月**：unit test 断言 cell 数分别为 366/260/120 且首尾对齐；smoke #32/#33/#34 通过 HTTP 断言真实响应 timeline 连续无空白尾部。✅
- **B5 长范围横向滚动、固定列不被覆盖**：`.gantt-scroll` 横向滚动，`.col-project`/`.col-status` sticky 固定；smoke #35 断言长跨度步骤按真实月格落位（无 /30 漂移）。✅

### C. 系统命名（REQ-019）
- 用户可见 title/H1、README、docs 均为“Shak 项目组合治理系统”。✅
- 技术资源标识未改动：build 输出显示 D1 `pmo-governance-prod`、R2 `pmo-governance-backups-prod`；`wrangler.toml` 与 Worker 名 `pmo-governance`、域名 `pmo.pmoforms.com` 保持不变。✅

## 四、命令真实输出摘要

### `npm run lint` — 通过（exit 0）
```
> eslint src/**/*.ts
（无错误输出）
```

### `npm test` — 12/12 通过（exit 0）
```
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
✅ collectUnscheduled 按项目分组，仅含未排期步骤
✅ TBD→Plan→TBD：补齐日期后进入日期轴，清空后回到未排期
📊 单元测试结果: 12 通过, 0 失败
```

### `npm run build`（wrangler deploy --dry-run）— 通过（exit 0）
```
Total Upload: 110.97 KiB / gzip: 23.98 KiB
Your worker has access to the following bindings:
- D1 Databases:
  - DB: pmo-governance-prod (abb3c863-7689-40d1-9e69-f5b64b261f9a)
- R2 Buckets:
  - BACKUPS: pmo-governance-backups-prod
--dry-run: exiting now.
```

### `npm run db:migrate` 连续两次 — 均 exit 0（幂等）
```
# 第一次
✅ No migrations to apply!
# 第二次
✅ No migrations to apply!
```
> 说明：本地 D1 已在早前 WP 建库，两次运行均正常退出且无副作用，验证幂等。

### `npm run dev` — 本地 Worker 正常（端口 8789，127.0.0.1）
HTTP 状态验证：
```
/           -> 200 (text/html; charset=utf-8)
/index.html -> 200 (text/html; charset=utf-8)
/app.js     -> 200 (application/javascript)
/styles.css -> 200 (text/css; charset=utf-8)
/api/health -> 200 (application/json)
```

### HTTP Smoke Test — 36/36 通过（exit 0）
```
✅ 1–27  组合/Stage/项目/步骤/归档/审计/关联资料（既有回归全绿）
✅ 28. WP-005 创建 TBD 场景项目与两个未排期步骤
✅ 29. WP-005 TBD 步骤进入未排期分组，不进日期轴
✅ 30. WP-005 TBD→Plan 后进入日期轴
✅ 31. WP-005 Plan→TBD 后回到未排期区
✅ 32. WP-005 日视图 366 天连续无截断
✅ 33. WP-005 周视图 260 周连续无截断
✅ 34. WP-005 月视图 120 月连续无截断
✅ 35. WP-005 长跨度步骤按真实月格落位
📊 测试结果: 36/36 通过
```

## 五、已知限制

- `npm run build` 使用 `wrangler deploy --dry-run`，仅本地打包校验，未执行任何生产部署（符合禁止 deploy 约束）。
- 本地已存在既有 migration 记录，`db:migrate` 输出为“No migrations to apply”。如需在全新空库验证，可先删除本地 `.wrangler` D1 状态再连续执行两次；本包未改动任何 migration 文件，schema 无变更。
- 当前 Wrangler 版本 3.114.17 提示可升级到 4.x；不在本包范围内，未升级以避免引入无关变更。
- out-of-scope 的 `governance-demo/app.js` 仍保留 `out.length<90` 的旧演示逻辑；该目录不属于 `portfolio-governance-app` 生产应用，未改动。

## 六、约束遵守声明

- 未执行 `wrangler deploy`。
- 未修改生产 Cloudflare、D1、R2、DNS、Git remote 或 PM baseline 文件。
- 技术资源标识 `pmo-governance`、`pmo-governance-prod`、`pmo.pmoforms.com`、GitHub repo slug 均未改名。
- 最终状态：**implemented, pending PM/QC review**。
