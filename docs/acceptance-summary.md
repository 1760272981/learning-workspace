# 验收总表（2026-11-25 汇总）

权威明细与请求编号见 docs/handover.md；本表为参赛材料引用的汇总。所有"通过"均为主会话亲自复跑或真实 HTTP/浏览器实测，非子代理自报。

## 一、本地自动化（主会话复跑）

| 套件 | 项数 | 结果 | 覆盖 |
|---|---|---|---|
| scripts/test-mcp.ts | 21 | ALL PASS | MCP 四态/上限/幂等/危险 URL/概念应用分离 |
| scripts/eval-12cases.ts | 12+8 断言 | ALL PASS | 该推/易误推/重复/缺证据/版本变化 |
| scripts/test-functions.ts | 29 | ALL PASS | 模型副本、owner 幂等、认证/会话/令牌/限流、双用户隔离、file-db 原子持久化、本地路由、MCP 同库、pending 不重放、路径穿越 |
| scripts/test-mcp-cloud.ts | 5 | ALL PASS | Bearer+Origin 契约、pending/failed 语义（本地模拟，不证明云端） |
| npm run build | — | 通过 | tsc -b + Vite 生产构建 |
| sync:functions-model + cmp | — | 一致 | 生成文件未手改 |

## 二、跨进程硬指标（主会话独立复跑）

本地服务(127.0.0.1:8791, 临时数据文件) → 真实 MCP stdio 提交 accepted → 网页 /api/store 读回 1 条 → 杀进程重启再读回 1 条 → **PASS**；临时目录已清理。

## 三、云端真实验收

| 轮次 | 内容 | 结果 |
|---|---|---|
| 探针 A（2026-11-24，旧站临时函数） | ping 200 / 无密钥 403 / 带密钥 200 / 读回匹配 | 4/4，含 Origin 网关排障记录 |
| 块1 匿名侧（旧站正式发布后） | store GET 200 空树 / 无密钥 submit 403 | 2/2 |
| 沙箱首轮（新站发布+公开后） | accept-sandbox.mjs | 25/25（首轮 23/2，两 FAIL 为脚本断言过严，定位后修断言复跑全过） |
| 沙箱回归（入口页重发布后） | accept-sandbox.mjs 复跑 | 25/25 |
| 入口页匿名浏览器实测 | browser-use snapshot | 三卡片+演示凭据+真实仓库链接+旧站链接+提示词复制框+登录/注册 全在 |

25 项覆盖：匿名 health 200、未登录 store/submit 401、缺 Origin 403（网关层）、注册 201+__Host Cookie、错密码 401、重复注册 409、提交 accepted+读回计数、双账号互读不到、跨 owner mark/delete 404、个人令牌创建/列表无明文/Bearer 提交 linked/Bearer me/吊销后 401、登出清 Cookie+旧 Cookie 401、32KB 413、演示账号注册+登录。

## 四、诚实披露（未验证/已知限制）

- 本机无 Deno：未做 deno check / Deno.serve 本地运行；函数运行时正确性以部署后真实请求为准。
- 旧站为 legacy 匿名适配器：四表匿名读+写为负责人拍板的限期测试授权，"绕过函数直连库"边界未验、非生产安全保证；新站 function_backend 为私有凭证+固定私有策略，无此残余。
- 多行写入非数据库事务：确定性 UUID+唯一键+3 次重读对账防重复，不承诺强原子；补偿删除可能失败。
- 文件库锁目录非跨进程事务；强杀进程可能留 .lock 目录；单文件 JSON 需用户自备份。
- 限流行无清理策略会累积；过期会话仅登录时尽力清理。
- 无邮箱验证/找回密码/OAuth/账号管理/云同步（本期边界，赛后升级）。
- 遗留：旧站 LW_PROBE_KEY 删除被平台 sites_secret_in_use 阻塞（两次 requestId 见 handover），lw_probe 表壳+2 条合成探针行保留；probe-functions/ 本地保留不入公开仓库。
- 沙箱内 accept_a/b_*、cookie_probe_* 随机账号下的测试知识为真实验收产物，非预置假数据；演示账号 demo 树为空，评委自行提交。

## 五、对外三条路径（已上线）

1. 评委沙箱（公开）：https://learning-workspace-multi-v5d3qx7uw3a.qoder.zone — 免登录入口页+注册/演示账号 demo/demo-2026 跑完整闭环，数据按账号隔离。
2. 搬回家（公开仓库）：https://github.com/1760272981/learning-workspace — npm install + npm run local 纯本地壳，MCP 与网页同文件库；入口页提示词一键复制。
3. 看我们真实树（公开只读）：https://learning-workspace-v5d3qx7uw3a.qoder.zone — 旧站保留真实积累。