# 块3：本地壳 kit + 沙箱免登录入口页实施报告

日期：2026-11-25  
范围：只改本地代码、文档和本地测试。没有执行任何云端操作，没有 commit / push，没有修改 `.Learning Workspace.qoder.site`，没有创建或预设云账号。

## 一、完成结论

块3 本地实现已完成并通过自动化与隔离浏览器验收：

- `npm install` 后可用 `npm run local` 一条命令构建并启动本地网页。
- 本地网页无需登录、无令牌面板，数据保存在单个 JSON 文件中。
- 本地网页与 MCP stdio 共用同一文件库、同一 `LOCAL_OWNER` 和同一业务 handler。
- agent 经 MCP 提交后，刷新本地网页立即可见；重启服务后数据仍在。
- 云模式未登录时显示三卡片入口页、公开演示凭据、诚实仓库占位和可复制安装提示词。
- 已登录云体验、owner 隔离、认证和令牌逻辑保持不变。
- pending 不重发、明确 4xx failed、重复键对账、32KB、服务器 `received_at` 盖章和上限语义保留。

## 二、改动清单

### 1. 共用数据库与本地服务

新增：

- `scripts/db-core.mjs` + `scripts/db-core.d.mts`：内存库和文件库共用的查询核心，支持 select/eq/order/range/limit/insertIfAbsent/update/delete、唯一键和 23505 语义。
- `scripts/file-db.mjs` + `scripts/file-db.d.mts`：JSON 文件持久化；自动建目录；临时文件写入、fsync、rename 原子替换；跨进程锁目录；默认读取 `LW_LOCAL_DATA_FILE`，未设置时使用 `local-data/lw-local-db.json`。
- `scripts/local-server.mjs` + `scripts/local-server.d.mts`：只监听 `127.0.0.1`，serve `dist/`，同源提供业务五动作；`/api/me` 返回固定本地身份和 `mode: 'local'`；认证/令牌路由返回 404 `local_mode_only`；健康检查、Host 与写请求 Origin 白名单、静态路径穿越防护。

修改：

- `scripts/fake-db.ts`：重构为共用核心的内存外壳，保留同步 `dump` 和原有故障注入控制，22 项原函数测试保持通过。
- `functions/handler.ts`：导出 `submit` 供本地服务与 MCP 复用；MCP 直调时缺字段先安全返回 `missing_evidence`，不再因可选字段缺失在计算 UUID 前异常。
- `package.json`：新增 `"local": "npm run build && node scripts/local-server.mjs"`。
- `.env.example`：增加 `LW_LOCAL_DATA_FILE`、`LOCAL_PORT` 占位，明确本地壳不填云端令牌。

固定本地身份：

```text
LOCAL_OWNER = 00000000-0000-4000-8000-000000000001
```

它是本地数据归属常量，不是账号，不参与认证。

### 2. MCP 本地模式

新增：

- `mcp/local.ts`：本地提交直接调用 handler 的 `submit`；读取通过 `assembleStore(loadRows(...))`；数据库结果无法确认时返回 pending，不自动重发。

修改：

- `mcp/server.ts`：只有 `LW_API_BASE` 与 `LW_USER_TOKEN` 同时配置才走云端；否则走统一文件库。删除旧 `store.json` Store 直改路径。
- `scripts/test-mcp.ts`、`scripts/eval-12cases.ts`：测试改用临时文件库，并通过 `loadRows` + `assembleStore` 读回断言。
- `scripts/submit-block.ts`：真实提交助手改用 `LW_LOCAL_DATA_FILE`，默认指向本地壳同一文件。

### 3. 前端本地态与云入口页

新增：

- `src/content/links.ts`：`repoUrl` 初始为空；旧站地址与 `demo` / `demo-2026` 公开演示凭据单一来源。`repoUrl` 使用字符串类型，主会话后续可直接填真实仓库地址。
- `src/components/LandingPage.tsx`：云模式未登录入口页，包含产品介绍、三条路卡片、演示凭据、仓库诚实占位、旧站链接、提示词读取/复制/手动复制回退，以及原有登录/注册表单。
- `public/setup-prompt.txt`：唯一安装提示词来源，随 `dist` 发布。包含克隆、安装、本地启动、MCP stdio/Skill 配置、真实学习点验证和失败对账规则。

