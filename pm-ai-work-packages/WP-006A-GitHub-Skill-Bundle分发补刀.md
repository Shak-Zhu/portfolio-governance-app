# WP-006A 补刀｜GitHub Skill Bundle 权威分发

## 执行顺序（强制）

- 状态：**条件性已签发，当前不得执行**。
- 前置依赖：WP-006 必须先完成并向 Codex 提交 `implemented, pending PM/QC review` 的 RESULT。
- 触发规则：
  1. 若 Codex 对 WP-006 发出返工，WP-006A 与该返工合并执行并一并复验；
  2. 若 WP-006 通过 PM/QC，WP-006A 才作为独立补刀执行；
  3. 在以上任一触发条件满足前，Cursor 不得提前改动 GitHub 分发、manifest 或安装脚本。

## 角色分工（强制）

| 工作 | Owner | 完成标准 |
|---|---|---|
| Skill Bundle 与 MCP 的功能适配 | Cursor | 完整 Skill/Rule/reference/manifest 与 MCP 工具实现严格一致；提供本地可复验证据；不得发布 GitHub 链接或 tag。 |
| Skill/MCP QA 与 QC | Codex | 核验运行时 `tools/list` 与 Skill 工具契约逐项一致，执行安装、Skill 触发、读写、归档/TBD/Stage/链接边界验证；不通过则签发返工。 |
| Git 发布、不可变版本与链接落位 | Codex | QC 通过后由 Codex commit、push、创建发布 tag，取得最终 commit SHA；将该 SHA 写入生产安装配置并回读 raw GitHub 链接。 |
| 生产安装验收 | Codex | 从最终 GitHub raw URL 重新下载 bundle、逐文件 hash 校验、重启 Codex 后触发 Skill 并真实调用 MCP。 |

## 目的

不改变 WP-006 的网页登录、Bearer MCP、官方 handler 或清理范围。补充 Agent Skill 的正式分发机制：**GitHub 是权威下载源**，Agent 从一个固定版本的 GitHub 链接下载完整 Skill Bundle，而非只下载一份孤立 `SKILL.md`。

## 正式规则

1. 权威仓库：`https://github.com/Shak-Zhu/portfolio-governance-app`。
2. 权威目录：`agent-skills/shak-project-portfolio-governance/`；该目录是一个完整 Codex Skill Bundle，不是单文件。
3. 必须包含：
   - `SKILL.md`：YAML frontmatter、触发条件、MCP 工作流与强制规则；
   - `references/tool-contract.md`：全量工具、输入/输出、调用前后条件；
   - `references/governance-rules.md`：项目层级、归档、Stage、TBD/Plan、URL、审计与错误恢复；
   - `agents/openai.yaml`：Codex Skill 元数据；
   - `manifest.json`：bundle 版本、Git commit、每个文件的 SHA-256。
4. 每次发布必须由 Codex 在 QC 后以最终不可变 Git commit SHA 创建版本；安装指令禁止只指向默认分支 `main`，以避免内容漂移。manifest 记录 `skillVersion` 与逐文件 SHA-256；最终 commit SHA 由 Codex 落入生产安装配置及 `get_capabilities`，避免让 Cursor 猜测尚不存在的 commit。
5. 网页安装文案从 `/api/agent/install` 动态生成，其中的 Skill 下载地址必须为：
   `https://raw.githubusercontent.com/Shak-Zhu/portfolio-governance-app/<sourceCommit>/agent-skills/shak-project-portfolio-governance/...`
   并逐个校验 manifest SHA-256。
   **禁止**在一键粘贴文案中给出仓库首页、仓库 clone URL 或默认分支链接来代替 Skill 链接；文案只可提供该 Skill Bundle 的精确固定-commit 根路径、`manifest.json` 和 bundle 内文件 URL。
6. Cursor Rule 从同一 commit 下载；Codex 从同一 commit 下载完整 Bundle 到 `~/.codex/skills/shak-project-portfolio-governance/`。不得只下载 `SKILL.md`。
7. `SKILL.md` 只提供操作规则；MCP `tools/list` 是参数 schema 的运行时事实来源。安装后必须调用 `get_capabilities`，核对 `skillVersion`、Codex 发布的 `skillSourceCommit` 与 manifest。
8. Skill Bundle、manifest 和 GitHub URL 不包含真实 Bearer Token、网页登录凭据或 Session 信息。Token 仍仅由登录后的动态网页安装文案提供。

## 私有仓库兼容

仓库若保持私有，`raw.githubusercontent.com` 需要当前机器已有 GitHub 访问权限；安装文案必须在下载前做一次可诊断的 GitHub 访问检查，失败时明确提示“需要该仓库读取权限”，不得伪造已安装。不得把 GitHub PAT 写入 Skill、Git、网页或安装文案。

## 必须验证

1. 从固定 commit 的 GitHub raw URL 下载全部 bundle 文件；逐文件 SHA-256 与 manifest 一致。
2. 下载到一个空的临时 Codex Skill 目录，目录结构完整；完全重启 Codex Desktop 后，新会话能触发该 Skill。
3. 使用该 Skill 连接已配置 MCP，`get_capabilities`、`tools/list`、一读一写真实成功。
4. GitHub 无权访问时，安装脚本产生明确、可行动的错误，不留下半安装目录。

## 禁止事项

- 不将真实 token、密码、Session、GitHub PAT 写入任何仓库文件、manifest、Skill、命令输出或 RESULT。
- 不将静态生产站点文件作为 Skill 的唯一权威来源；GitHub commit 才是版本真相。

## 提交

将完成证据追加至 `pm-ai-work-packages/WP-006-单用户登录与Bearer-MCP重构-RESULT.md` 中的 `WP-006A` 小节，不新建独立 RESULT；状态仍为 `implemented, pending PM/QC review`。
