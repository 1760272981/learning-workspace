# 块2：多用户本地实施报告

日期：2026-11-24  
范围：只改本地代码、迁移草稿和本地测试。没有执行任何云端操作，没有 commit / push，没有修改 `.Learning Workspace.qoder.site`，没有创建或预设演示账号。

## 一、完成结论

块2 本地代码已完成：

- 平台密码登录实验室已改造复用：用户名密码注册、登录、7 天会话、登出、固定窗口限流。
- 浏览器使用 `__Host-lw_session` 会话 Cookie；agent/MCP 使用个人 Bearer 令牌。
- 会话表和个人令牌表只存 SHA-256 摘要，不存明文。
- 业务四表已加 owner 隔离；owner 只由服务端会话或令牌查表推导。
- 未登录业务口返回 401；认证后访问他人 concept 的写操作返回 404。
- 函数入口已改为 `function_backend` 模式，不再引用 legacy 匿名适配器。
- 前端已接入登录/注册、会话检查、按用户缓存和“我的令牌”面板。
- MCP 已从共享写密钥改为 `LW_USER_TOKEN`。
- 块1 的 pending/failed、Origin、32KB、服务器盖章和重复键对账语义保留。

## 二、改动清单

### 1. 函数后端

新增：

- `functions/http.mjs`：复用实验室 HTTP 基础模块，请求体上限改为 32KB，错误只回固定安全码。
- `functions/passwords.mjs`：复用实验室 PBKDF2-SHA256，600000 次迭代，随机盐。
- `functions/sessions.mjs`：复用实验室会话模块，Cookie 改为 `__Host-lw_session`，有效期改为 7 天，表改为 `lw_sessions`。
- `functions/limiter.mjs`：复用实验室固定窗口 CAS 限流，表改为 `lw_auth_limiter`。
- `functions/validate.mjs`：复用实验室输入校验；按任务书把密码下限改为 8 字符，用户名只允许字母、数字、下划线。
- `functions/tokens.mjs`：个人令牌创建、分页列表、吊销和 Bearer 校验。
- `functions/routes.mjs`：认证、令牌和业务路由；依赖注入用于本地测试。
- `functions/routes.d.mts`：本地 TypeScript 测试所需的路由声明。

修改：

- `functions/index.ts`：改用平台注入的 `createDatabaseClient` / `createSiteContext`，开启 `forwardApplicationCredentials`，保留 `Deno.serve`。
- `functions/handler.ts`：业务口接收服务端推导的 `ownerId`；所有 concept 操作先验 owner；32KB 按实际流读取；保留 3 次重复键重读对账。
- `functions/database.ts`：改为 function_backend 的直接 `db.from(...)` / `insertIfAbsent` 接口；读取先按 owner 过滤；mark 使用确定性 ID 和 owner 条件更新。
- `functions/core.ts`：concept UUID 改为 `['concept', owner_id, project, normTitle]`；concept/mark 行带 owner；移除旧写密钥闸门。
- `functions/model.ts`：运行同步脚本重新生成，内容与 `shared/model.ts` 一致；`shared/model.ts` 未改。

保留未引用：

- `functions/adapter.mjs` 原样保留，新入口不引用它。

### 2. 前端

修改：

- `src/api.ts`：新增登录、注册、退出、会话检查、令牌管理；业务接口改到 `/functions/v1/app/api/...`；移除 `sessionStorage` 写密钥。
- `src/hooks/useKnowledgeStore.ts`：未登录不请求 store；登录后按 `lw-store-v3:<userId>` 读写缓存；登出清缓存和内存；401 清除当前登录态；写操作仍不自动重发。
- `src/App.tsx`：未登录显示登录/注册页；登录后显示用户名、退出和“我的令牌”；切号清空旧界面状态。

新增：

- `src/components/AuthPanel.tsx`：大白话登录/注册表单，密码提交后立即从表单清空。
- `src/components/TokenPanel.tsx`：创建、复制一次、清除显示、列表和吊销；令牌明文只在组件内存中短暂存在。

本地开发：

- `vite.config.ts` 的开发中间件直接调用真实 `routes.mjs`，只把数据库换成凭据无关的内存假库。
- 本地开发库启动为空，不预置账号或知识数据，重启即清空；不连接云端。

### 3. MCP 与配置

- `mcp/cloud.ts`：请求头改为 `Authorization: Bearer <LW_USER_TOKEN>`；保留 Origin、12 秒超时、`redirect: 'error'`、5xx/断网/异常响应 pending、明确 4xx failed。
- `mcp/server.ts`：只有 `LW_API_BASE` 和 `LW_USER_TOKEN` 都配置时才走云端，否则继续本地 `store.json` 开发模式。
- `.env.example`：移除 `LW_WRITE_KEY`，改为 `LW_USER_TOKEN` 占位。
- `scripts/test-mcp.ts`、`scripts/eval-12cases.ts`：本地测试显式清空新云端配置。