修改：

- `src/api.ts`：`/api/me` 识别 `mode: 'local'`；本地错误文案不再一律称“云端”。
- `src/hooks/useKnowledgeStore.ts`：本地缓存键固定 `lw-store-v3:local`；401 清登录态仅在云模式执行；本地读写仍走同源 API，写后读取对账，不自动重发。
- `src/App.tsx`：本地模式跳过 AuthPanel、TokenPanel、退出和用户名/令牌入口；云模式未登录改为入口页；删除提示区分本地/云端。

### 4. 仓库打包与文档

- 重写 `README.md`：产品一句话、三条路、本地快速开始、MCP/Skill 配置结构、验证步骤、边界、目录地图和测试命令。提示词正文只指向 `public/setup-prompt.txt`，没有复制第二份。
- 扩展 `.gitignore`：忽略 node_modules、dist、local-data、环境文件、本地文件和证据截图目录（含既有 `scripts/archive/`）；保留 setup prompt、skills、scripts、docs 和 `.env.example`。部署描述文件加入忽略，文件本身未改。
- 未新增 LICENSE，等待负责人拍板。

## 三、测试命令与结果

| 命令 | 结果 |
|---|---|
| `npm run sync:functions-model` | 通过；只经同步脚本生成 `functions/model.ts` |
| `cmp shared/model.ts functions/model.ts` | 通过 |
| `npm run build` | 通过；TypeScript 检查与 Vite 生产构建成功 |
| `npm run test:mcp` | 原有 21 项 ALL PASS |
| `npm run eval:12` | C1–C12 与 8 条状态断言 ALL PASS |
| `npm run test:functions` | 29 项 ALL PASS（原 22 + 新增 7） |
| `npm run test:cloud` | 5 项本地模拟云端契约 ALL PASS；没有发出云端请求 |
| `git diff --check` | 通过；只有 Git 的 LF/CRLF 提示，无空白错误 |
| `deno --version` | `deno: command not found`；未做 Deno 类型检查或 Deno 入口运行 |

新增 7 项覆盖：

1. file-db 原子持久化、重建实例读回、唯一冲突 23505、无临时文件残留。
2. 本地 me/health、认证路由 404 安全码、外来 Origin 403。
3. 固定 LOCAL_OWNER 幂等、五动作、32KB、received_at 盖章。
4. MCP stdio 与本地网页共用文件，提交后 store 立即可见，重建实例仍可读。
5. file-db 默认构造读取 `LW_LOCAL_DATA_FILE`，防止服务与 MCP 写入不同文件。
6. MCP 本地写入结果无法确认时返回 pending，不伪装失败、不自动重发。
7. 静态提供唯一提示词、阻断路径穿越。

## 四、浏览器本地实测

使用 Chrome 157 隔离临时 profile、本地 `npm run local` 和系统临时目录中的 JSON 文件完成；没有访问云端，没有使用真实用户数据。

实测链路：

1. 启动后显示诚实空树；页面无登录、退出和“我的令牌”；缓存键为 `lw-store-v3:local`。
2. 网页手动添加一条明确标注“本地验收”的真实测试知识，刷新后仍为 1 条。
3. 经真实 MCP stdio 提交另一条测试知识，返回 accepted；刷新网页后为 2 条，缓存标题与 MCP 返回一致。
4. 打开 MCP 提交的详情，标记“我理解了”，保存真实验收记录，再删除该测试点；回到 1 条。
5. 完全停止并重新运行 `npm run local`，刷新后网页添加的那条仍在，证明重启持久化。
6. 数据目录中只有 JSON 文件，无锁目录或临时文件；仓库内未留下 `local-data/`。测试数据库、候选文件、截图和浏览器 profile 均已清理。

另用 Vite dev 的空假库验证云模式未登录入口页：三卡片、演示凭据、仓库空地址占位、旧站链接、登录/注册表单和提示词均渲染；模拟剪贴板拒绝后正确显示手动复制回退。

