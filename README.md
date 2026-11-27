# Learning Workspace

给“用 AI 做项目的大学生”的独立学习层：把每次 AI 产出用「判断、证据、验收动作」拆成必要的知识，长成一棵可标记、可回顾、可验收的知识树。

## 三条路

- **在自己电脑用**：按下面的本地快速开始，数据只留在自己的 JSON 文件里。
- **先体验沙箱**：打开 [多用户沙箱](https://learning-workspace-multi-v5d3qx7uw3a.qoder.zone)，登录或注册后使用；公开演示凭据为 `demo` / `demo-2026`。
- **看真实积累**：打开 [旧站](https://learning-workspace-v5d3qx7uw3a.qoder.zone)。入口页链接与演示凭据统一维护在 `src/content/links.ts`；仓库地址公布前会如实显示占位，不放假链接。

## 本地快速开始

需要 Node.js 24 或更高版本。

```bash
npm install
npm run local
```

浏览器打开 <http://localhost:8787>。页面会显示“本地模式 · 无需登录”，项目记录读写不需要账号、密码或令牌。

- 网页和 MCP 默认共用 `local-data/lw-local-db.json`。
- 数据文件、锁目录和构建产物都不会进 Git。
- 停止服务不会丢数据；重新运行 `npm run local` 后会读回。
- 端口默认 `8787`，可用环境变量 `LOCAL_PORT` 修改。
- 自定义数据路径时，网页服务与 MCP 必须设置相同的 `LW_LOCAL_DATA_FILE` 绝对路径。

## 比赛版：Qoder 桌面联调（审查分支）

比赛版只验证 Qoder。目标是保留原有桌面登录、模型和审批，由用户在回顾项目记录时主动提问；不替用户记录验收。**这个分支还未把桌面问答接到真实项目页。** 浏览器入口可继续查看项目记录和历史问答；其中标为 `Qoder CN SDK` 的独立接入不是桌面复用：仅登录桌面时曾实测返回 `AUTH_REQUIRED`。下列桌面复现不需要安装 Qoder CLI、重新登录或创建 PAT。

### 在另一台电脑复现

1. 检出审查分支，在仓库根目录运行 `npm ci`。使用 Node.js 24+；本轮桌面观测环境为 Windows、Qoder CN Desktop 0.5.20，其他版本需实测。
2. 在一个终端运行 `node plugins/workspace-host-probe/server.mjs`，保持进程运行。插件通过现有的本机 HTTP MCP 地址 `127.0.0.1:8791` 取页面；启动终端不应设置任何账号凭证。普通浏览器的项目页另外用 `npm run local` 启动，默认 `http://localhost:8787`。
3. 若没有安装联调插件，从当前提交打包：`git archive --format=zip --output=../workspace-host-probe.zip HEAD:plugins/workspace-host-probe`。用 Qoder 的本地 ZIP 导入安装并启用。若已安装同一插件，直接复用。打开左侧「更多 → Learning Workspace 桌面联调」，不点聊天里的旧卡片。
4. 看到「宿主已连接」后手动点「发送首问」。这是不读取项目数据的随机词测试。如果出现「允许应用创建会话？」，由本人选「允许一次」或取消。看到页内出现「Qoder 写回」才算首答，再在原页点击「在同一会话追问」。两轮都要收到实际回答，检查页面显示的会话 ID 是否一致，并记录哪一轮弹了授权。发送确认或左侧聊天里的回答不算通过；实际模型只认该轮运行证据，不以界面选项或模型自报代替。超时只检查原轮回传，不自动重发。服务端成功日志只记录会话与轮次，不含问题正文或一次性写入凭据。
5. **合成两轮通过后**才接 B1 项目记录：先问「为什么脚本提交成功还不能证明 Qoder 连接器通了？」，再问「那我应该看什么证据？」。脚本直连的成功只证明该脚本走过的配置、工具与存储路径；Qoder 连接器实连要在真实 Qoder 会话中调用 `submit_project_update`，再从项目页或 `read_project_updates` 读回同一条记录。两项验收独立，不因解释成功而标成已验证。

### 实测与未验证

- 已实测：本机 MCP 返回交互页面；Qoder 左侧入口加载并显示「宿主已连接」；合成首问曾触发真实的「允许应用创建会话」提示。另一次首问在宿主 `mcp-app:host-message` 阶段超时，没有确认投递。右侧旧卡片曾加载失败，不是该探针声明的打开入口。
- 自动化验证：构建、项目事件读写、问答保存和追问上下文、MCP 配置与本地/云端契约。问答测试使用注入的测试 Agent；云端契约使用模拟请求。它们不证明桌面宿主能回传。
- 未验证：真实桌面两轮写回、两轮是否同会话、授权次数、实际模型、B1 的真实桌面问答、Qoder 连接器实连提交及真实云端提交读回。不要上传本地库、会话日志或探针凭据来复现。

## 配置 MCP 与 Skill

完整安装提示词只有一份：**[public/setup-prompt.txt](public/setup-prompt.txt)**。沙箱未登录入口页会读取并展示同一文件。让 agent 先读该文件，再按它配置和验证，不要另抄一份。

MCP 使用 stdio。下面是配置结构示例，路径必须换成自己电脑上的真实绝对路径：

```json
{
  "mcpServers": {
    "learning-workspace": {
      "command": "node",
      "args": ["/绝对路径/learning-workspace/mcp/server.ts"]
    }
  }
}
```

本地壳**不要设置** `LW_API_BASE` 和 `LW_USER_TOKEN`。Skill 位于 `skills/learning-capture/SKILL.md`，让 agent 完整阅读后再用；只有用户主动说“整理学习点”时才提交。

云端写入双模式（二选一，都配时个人令牌优先）：评委沙箱用 `LW_API_BASE` + `LW_USER_TOKEN`（Bearer 个人令牌）；旧站 legacy 机制用 `LW_API_BASE` + `LW_WRITE_KEY`（共享写密钥头）。密钥与令牌真值只放在使用者自己的 agent 环境变量里，不进仓库与聊天。

环境变量占位见 `.env.example`。注意：Node 不会自动读取 `.env`，需要由启动 MCP/本地服务的工具把变量传入进程。

## 验证是否真的接通

1. 网页手动添加一条真实学习点，刷新确认仍在。
2. 让 agent 经 MCP 提交另一条真实学习点，刷新网页确认可见。
3. 标记理解、保存验收、删除测试点。
4. 重启 `npm run local`，确认未删除的数据仍在。

超时、5xx 或响应无法确认时，结果是 **pending**，不要自动重发；先读取并按原 `project + output_ref + 规范标题` 对账。明确 4xx 才是 **failed**。重复键、服务器 `received_at` 盖章和上限由程序统一处理。

## 边界与已知限制

- 纯本地、单用户；没有云同步、多本地账号、邮箱验证、找回密码或 OAuth。
- 数据在一个 JSON 文件中，请自行备份；文件写入采用临时文件加原子替换。
- 每个产出版本最多 2 条，每个项目每天最多 3 条新推荐；单次请求上限 32KB。
- 本地服务只监听 `127.0.0.1`，写请求只接受 localhost / 127.0.0.1 同端口 Origin；认证路由在本地不存在。
- 本机没有 Deno，因此未做 Deno 类型检查；`npm run build` 不等于平台函数入口检查。
- 文件锁用于避免两个进程同时写坏 JSON；进程被强制杀死可能留下锁目录，需要确认没有写入进程后手动清理。

## 目录地图

- `shared/model.ts`：提交校验、上限和幂等规则的单一来源。
- `functions/`：业务 handler 与数据库接口；`functions/model.ts` 只能由同步脚本生成。
- `scripts/db-core.mjs`：内存库与文件库共用的查询核心。
- `scripts/file-db.mjs`：JSON 文件持久化与原子写。
- `scripts/local-server.mjs`：本地网页、静态资源和业务路由。
- `mcp/`：stdio MCP；本地直调同一 handler，云端使用个人 Bearer 令牌。
- `src/`：React 树界面、登录/本地模式与未登录入口页。
- `public/setup-prompt.txt`：唯一安装提示词来源。
- `skills/learning-capture/SKILL.md`：主动整理学习点的规则。
- `docs/`：任务书、交接、实施报告和云端清单。

## 开发与测试

```bash
npm run sync:functions-model
npm run build
npm run test:mcp
npm run eval:12
npm run test:functions
npm run test:cloud
```

测试使用临时文件库，不碰真实本地数据，也不连接云端。