### 4. 迁移草稿

- 新增 `docs/block2-migration.sql`。
- 共八张表：`lw_users`、`lw_sessions`、`lw_auth_limiter`、`lw_tokens`、`lw_concepts`、`lw_applications`、`lw_verifications`、`lw_marks`。
- 只使用任务书允许的基础类型、主键、唯一和非空约束；无外键、检查约束、索引、默认值、种子数据或权限语句。
- `lw_concepts`、`lw_marks` 带 `owner_id`；applications/verifications 通过 concept 归属校验。
- function_backend 迁移的 `accessPolicies` 应为 `[]`，由平台生成固定私有策略。

### 5. 测试

- 新增 `scripts/fake-db.ts`：支持直接表接口、唯一约束、分页、CAS 更新、删除和可控的“已提交但响应丢失”。
- 扩展 `scripts/test-functions.ts`：由原 10 项纯逻辑测试扩为 22 项真实路由 + 假数据库测试。
- 更新 `scripts/test-mcp-cloud.ts`：5 项 Bearer 云端契约测试。

## 三、测试命令与结果

| 命令 | 结果 |
|---|---|
| `npm run sync:functions-model` | 通过 |
| `cmp shared/model.ts functions/model.ts` | 通过 |
| `npm run build` | 通过；TypeScript 检查和 Vite 生产构建成功 |
| `npm run test:mcp` | 原有 21 项 ALL PASS |
| `npm run eval:12` | C1–C12 与 8 条状态断言 ALL PASS |
| `npm run test:functions` | 22 项 ALL PASS |
| `npm run test:cloud` | 5 项 ALL PASS |
| `git diff --check` | 通过；只有 Git 的 LF/CRLF 提示，无空白错误 |
| `node -e` 迁移静态检查（去注释后校验） | 通过；8 张表，无外键、检查约束、DML、权限语句或索引 |
| `deno --version` | `deno: command not found`，因此未做 Deno 类型检查或 Deno 入口运行 |

`test:functions` 覆盖：

- 模型副本、owner 确定性 UUID、accepted/linked/幂等、产出上限、每日上限、Store 拼装。
- 注册 Cookie 属性、密码与会话明文不落库、重复注册 409、错密码 401。
- 未登录 401、过期会话 401、登出吊销。
- 令牌创建/列表/Bearer 使用/吊销后 401。
- 双用户数据隔离；B 对 A 的 concept 做 mark/verify/delete 全部 404。
- 同标题不同 owner 不冲突，同 owner 重试不增行。
- 产出上限和每日上限按 owner 独立。
- 登录限流 429、Origin 拒绝、32KB 上限、服务器 `received_at`、未知写入不重放。

实验室自带的 `node --test test/check.mjs` 未运行：本项目没有复制实验室的 `test/` 目录，而且其表名、15 字符密码策略和 notes 路由已不适用；等价且扩展后的认证/业务契约由 `scripts/test-functions.ts` 执行。

### 浏览器本地实测

使用隔离的临时 Chrome 和本地 Vite 内存后端完成：

- 随机账号注册 → 诚实空状态。
- 创建个人令牌 → 显示一次明文 → 复制按钮在无剪贴板权限时正确回退为手动复制 → 清除明文 → 吊销。
- 添加一条明确标注“本地验收”的测试知识 → 刷新读回 → 标记理解 → 保存验收 → 删除 → 回到空状态。
- 退出 → 登录页；`localStorage` 的 `lw-store-v3:*` 清空，旧 `lw-write-key` 不存在。
- 再次随机注册后退出，用同一账号密码重新登录成功。
- 本地截图保存在临时目录，未写入仓库；测试账号和测试知识只存在于已关闭的本地内存进程。

这些浏览器结果证明本地 UI 和真实路由闭环可用，不证明云端数据库、网关或发布环境可用。

## 四、最小实现假设

1. 用户名注册时去首尾空白并转小写；允许 3–32 位字母、数字、下划线。任务书没有要求首字符必须是字母，因此下划线开头也允许。
2. 密码按任务书至少 8 字符；保留实验室 256 UTF-8 字节上限，防止无界 PBKDF2 输入。
3. 令牌创建、列表和吊销只允许浏览器会话；Bearer 令牌用于 `/api/me` 和业务读写，不用于再创建令牌。
4. 新业务路径使用 `/api/store`、`/api/submit` 等；同时保留根路径 `?action=...` 作为块1/MCP 兼容入口。
5. 没有新增单条 concept 读取接口。跨 owner 的“读”由 store 的 owner 过滤保证；现有 mark/verify/delete 对他人 concept 返回 404。
6. 登录时最多检查并清理本人 100 条会话记录中的过期行，清理失败不阻断登录。
7. 本地开发使用空内存库和真实路由，不把假数据带进生产构建。

