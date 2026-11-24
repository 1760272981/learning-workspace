# 块2 任务书：多用户（自建登录 + 每人数据隔离 + 每人令牌）

日期：2026-11-24。负责人已拍板"现在改多用户"。执行分工：子代理只做本地代码与本地测试；**任何云端操作（ensure_backend/迁移/prepare/publish/Secret/环境变量）一律不做**，由主会话逐项向负责人报备后执行。不 commit、不 push。

## 0. 必读

项目内：
- `docs/handover.md`（权威日志与协作规则）、`docs/design-tables-draft.md`（含 2026-11-24 多用户决策与新排期）、`docs/block1-implementation-report.md`
- `shared/model.ts`（校验/上限/幂等单一来源）、`functions/`（handler/core/database/model/adapter）、`mcp/server.ts`、`mcp/cloud.ts`、`src/hooks/useKnowledgeStore.ts`、`src/api.ts`、`scripts/test-functions.ts`、`scripts/test-mcp-cloud.ts`、`scripts/sync-functions-model.mjs`

平台参考（只读，路径在本机 Qoder 安装目录）：
- `C:/Users/Admin/AppData/Local/Programs/Qoder CN/.qoder-versions/0.5.17/resources/extensions/qoder.sites/dist/plugin/skills/sites-building/references/function-backend.md`
- 同目录 `references/application-auth.md`、`references/database.md`、`references/database-migration.md`
- 同目录 `assets/function-backend/`（index.ts、routes.mjs、schema.sql 范例）
- 同目录 `assets/application-auth/password/`（README.md、schema.sql、functions/ 全部、test/）——**密码登录实验室，改造复用，不要从零写认证**

## 1. 目标架构

新站点将用 `function_backend` 访问模型（主会话云端建）：平台注入私有数据库凭证，accessPolicies=[]（固定私有策略），**不再有匿名直连库的可能**。函数入口改用 `assets/function-backend/index.ts` + `routes.mjs` 的模式（Deno.serve、平台注入 backend 模块），**不再用 legacy 匿名适配器**（functions/adapter.mjs 保留但新入口不引用它；旧站代码路径不破坏）。

业务路由同 origin `/functions/v1/app/api/...`。身份两条路：
- 浏览器：会话 cookie（`__Host-lw_session`，Secure、HttpOnly、SameSite=Lax、Path=/），会话表只存令牌摘要。
- agent/MCP：`Authorization: Bearer <个人令牌>`，令牌表只存摘要，明文仅在创建时返回一次。

**owner 一律服务器侧推导**（会话或令牌查表），绝不接受请求体里的 owner/user 字段。未认证业务口 401；认证后访问他人资源 404（不泄露存在性）。

## 2. 数据表（新站空库，CREATE 而非 ALTER）

迁移草稿写 `docs/block2-migration.sql`，**只用已验受限子集**：app schema、uuid/text/integer/timestamptz/jsonb、PRIMARY KEY/UNIQUE/NOT NULL。**不用 REFERENCES、不用 CHECK**（实验室 schema.sql 里的外键要去掉，归属由函数谓词强制）。

认证四表（改造实验室 schema）：
- `app.lw_users`：id uuid PK、username text NOT NULL UNIQUE、password_salt text NOT NULL、password_hash text NOT NULL、password_iterations integer NOT NULL、created_at timestamptz NOT NULL
- `app.lw_sessions`：token_digest text PK、user_id uuid NOT NULL、created_at、expires_at timestamptz NOT NULL、revoked_at timestamptz（可空）
- `app.lw_auth_limiter`：key text PK、window_started_at timestamptz NOT NULL、attempt_count integer NOT NULL
- `app.lw_tokens`：token_digest text PK、user_id uuid NOT NULL、label text NOT NULL、created_at timestamptz NOT NULL、revoked_at timestamptz（可空）

业务四表（沿用块1 结构 + owner）：
- `app.lw_concepts`：块1 列 + `owner_id uuid NOT NULL`
- `app.lw_marks`：块1 列 + `owner_id uuid NOT NULL`，UNIQUE(project_id, concept_id) 保留
- `app.lw_applications`、`app.lw_verifications`：列不变；归属经 concept 的 owner 校验（读写前先验 concept 归属）
- 索引如平台支持再议，草稿先不加（受限子集未验 CREATE INDEX）

 retention：过期会话与限流行会累积——函数内顺手清理过期会话（登录时删本人过期行即可，不做全局定时任务），报告里如实写明限流行保留策略缺口。

## 3. 认证与令牌行为

