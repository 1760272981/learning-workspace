# 第一块：云端读写闭环 · 本地实施报告

日期：2026-11-24  
范围：只实现本地代码与测试。没有执行云端迁移、prepare、publish、密钥配置或线上写操作；没有 commit / push。

## 一、已完成

### 1. 云端函数 `functions/`

- `index.ts`：`Deno.serve` + 原样复制的 `serveSite` 适配器，使用 `npm:@supabase/supabase-js@2.57.4`。
- `adapter.mjs`：与 `probe-functions/adapter.mjs` 逐字节一致，探针目录未改。
- `handler.ts`：实现 `store / submit / mark / verify / delete` 五个动作。
- `database.ts`：只访问 `app.lw_concepts / lw_applications / lw_verifications / lw_marks`，分页读取，不记录原始供应商错误。
- `core.ts`：拼装 Store、派生上限计数、生成写入计划、密钥闸门判断、确定性 UUID。
- `model.ts`：由同步脚本从 `shared/model.ts` 复制，不手改。

提交规则仍由 `shared/model.ts` 的 `applySubmit` 执行，没有另写一套四态规则：

- `accepted`：插一条概念和一条应用。
- `linked`：已有概念关联新产出时只插应用；同产出重试不插任何行。
- `missing_evidence / over_limit`：不写表。
- 上限从应用行派生：`output_ref` 计数；每个概念第一条应用的 `received_at` 日期计入当天新增。
- `received_at` 由服务器在收到已授权写请求时盖章。
- 概念 ID 由项目 + 规范标题生成确定性 UUID；应用 ID 由概念 ID + `output_ref` 生成。遇到唯一键冲突会重新读取对账，不靠自动重发网络请求。

### 2. 前端接云

- 启动时请求 `?action=store`，云端数据为权威；成功读取后写入 `localStorage` 作为缓存。
- 读取失败时，有缓存就显示缓存和“数据可能不是最新”的提示；没有缓存就显示空状态，不造数据。
- 缓存键升级为 `lw-store-v2`，不再读取旧演示缓存；`demoStore` 兜底和默认引用已移除。`src/data/demo-project.ts` 仅保留文件。
- 手动添加、标记、验收、删除全部走密钥写接口；没有密钥时明确阻止并提示。
- 右上角新增“写入密钥”入口，只存 `sessionStorage`，当前标签页会话有效；不写 localStorage、代码、仓库或构建产物。
- 未填密钥等写错误固定在弹窗底栏显示，避免首屏看不到失败原因。
- 写请求超时、断网、5xx 或响应无法确认时提示“结果未知，先读取对账，不要直接重发”。
- 删除不再提供本地“撤销”，因为没有对应云端撤销接口。
- 高竖向 2D SVG 树、滚动和点击交互保持不变。
- Vite 开发服务器只保留本地 `store.json` 的只读 `/api/store?action=store`；开发态写请求返回 405，不伪装成功。

### 3. MCP 接云

- `LW_WRITE_KEY` 和 `LW_API_BASE` 都配置时，`submit_learning_block` 提交到云端 `?action=submit`。
- Node fetch 显式带 `Origin = LW_API_BASE 的 origin`，避免探针实测过的网关 403。
- 超时、断网、重定向失败、5xx 或成功响应格式异常时返回 `status: "pending"`，不自动重发，并提示按原幂等键对账。
- 明确的 4xx 拒绝返回 `status: "failed"` 和安全的错误码，不回传原始响应。
- 两个环境变量未同时配置时，继续使用原 `mcp/data/store.json` 本地开发模式。

### 4. 配置与迁移草稿

- `.env.example` 增加 `LW_WRITE_KEY=`、`LW_API_BASE=` 占位和“真值不进仓库”说明。
- `.gitignore` 覆盖 `.env`、`.env.*`，并保留 `.env.example`。
- `docs/block1-migration.sql` 包含四张正式表的 CREATE TABLE 和 accessPolicies JSON 草稿；`lw_probe` 保持 deny。
- SQL 只使用平台受限子集，无 CHECK、无种子数据、无原始 GRANT / RLS。

## 二、改动文件清单

新增：

- `functions/index.ts`
- `functions/adapter.mjs`
- `functions/handler.ts`
- `functions/database.ts`
- `functions/core.ts`
- `functions/model.ts`（生成文件）
- `mcp/cloud.ts`
- `src/api.ts`
- `scripts/sync-functions-model.mjs`
- `scripts/test-functions.ts`
- `scripts/test-mcp-cloud.ts`
- `docs/block1-migration.sql`
- `docs/block1-implementation-report.md`

修改：

- `mcp/server.ts`
- `src/hooks/useKnowledgeStore.ts`
- `src/App.tsx`
- `src/components/AddKnowledgeModal.tsx`
- `src/components/NodeDetail.tsx`
- `vite.config.ts`
- `tsconfig.json`
- `package.json`
- `scripts/test-mcp.ts`
- `scripts/eval-12cases.ts`
- `.env.example`
- `.gitignore`

未改：

- `probe-functions/`
- `shared/model.ts`
- `src/data/demo-project.ts`
- `.Learning Workspace.qoder.site`
- 云端任何资源

## 三、测试命令与结果