实测过程中发现并修复一个真实问题：`createFileDb()` 最初没有读取 `LW_LOCAL_DATA_FILE`，导致本地服务忽略自定义路径，而 MCP 使用了该路径，两边数据分叉。已修复并新增回归测试，随后完整重跑浏览器闭环通过。

## 五、最小实现假设

1. 本地端口默认 8787，可用 `LOCAL_PORT` 修改；只允许对应 localhost / 127.0.0.1 Host 和写请求 Origin。
2. 自定义数据路径时，两个进程必须获得完全相同的绝对路径；Windows 下建议直接使用 `C:/...` 或 `C:\\...`，不要依赖 Git Bash 的 `/tmp` 自动转换。
3. 本地认证路由统一返回 404 `local_mode_only`，不模拟登录成功，也不接受任何本地令牌。
4. 入口页仓库地址未公布时只显示文字占位；不生成猜测 URL。
5. 既有 `scripts/archive/` 是历史截图目录，只加入忽略，不删除。
6. 没有新增云同步、找回密码、OAuth、多本地用户或 LICENSE。

## 六、已知限制与未验证边界

- 本机没有 Deno，未运行 `deno check`、`Deno.serve` 或平台注入模块；生产构建不替代平台函数入口检查。
- 文件锁避免并发 JSON 写入损坏，但 handler 的“读取计划 → 写 concept → 写 application”仍是多个数据库操作，不是跨进程事务。确定性 UUID、唯一键和 3 次重复键重读能对账，但不能承诺强原子性。
- 进程被强制杀死可能留下 `<数据文件>.lock` 目录；确认没有写入进程后才可手动清理。
- 单文件 JSON 面向单用户小规模使用，用户需自行备份；没有云同步或恢复服务。
- 云模式 5 项测试是本地模拟契约，不证明云端数据库、网关、Cookie 或发布环境可用。
- 浏览器实测使用临时数据和临时 profile，截图未写入仓库；不能替代主会话在正式沙箱域名上的回归。
- GitHub 仓库创建、公开性、名称、推送和 LICENSE 均未执行，等待另行授权/拍板。

## 七、给主会话的云端清单

本子代理以下步骤均未执行：

1. 在 `src/content/links.ts` 的 `repoUrl` 填入负责人已批准的真实 GitHub 仓库地址；当前必须保持空占位，不要放假链接。
2. 重新运行 `npm run sync:functions-model`、`cmp shared/model.ts functions/model.ts`、`npm run build`，确认 `dist/setup-prompt.txt` 存在。
3. 向负责人报备后，对评委沙箱 `https://learning-workspace-multi-v5d3qx7uw3a.qoder.zone` 使用新 action 重新 prepare：复用原 projectId，`webDirectory=dist`、`functionDirectory=functions`、`databaseAccess=read_write`、最新 schemaRef；不新增 Secret，不改数据库结构。
4. 经负责人确认后 publish，确认 public 访问策略保持公开。
5. 匿名回归入口页：三卡片、仓库真实链接、旧站链接、`demo` / `demo-2026`、提示词加载与复制回退、下方登录/注册。
6. 已登录回归：演示账号或随机账号登录 → 空树/既有数据 → 提交 → 刷新读回 → 标记 → 验收 → 删除；个人令牌创建/列表不显示明文/吊销；未登录业务口 401、跨 owner 404、Origin、32KB。
7. 复跑 `scripts/accept-sandbox.mjs` 的 25 项真实沙箱验收。该脚本会创建随机测试账号和真实测试知识，属于云端写入，必须由主会话报备后执行。
8. 旧站保持现状；GitHub 建仓库/push 与 LICENSE 另行确认。

## 八、安全与交付状态

- 未执行任何云端 ensure、迁移、prepare、publish、Secret、环境变量或站点访问策略操作。
- 未 commit、未 push。
- 未把真实密码、会话、个人令牌、数据库凭证或供应商原始错误写入仓库、报告或日志；仓库仅包含故意公开的演示凭据 `demo` / `demo-2026`。
- 未修改 `.Learning Workspace.qoder.site`。
- 测试产生的本地数据和浏览器临时文件已清理。
