# Shak 项目组合治理系统

系统唯一正式名称：**Shak 项目组合治理系统**。基于 Cloudflare Workers + D1 的多项目治理甘特图应用。

> 命名说明：用户可见的网页标题、H1、产品文档统一使用“Shak 项目组合治理系统”。技术资源标识（Worker `pmo-governance`、D1 `pmo-governance-prod`、域名 `pmo.pmoforms.com`、GitHub 仓库 slug）不随命名变更而改名。

## 技术栈

- **前端**: 原生 HTML/CSS/JavaScript（中文界面）
- **后端**: Cloudflare Workers (Hono 框架)
- **数据库**: Cloudflare D1
- **构建**: Wrangler CLI

## 功能特性

- 组合（Portfolio）管理
- 项目层级（父子关系）
- 步骤计划与甘特图（日/周/月视图）
- 自定义 Stage 管理
- 项目关联资料（支持 http(s) URL）
- 整体归档规则（仅顶级项目 + 全部后代完成）
- 审计日志

## 快速开始

### 前置条件

- Node.js >= 18
- Wrangler CLI (`npm i -g wrangler`)
- Cloudflare 账号（已配置 Wrangler OAuth）

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 D1 数据库

**方式一：使用 Cloudflare Dashboard 创建**

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 Workers & Pages > D1
3. 创建新数据库，名称：`pmo-governance-prod`
4. 复制 Database ID

**方式二：本地创建测试数据库**

```bash
npm run db:create
```

### 3. 更新 wrangler.toml

将 `database_id` 替换为实际值：

```toml
[[d1_databases]]
binding = "DB"
database_name = "pmo-governance-prod"
database_id = "YOUR_ACTUAL_DATABASE_ID"
```

### 4. 运行 Migrations

```bash
# 本地 D1
npm run db:migrate
```

在空本地 D1 连续执行两次均应成功（幂等性）。

### 5. 初始化样例数据（可选）

```bash
npm run db:init
```

### 6. 启动本地开发服务器

```bash
npm run dev
```

默认监听 `http://localhost:8787`（可用 `npm run dev -- --port 8788` 指定端口）。

Worker 会把非 `/api/*` 请求转交给 `[assets]` 绑定（`public/` 目录），因此直接访问以下路径均返回 200：

- `/` 与 `/index.html` → 网页（text/html）
- `/app.js`、`/styles.css` → 前端静态资源
- `/api/health` → API 健康检查（application/json）

## 开发命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动本地 Worker（带热重载） |
| `npm run lint` | ESLint 代码检查 |
| `npm test` | 运行单元测试 |
| `npm run build` | 构建预览（dry-run，不部署） |
| `npm run db:migrate` | 运行数据库迁移 |
| `npm run db:init` | 初始化样例数据 |
| `npm run db:smoke` | 运行 API 冒烟测试（需先启动 dev，见下） |

### 运行 API 冒烟测试

先在一个终端启动本地 Worker，再在另一个终端指定 `API_URL`（必须包含 `/api` 后缀）：

```bash
# 终端 1
npm run dev -- --port 8788

# 终端 2
API_URL=http://127.0.0.1:8788/api npm run db:smoke
```

## API 端点

### 组合（Portfolio）

- `GET /api/portfolios` - 列出所有组合
- `POST /api/portfolios` - 创建组合
- `GET /api/portfolios/:id` - 获取单个组合
- `PUT /api/portfolios/:id` - 更新组合
- `DELETE /api/portfolios/:id` - 删除组合

### 项目（Project）

- `GET /api/portfolios/:pid/projects` - 列出组合下的项目
- `POST /api/portfolios/:pid/projects` - 创建项目
- `GET /api/projects/:id` - 获取单个项目
- `PUT /api/projects/:id` - 更新项目
- `DELETE /api/projects/:id` - 删除项目
- `POST /api/projects/:id/complete` - 标记完成
- `POST /api/projects/:id/archive` - 整体归档
- `GET /api/portfolios/:pid/stats` - 获取统计

### 步骤（Step）

- `GET /api/projects/:pid/steps` - 获取项目的步骤
- `POST /api/projects/:pid/steps` - 创建步骤
- `PUT /api/steps/:id` - 更新步骤
- `DELETE /api/steps/:id` - 删除步骤

### 关联资料（Project Link）

- `GET /api/projects/:pid/links` - 获取项目的关联资料
- `POST /api/projects/:pid/links` - 创建关联资料（URL 必须以 http:// 或 https:// 开头）
- `PUT /api/links/:id` - 更新关联资料
- `DELETE /api/links/:id` - 删除关联资料

### Stage

- `GET /api/portfolios/:pid/stages` - 获取 Stage 列表
- `POST /api/portfolios/:pid/stages` - 创建 Stage
- `PUT /api/stages/:id` - 更新 Stage（被项目使用时禁止）
- `DELETE /api/stages/:id` - 删除 Stage（被项目使用时禁止）

### 甘特图

- `GET /api/portfolios/:pid/gantt` - 获取甘特图数据
  - Query: `start`, `end`, `scale` (day/week/month)

### 审计

- `GET /api/portfolios/:pid/audit` - 获取审计事件
- `GET /api/audit/:type/:id` - 获取对象审计历史

## 数据库 Schema

