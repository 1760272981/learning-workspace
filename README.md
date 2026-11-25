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

浏览器打开 <http://localhost:8787>。页面会显示“本地模式 · 无需登录”，不需要账号、密码或令牌，也不会连接云端。

- 网页和 MCP 默认共用 `local-data/lw-local-db.json`。
- 数据文件、锁目录和构建产物都不会进 Git。
- 停止服务不会丢数据；重新运行 `npm run local` 后会读回。
- 端口默认 `8787`，可用环境变量 `LOCAL_PORT` 修改。
- 自定义数据路径时，网页服务与 MCP 必须设置相同的 `LW_LOCAL_DATA_FILE` 绝对路径。

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