| 命令 | 结果 |
|---|---|
| `npm run sync:functions-model` | 通过；副本与 `shared/model.ts` 一致 |
| `npm run build` | 通过；TypeScript 检查和 Vite 构建成功 |
| `npm run test:mcp` | 原有 21 项 ALL PASS |
| `npm run eval:12` | C1–C12 与 8 条状态断言 ALL PASS |
| `npm run test:functions` | 新增 10 项 ALL PASS |
| `npm run test:cloud` | 新增 5 项 ALL PASS |
| `cmp probe-functions/adapter.mjs functions/adapter.mjs` | 通过 |
| `cmp shared/model.ts functions/model.ts` | 通过 |
| `git diff --check` | 通过 |

新增处理器测试覆盖：模型副本一致、密钥闸门、缺证据、accepted 写入计划、同产出幂等、linked 只加应用、产出上限、每日上限、Store 拼装（含标记和验收）、确定性 UUID。

新增 MCP 云端测试覆盖：Origin 和密钥头、断网/超时 pending 且只调用一次、5xx pending、明确 403、非法 API_BASE 不发请求。

本地浏览器实测：

- 无数据时显示“还没有学习点，用 MCP 提交或手动添加”。
- 写入密钥保存后只出现在 `sessionStorage`。
- 未填密钥提交时显示明确提示，不发出云端写请求。
- 用浏览器内测试接口走通：添加 → 刷新读取 → 标记理解 → 保存验收 → 删除 → 空状态。
- 阻断 `/api/store` 读取后，页面显示缓存中的树和缓存可能过期的提示。
- 浏览器成功路径使用的是测试接口，不是云端验收；不能据此宣称数据库或函数已上线可用。

本机 `deno` 不存在，未运行 `deno check` 或 `Deno.serve`。`npm run build` 已检查 `functions/core.ts / database.ts / handler.ts`，但 `functions/index.ts` 的 Deno 入口和平台适配器运行时仍须部署后验证。

## 四、已知限制与上线前阻塞

### 1. legacy 权限与适配器有冲突，必须先解决

当前站点的数据库访问模型是 **legacy**，而 `serveSite` 适配器固定使用 `SUPABASE_ANON_KEY` 访问 `/rest/v1`。

迁移草稿按设计稿只给四张正式表 `anonymous select`。如果直接应用这份策略，函数的 `insert / update / delete` 也会使用匿名身份，可能一起被拒绝。也就是说：

> “匿名仅 select”与“当前 legacy 匿名适配器负责写”不能直接同时成立。

主会话在 D2 不能只看构建通过就发布。必须先确认平台支持的写路径，例如由平台确认函数 backend 的专用数据库身份/策略；如果平台确实做不到，需要负责人明确选择是否接受 legacy 匿名可写的残余风险。不要为了让测试通过而擅自把正式表改成匿名 CRUD。

### 2. 多行写入没有数据库事务

当前 REST 路径没有可靠事务：

- accepted 先插概念再插应用；应用写入失败时尝试删除刚建的空概念，但补偿删除本身也可能失败。
- delete 按应用、验收、标记、概念顺序删除，极端失败可能留下部分行。
- 确定性 UUID 和重新读取能避免重复写，但不能保证多行原子性。

真实上线后要专门检查失败路径；本报告不宣称强事务或强隔离。

### 3. 其他边界

- 这是单负责人、单写密钥的公开读产品，不是多用户认证系统。
- 绕过函数直连数据库的隔离未验证，legacy 残余风险仍在。
- `SubmitInput` 契约没有提交方 `created_at` 字段，因此 `created_at` 由共享模型在服务端生成；服务器接收时间单独存 `received_at`。
- 本地开发态只能读 `store.json`，写操作要部署后验证。
- 平台函数运行时、CORS/Origin 网关、真实数据库权限均未在本地验证。

## 五、主会话云端阶段要做的事

1. **先解决上面的 legacy 写权限冲突**，再决定迁移策略；不得未经确认应用草稿。
2. 打包前运行 `npm run sync:functions-model`，再运行 `npm run build`。不要手改 `functions/model.ts`。
3. 重新读取数据库目录，按 `docs/block1-migration.sql` 创建迁移计划并审查；确认后另行报备执行。保持 `lw_probe` deny。
4. 负责人在平台专用输入框填写 `LW_WRITE_KEY`；本地 MCP 只在环境变量中配置真值。值和原始供应商错误不进聊天、仓库、报告。
5. 本地 MCP 配置 `LW_WRITE_KEY` 与 `LW_API_BASE`；`LW_API_BASE` 填完整函数入口，发布后使用。
6. prepare 使用 `webDirectory: "dist"`、`functionDirectory: "functions"`、`databaseAccess: "read_write"`、最新 `schemaRef`、`secretNames: ["LW_WRITE_KEY"]`，复用原 `projectId`。
7. 经负责人确认后 publish，先做匿名只读，再做带密钥写入。
8. 真实请求验收至少覆盖：
   - 匿名 `GET ?action=store` 返回 200，无 cookie 也能读。
   - 无密钥 `POST ?action=submit` 返回 403。
   - 带密钥提交返回 200，读回概念、应用、`received_at` 一致。
   - 同产出重复提交返回 linked，数据库不增加重复行。
   - 产出上限和每日上限返回 over_limit。
   - mark / verify / delete 写后读回一致。
   - MCP 云提交带 Origin；模拟断网/超时时返回 pending 且不自动重发。
   - 公开网页在无登录浏览器中显示 MCP 提交的真实节点。