- 注册：username（3–32 字符、字母数字下划线）、password（≥8 字符）；PBKDF2-SHA256（crypto.subtle，迭代数沿用实验室 passwords.mjs），盐随机；用户名重复→409 安全码。注册成功即建会话。
- 登录/注册走固定窗口限流（实验室 limiter.mjs，按 username+动作 key）。
- 会话有效期 7 天；过期/吊销→401；登出吊销当前会话并清 cookie。
- 个人令牌：登录态下创建（label 必填）、列表（不返回明文）、吊销；Bearer 校验查摘要+未吊销。
- 所有认证失败只回固定安全码（invalid_credentials / session_expired / token_revoked / rate_limited 等），不记录不回传原始错误。
- 密码/令牌明文绝不落库、绝不进日志、绝不进仓库。

## 4. 业务行为（沿用块1 语义，加 owner _scope）

- `GET ?action=store` 改为需认证（会话或 Bearer），只返回本人数据；前端未登录时显示登录/注册页，不请求 store。
- submit/mark/verify/delete：需认证；owner 服务器推导；跨 owner 的 concept_id→404 concept_not_found。
- 幂等 ID 加 owner：conceptUuid = stableUuid(['concept', owner_id, project, normTitle(title)])；applicationUuid = stableUuid(['application', concept_id, output_ref]) 不变；markUuid = stableUuid(['mark', owner_id, project, concept_id])。
- 上限（每产出 2 条、每项目每日新增 3 条）自然按 owner 生效：loadRows 后先按 owner 过滤再 assembleStore。
- 失败语义不变：超时/5xx/响应异常=pending 不自动重发；明确 4xx=failed；重复键重读对账（3 次循环）保留。
- 服务器盖章 received_at 保留；POST 同站 Origin 要求保留（网关规则）。
- 请求体 32KB 上限保留。

## 5. MCP 与前端

- `mcp/cloud.ts`：写请求头改 `Authorization: Bearer <token>`（替代 x-lw-write-key）；**Origin 头、12s 超时、redirect:error、pending/failed 语义全部保留**。
- `mcp/server.ts`：环境变量改 `LW_API_BASE` + `LW_USER_TOKEN`；两者齐备走云端，否则本地 store.json 开发模式。`.env.example` 更新占位（LW_WRITE_KEY 占位移除）。
- 前端：登录/注册视图（大白话文案，风格与现树 UI 一致）；会话检查 `/api/me`；树与所有写操作在登录态后；右上角"写入密钥"入口替换为"我的令牌"面板（创建/复制一次/吊销/列表）；移除 sessionStorage 密钥逻辑；localStorage 缓存键改 `lw-store-v3:<userId>`（防同浏览器串号），登出清缓存与内存态；未登录诚实空态/登录页，不放假数据。
- `shared/model.ts` 尽量不动；若必须动，跑 `npm run sync:functions-model` 重新生成 functions/model.ts，不手改生成文件。

## 6. 测试与交付

- 扩展 `scripts/test-functions.ts`（假 supabase 注入，沿用现有风格）：双用户隔离（A 读/写/删 B 的 concept 全 404）、未登录 401、错密码 401、过期会话 401、吊销令牌 401、限流触发、注册重复 409、令牌创建/列表/吊销、owner 幂等（同标题不同 owner 不冲突）、上限按 owner 独立。
- 更新 `scripts/test-mcp-cloud.ts` 为 Bearer 语义（5 项保留）。
- 现有 21 项 MCP 自测 + 12 例评估 + `npm run build` 全过。
- 实验室自带 `node --test test/check.mjs` 如改造后仍适用则跑，不适用写明原因。
- 交付 `docs/block2-implementation-report.md`：改动清单、测试结果、已知限制（**本机无 Deno、未做本地类型检查；双账号真实隔离靠新站部署后验收**）、给主会话的云端步骤清单（ensure_backend 新 project function_backend → 迁移 apply → APP_ORIGIN 环境配置（非 secret）→ prepare/publish → 验收请求清单：未登录 401、双账号 404、注册登录提交读回、MCP 令牌提交、演示账号）。
- 演示账号由主会话云端验收时注册（用户名 demo 类），**子代理不预设任何账号数据进仓库**。

## 7. 禁止

不碰云端；不 commit/push；不写真实密钥/令牌进仓库；不造假演示数据；不改旧站 descriptor（`.Learning Workspace.qoder.site`）；不擅自加功能（无邮箱验证、无找回密码、无 OAuth、无账号管理后台——实验室边界即本期边界）；失败不连环重试云端（子代理根本无云端权限）。