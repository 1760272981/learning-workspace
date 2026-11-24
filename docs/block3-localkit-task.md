# 块3 任务书：本地壳 kit（A 主路径）+ 沙箱免登录入口页

日期：2026-11-25。负责人已拍板：A 纯本地分发（GitHub 仓库）+ 提示词页放沙箱免登录入口页。执行分工：子代理只做本地代码与本地测试；**任何云端操作一律不做**（沙箱重发布由主会话报备后执行）；不 commit、不 push（GitHub 建仓库/push 另行授权）。

## 0. 必读

项目内：docs/handover.md、docs/block2-implementation-report.md、docs/block2-multiuser-task.md、shared/model.ts、functions/（handler.ts 的 submit/handleLearningStore、database.ts 的 DatabaseClient 接口、routes.mjs）、mcp/server.ts、mcp/cloud.ts、src/App.tsx、src/api.ts、src/hooks/useKnowledgeStore.ts、src/components/AuthPanel.tsx、scripts/fake-db.ts、scripts/test-functions.ts、scripts/test-mcp.ts、scripts/accept-sandbox.mjs、vite.config.ts、package.json。

## 1. 本地模式（kit 核心）

目标：别人机器上 `npm install` + `npm run local` 一条命令起树网页+本地数据；不登录、不连云；数据在自己机器上一个 JSON 文件。

- 新增 `scripts/file-db.mjs`：实现 functions/database.ts 的 DatabaseClient 接口（from/select/eq/order/range/limit/insertIfAbsent/update/delete、23505 语义），持久化到 `local-data/lw-local-db.json`（gitignored；目录不存在自动建；写入原子：先写临时文件再 rename）。把 scripts/fake-db.ts 的内存实现重构为共用核心+内存/文件两个外壳，现有测试保持绿。
- 新增 `scripts/local-server.mjs`：node http 服务，serve dist/ + 同 origin `/functions/v1/app/*`：
  - 业务五动作直接调 handler.ts 的 handleLearningStore({request, db: fileDb, ownerId: LOCAL_OWNER})，LOCAL_OWNER 为固定本地 uuid（常量，非账号）；submit 复用 handler 导出的 submit（如未导出则导出）。
  - `/api/me` 返回 {user:{id:LOCAL_OWNER, username:'local'}, mode:'local'}；register/login/logout/tokens 路由返回 404 安全码 local_mode_only（本地无认证无令牌）。
  - `/api/health` 200。Origin 校验：本地允许 http://localhost:<port> 与 http://127.0.0.1:<port>（固定端口常量，默认 8787）。
  - 32KB、pending 语义、received_at 盖章沿用 handler。
- package.json：`"local": "npm run build && node scripts/local-server.mjs"`。
- **MCP 本地模式统一同一份数据**：mcp/server.ts 未配 LW_API_BASE/LW_USER_TOKEN 时，改用 file-db（同一 local-data 文件）+ handler submit/assembleStore(loadRows(...))，替换旧 store.json Store 直改路径；store.json 仅保留为测试夹具用途（测试改用临时文件库）。agent 提交后本地网页刷新可见 = 块3 验收硬指标。
- 前端本地态：/api/me 的 mode:'local' 时跳过 AuthPanel/TokenPanel，缓存键 lw-store-v3:local；写操作直连本地 api；401 处理仅云模式。

## 2. 沙箱免登录入口页（云模式未登录时显示）

- 未登录不再直接是登录表单：先显示入口页——一句话产品介绍 + 三条路卡片：①评委/用户体验（登录/注册表单在下方 + 公开演示凭据 demo/demo-2026 提示）②搬回家（仓库链接 + 提示词一键复制框）③看我们真实树（旧站链接 https://learning-workspace-v5d3qx7uw3a.qoder.zone）。
- 链接与文案单一来源 `src/content/links.ts`：repoUrl 初始 ''（渲染“仓库地址即将随论坛帖公布”，诚实占位，不放假链接）；oldSiteUrl、sandboxDemo 凭据常量。
- 提示词单一来源 `public/setup-prompt.txt`（随 dist serve）：大白话、给用户的 agent 读的完整配置指令（克隆仓库→npm install→npm run local→按 README 配 MCP stdio 与 Skill→用一条真实学习点提交验证→失败不重发按原键对账）。入口页 fetch 该文件渲染+复制按钮（无剪贴板权限回退手动复制，沿用 TokenPanel 做法）。README 指向该文件路径，不另抄一份正文。
- 登录/注册/令牌/树等已登录体验完全不变。

## 3. 仓库打包

- .gitignore：node_modules、dist、local-data/、.env、*.local、证据临时截图目录；保留 public/setup-prompt.txt、skills/、scripts/、docs/（handover 含请求编号可进仓库；**不含任何真实密钥/令牌/密码明文**；演示凭据 demo/demo-2026 属故意公开信息可进）。
- README.md 重写（大白话）：产品一句话、三条路、本地快速开始、MCP/Skill 配置示例（env 占位）、边界与已知限制（无邮箱验证/找回密码/云同步赛后；本地数据单文件；上限规则）、目录地图。
- 不新增 LICENSE（负责人未拍板，报告里列待决）。

## 4. 测试与交付

- 扩展 scripts/test-functions.ts：file-db 持久化（重启读回）、本地路由无认证 404 安全码、LOCAL_OWNER 幂等、MCP 本地提交→本地 store 读回一致（临时文件库）。
- 现有 21 项 MCP、12 例、22 项函数、5 项云端契约全绿；npm run build 绿。
- 浏览器本地实测（隔离临时浏览器+本地服务）：npm run local 起→空树诚实空态→网页添加→刷新读回→**MCP stdio 提交一条→网页刷新可见**→标记/验收/删除→重启服务数据仍在→local-data 文件外无残留。测试数据只在本机临时目录/已关闭进程。
- 入口页本地渲染检查：云模式未登录视图（可用 vite dev + 假 me 401 路径）三卡片+提示词复制回退。
- 交付 docs/block3-implementation-report.md：改动清单、测试命令与结果、已知限制（无 Deno 如实）、给主会话的云端清单（links.ts 填 repoUrl 后沙箱新 action 重发布+验收入口页/登录/提交回归）。

## 5. 禁止

不碰云端；不 commit/push；不造假数据/预设云账号；不擅自加功能（云同步、找回密码、OAuth、多本地用户等均不做）；不改 .Learning Workspace.qoder.site；functions/model.ts 只经同步脚本生成；失败语义（pending 不重发等）全保留；本机无 Deno 不假装类型检查。