### portfolios（组合）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| name | TEXT | 名称 |
| description | TEXT | 描述 |
| created_at | INTEGER | 创建时间戳 |
| updated_at | INTEGER | 更新时间戳 |

### projects（项目）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| portfolio_id | TEXT | 所属组合 |
| parent_id | TEXT | 父项目（NULL 为顶级） |
| title | TEXT | 项目名称 |
| owner | TEXT | 负责人 |
| stage | TEXT | 当前阶段 |
| health | TEXT | 健康状态 |
| expectation | TEXT | 业务预期 |
| risk | TEXT | 风险说明 |
| gate | TEXT | 门控状态 |
| status | TEXT | 状态 |
| is_archived | INTEGER | 是否归档 |
| archived_at | INTEGER | 归档时间 |

### steps（步骤）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| project_id | TEXT | 所属项目 |
| name | TEXT | 步骤名称 |
| start_date | TEXT | 开始日期 |
| end_date | TEXT | 结束日期 |
| status | TEXT | 状态 |
| sort_order | INTEGER | 排序 |

### stages（Stage 定义）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| portfolio_id | TEXT | 所属组合 |
| name | TEXT | Stage 名称 |
| sort_order | INTEGER | 排序 |

### project_links（关联资料）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| project_id | TEXT | 所属项目 |
| title | TEXT | 资料标题 |
| url | TEXT | 链接地址（必须 http(s):// 开头） |
| created_at | INTEGER | 创建时间戳 |
| updated_at | INTEGER | 更新时间戳 |

### audit_events（审计事件）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| portfolio_id | TEXT | 所属组合 |
| actor | TEXT | 操作者 |
| action | TEXT | 操作类型 |
| object_type | TEXT | 对象类型 |
| object_id | TEXT | 对象 ID |
| summary | TEXT | 变更摘要 |
| details | TEXT | 详细变更 |
| created_at | INTEGER | 创建时间戳 |

## 归档规则

1. **仅顶级项目可归档**：子项目不可单独归档
2. **后代完成检查**：归档前必须验证所有后代项目均已完成
3. **整体归档**：父项目归档时，所有后代项目一并归档

## Stage 规则

1. **被项目使用的 Stage 禁止删除**：包括活动项目和归档项目
2. **被项目使用的 Stage 禁止改名**：必须先修改项目引用

## 甘特图规则

- 步骤是甘特条的唯一数据来源
- 只有同时具备合法 `start_date`、`end_date` 且状态非 `tbd` 的步骤才进入日期轴，显示为彩色条
- 支持日/周/月三种视图；时间轴按真实日历单元格（日/周一对齐/月首对齐）生成，条形起止根据实际 cell 边界计算，不做静默截断，可支持长区间（例如 366 天 / 260 周 / 120 月）

## 未排期工作包（TBD）

“未排期工作包”是甘特图下方的独立区域，承载所有尚未确定排期的步骤，与日期轴完全分离。

- **判定为未排期的条件**：缺少 `start_date` 或 `end_date`、日期非法、开始晚于结束，或状态为 `tbd`。
- **展示形式**：按项目分组，每组显示项目名称、Owner、Stage；组内每张工作包为固定尺寸的灰色虚线卡，卡内再次标注所属项目与工作包名称。
- **不占日期轴**：未排期卡不出现在日期轴内部、右侧列、浮层或角标，也不遮挡任何甘特条，不暗示排期。
- **转为已排期（进入日期轴）**：为步骤补齐合法开始/结束日期，并把状态改为 `planned`/`done`/`risk`/`blocked` 后，刷新即从未排期区消失，按对应颜色落入正确日期格。服务端在更新步骤时，若补齐了完整日期且原状态为 `tbd`，会自动将状态置为 `planned`。
- **退回未排期**：清空任一日期或将状态改回 `tbd`，步骤自动回到未排期区。服务端在更新步骤时，若任一日期被清空，会自动将状态置为 `tbd`。
- **整体隐藏**：当没有任何未排期步骤时，整个区域隐藏。

## 关联资料规则

- URL 必须以 `http://` 或 `https://` 开头
- 每次创建、修改、删除均写入审计记录
- 点击链接在新窗口打开

## 部署前检查

1. ✅ `npm run lint` 无错误
2. ✅ `npm test` 全部通过
3. ✅ `npm run build` 构建成功
4. ✅ `npm run db:migrate` Migration 正常
5. ✅ `npm run db:smoke` API 测试通过

## 目录结构

```
portfolio-governance-app/
├── migrations/
│   └── 0001_initial_schema.sql
├── drizzle/
│   └── seed.sql
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── scripts/
│   ├── smoke-test.js
│   └── unit-test.mjs
├── src/
│   ├── api/
│   │   ├── portfolios.ts
│   │   ├── projects.ts
│   │   ├── steps.ts
│   │   ├── stages.ts
│   │   ├── projectLinks.ts
│   │   └── audit.ts
│   ├── lib/
│   │   ├── db.ts
│   │   ├── gantt-core.js   # 甘特时间轴/条形/未排期核心逻辑（纯 ESM，供 Worker 与单测共用）
│   │   └── gantt.ts        # gantt-core 的 TypeScript 封装
│   ├── types/
│   │   └── index.ts
│   └── index.ts
├── package.json
├── tsconfig.json
├── wrangler.toml
└── README.md
```

## 许可证

Internal Use Only