## 五、已知限制与未验证边界

- 本机没有 Deno，未运行 `deno check`，也未本地运行 `Deno.serve` 或平台注入的 `_qoder/backend.mjs`。`npm run build` 检查了前端、MCP、脚本及 `functions/core.ts`、`database.ts`、`handler.ts`，但不替代 Deno 入口检查。
- 双账号真实隔离、Provider 并发、网关凭据转发、Cookie 在正式 HTTPS 域名下的行为和 Tenant RLS，必须在新站部署后验收。
- 多行写入仍不是数据库事务。确定性 UUID、唯一约束和 3 次重读对账能避免重复，但不能保证 concept + application 或 delete 的强原子性；补偿删除也可能失败。
- 网络超时、5xx、响应格式异常仍按“结果未知”处理，不自动重发；前端/MCP 只能刷新读取或按原键人工对账。
- 限流行没有保留/清理策略，会累积；任务书已明确要求如实记录。过期会话只在登录时尽力清理。
- 令牌创建如果已落库但响应丢失，服务端不会重放；明文无法恢复，只能刷新列表后吊销并新建。
- `APP_ORIGIN` 必须配置为固定 HTTPS 来源；空配置会失败关闭，不能从请求 Host 头猜测。
- 未增加邮箱验证、找回密码、OAuth、账号管理或任何演示账号。
- 旧站保持现状；新站验收通过前不停用、不归档、不删除旧站。

## 六、给主会话的云端步骤清单

以下步骤本子代理均未执行，需主会话逐项向负责人报备后进行。

1. **新建站点/项目**：先 `get_site(include: ["backend"])` 核实目标；legacy 不能原地切换，新站使用 `ensure_backend` 开通 `database` + `functions`，并指定 `databaseAccessModel: "function_backend"`。
2. **配置来源**：新站取得正式域名后，在站点环境配置中设置非 secret 的 `APP_ORIGIN=https://<正式域名>`。密码路线不需要 `APP_AUTH_SECRET`，也不要把 `QODER_DATABASE` 加进 `secretNames`。
3. **准备迁移**：重新读取新库 schema；以 `docs/block2-migration.sql` 创建迁移计划，`accessPolicies: []`。先审查计划中的八张表、列和约束，再应用精确 `planRef`；应用后重新读取并核验。
4. **本地复核**：打包前运行 `npm run sync:functions-model` 和 `npm run build`。不要手改 `functions/model.ts`。
5. **prepare**：使用新 `projectId`、`webDirectory: "dist"`、`functionDirectory: "functions"`、`databaseAccess: "read_write"`、迁移后最新 `schemaRef`。本密码方案无应用 Secret 名，`APP_ORIGIN` 按非 secret 环境配置处理。
6. **发布**：经负责人确认后 publish；先检查健康和登录页，再验收业务口。
7. **真实验收清单**：
   - 无 Cookie `GET /api/store` → 401；无 Cookie 写口 → 401。
   - 注册 A/B；错密码 → 401；重复注册 → 409；连续错误登录达到上限 → 429。
   - A 提交后 store 只看到 A；B 的 mark/verify/delete 指向 A 的 concept → 404 `concept_not_found`。
   - 过期会话 → 401；登出后旧 Cookie → 401。
   - 创建令牌、列表不返回明文、吊销后 Bearer → 401 `token_revoked`。
   - MCP 配置 `LW_API_BASE=https://<域名>/functions/v1/app` 和 `LW_USER_TOKEN`，提交后网页可见；请求带 Origin，超时不自动重发。
   - 注册→登录→提交→刷新读回→标记→验收→删除全链路。
   - 验证 32KB、Origin、received_at、owner 幂等和 owner 独立上限。
8. **演示账号**：由主会话在云端验收时注册，不在仓库或迁移中预置。
9. **旧站处置**：新站全部通过后再单独请负责人拍板停用/归档/删除；本块不改旧 descriptor。

## 七、安全与交付状态

- 未执行云端 ensure、迁移、prepare、publish、Secret 或环境变量操作。
- 未 commit、未 push。
- 未把真实密码、会话令牌、个人令牌、数据库凭证或原始供应商错误写入仓库、报告或日志。
- `.Learning Workspace.qoder.site` 未被本次工具写入，修改时间保持为 2026-11-24 22:30:52 +0800。
- 迁移草稿未执行；真实隔离以新站部署后的双账号请求为准。
