# 12 例验收评估记录（Learning Workspace · 知识入树）

日期：2026-11-12（机器 UTC 计数日 2026-11-11）
方法：两部分。A = 确定性 12 例，经**真实 MCP stdio 服务**（`mcp/server.ts` 的 `submit_learning_block`）跑共享逻辑 `applySubmit`；B = **两个换新会话的真实 Qoder 助手**加载 `skills/learning-capture/SKILL.md`，对**真实产出**提名并经真实 MCP 提交。
红线：不编造结果、不编造 URL；评估用独立 store，不污染负责人真实知识树。

---

## A. 确定性 12 例（真实 MCP 往返）

运行：`node scripts/eval-12cases.ts`（临时 store，跑完即删）。结果 **EVAL-12 ALL PASS**。

| # | 类别 | 输入要点 | 期望 | 实际 | 结论 |
|---|------|---------|------|------|------|
| C1 | 该推 | 概念，三问+真实来源齐全 | accepted | accepted | PASS |
| C2 | 该推 | 操作（影响验收），齐全 | accepted | accepted | PASS |
| C3 | 该推 | 事实（影响验收），齐全 | accepted | accepted | PASS |
| C4 | 容易误推 | 同产出第 3 条新候选 | over_limit/output | over_limit/output | PASS |
| C5 | 容易误推 | 当天第 4 条新候选 | over_limit/day | over_limit/day | PASS |
| C6 | 重复 | 同产出+同标题重试 | linked（幂等） | linked | PASS |
| C7 | 重复 | 同概念跨产出 | linked（新应用） | linked | PASS |
| C8 | 缺证据 | sources 为空 | missing_evidence | missing_evidence | PASS |
| C9 | 缺证据 | 三问为空串 | missing_evidence | missing_evidence | PASS |
| C10 | 缺证据 | 来源 url=javascript: | missing_evidence | missing_evidence | PASS |
| C11 | 版本变化 | 既有概念关联新版本 | linked（新应用） | linked | PASS |
| C12 | 版本变化 | 既有概念跨到已饱和产出 | over_limit/output | over_limit/output | PASS |

状态断言（同跑）：C8 missing 含 sources；C9 missing 含 judging/evidence/verify_action；C10 危险 URL 记 sources；C6 幂等返回既有节点；概念数=3；base 概念应用=3（e1/e4/e6，幂等不重复）；当天新推荐=3（linked 不计）；e1 产出计数=2。全部 PASS。

说明：C4/C5 是「容易误推」的**系统上限兜底**（凑数也塞不进）。语义层面的「看起来相似但以后各自改动→不该推」与「已会→跳过」属 Skill 提名判断，见 B。

## B. 换新会话两轮真实闭环（真实产出 → 提名 → 真实 MCP 入树）

每轮为一个全新助手会话，先读 Skill，再对下列真实产出过三问提名；来源均真实搜索；提交走 `node scripts/submit-block.ts <候选> <独立store>`。

### 轮 1 · 产出：长驻 dev server 未重载 Tailwind 配置导致样式透明（真实缺陷+修复）
- 提名 1（concept，accepted）：改完构建配置后，如何确认长驻 dev server 正提供当前配置的 CSS，再相信浏览器 QA。← **AI 不会主动提、但用户需要**的验收前置判断。
- 提名 2（operation，accepted）：类名挂上但 computed style 透明/默认时，区分「样式没生成」与「样式被覆盖」。
- 跳过陷阱：临时端口/taskkill 命令（一次性操作，不进树）；「未登录窗口开链接」（负责人已会，跳过）。
- 上限：tailwind-fix=2/2，当日 2/3；无 missing_evidence / over_limit。
- 真实来源：v3.tailwindcss.com/docs/configuration、MDN getComputedStyle、Chrome DevTools CSS、vitejs/vite#12724 等。

### 轮 2 · 产出：Qoder Sites 部署+设公开+未登录验证（真实部署）
- 提名 1（concept，accepted）：线上跑的是否本地验证过的那版构建？用内容哈希资源指纹核对。← **AI 不会主动提、但用户需要**（"200+能渲染"仍可能是旧包）。
- 提名 2（fact，accepted）：线上 HTML 比本地 dist 大几十 KB 是否部署坏了？平台注入壳的识别与影响判断。
- 跳过陷阱：「未登录窗口开链接」（已会）；curl 命令/端口/CDP target id（一次性）。
- 上限：sites-public=2/2，当日 2/3。
- 真实来源：docs.qoder.com/zh/qoder/sites、MDN Cache-Control、vitepress.dev/guide/deploy、Cloudflare Rocket Loader 等。

核对：`evidence/eval-round1-store.json`、`eval-round2-store.json` 各含 2 概念、应用与来源齐全、计数正确；`git status` 确认 src/shared/mcp 未被改动。

## 六类覆盖对照

| 类别 | 覆盖位置 |
|------|---------|
| 该推 | A·C1/C2/C3；B 两轮 accepted |
| 容易误推 | A·C4/C5（上限兜底）；B 跳过一次性命令/端口（语义不推） |
| 已会 | B 两轮均跳过「未登录窗口开链接」 |
| 重复 | A·C6/C7 |
| 缺证据 | A·C8/C9/C10 |
| 版本变化 | A·C11/C12；B 轮 2 哈希核对（版本同一性判断） |
| AI 没提但用户需要 | B 轮 1 提名 1、轮 2 提名 1 |

## 复现

```
node scripts/eval-12cases.ts          # A：12 例 + 状态断言
node scripts/submit-block.ts evidence/round1-cand-1.json evidence/eval-round1-store.json   # B 单条提交
```

## 局限（如实）

- A 测提交逻辑与上限/幂等/校验，不测「语义必要性」；语义判断由 B 的真实会话承担，样本为 2 轮×2 条，非统计显著。
- B 的提名质量依赖当次助手与搜索来源；已要求真实搜索、禁编造 URL，来源列于上。
- 评估 store 独立于负责人真实树与网页 localStorage；网页端真实闭环另见 #15 验收截图。