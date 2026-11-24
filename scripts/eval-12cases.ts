// 12 例验收评估 · 确定性部分：通过真实 MCP stdio 服务跑提交逻辑。
// 覆盖：该推 / 容易误推(系统上限兜底) / 重复 / 缺证据 / 版本变化。
// 「已会」「语义上容易误推」属于 Skill 提名判断，见换新会话的两轮真实闭环（eval-record.md）。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SubmitInput } from "../shared/model.ts";
import { assembleStore } from "../functions/core.ts";
import { loadRows } from "../functions/database.ts";
import { createFileDb, LOCAL_OWNER } from "./file-db.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const serverPath = path.join(root, "mcp", "server.ts");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lw-eval-"));
const dataPath = path.join(tmp, "lw-local-db.json");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, LW_LOCAL_DATA_FILE: dataPath, LW_USER_TOKEN: "", LW_API_BASE: "" },
});
const client = new Client({ name: "lw-eval-12", version: "0.1.0" });
await client.connect(transport);

const SRC = [{ title: "React 官方：Thinking in React", url: "https://react.dev/learn/thinking-in-react" }];
const base: SubmitInput = {
  project: "eval-blog",
  output_ref: "e1",
  title: "按共同变更判断该不该提取共用组件",
  kind: "concept",
  judging: "下一步给四个页面同时加栏目，判断现在该不该提取共用导航组件",
  evidence: "三个页面各自维护一份相同导航，加栏目要改三处",
  consequence: "不提取则每次改栏目漏改页面，导航不一致",
  verify_action: "要求 AI 演示改一处导航能否同步各页，并指出哪些页应保留例外",
  sources: SRC,
  branch: "可维护性",
};
const opTitle = "判断部署后是否真的公开可访问";
const factTitle = "判断静态资源缓存是否影响验收";

let failures = 0;
const rows: string[] = [];
async function run(
  id: string,
  category: string,
  args: SubmitInput,
  expected: string,
  expectScope?: string
): Promise<Record<string, unknown>> {
  const res = await client.callTool({ name: "submit_learning_block", arguments: { ...args } });
  const body = JSON.parse((res.content as { type: string; text: string }[])[0].text) as Record<string, unknown>;
  const ok = body.status === expected && (!expectScope || body.scope === expectScope);
  if (!ok) failures++;
  rows.push(
    `${id} | ${category} | want=${expected}${expectScope ? "/" + expectScope : ""} | got=${body.status}${body.scope ? "/" + body.scope : ""} | ${ok ? "PASS" : "FAIL"}`
  );
  return body;
}
function assert(ok: boolean, label: string, detail?: string) {
  if (!ok) failures++;
  rows.push(`-- | 状态断言 | ${label} | ${ok ? "PASS" : "FAIL"}${detail ? " | " + detail : ""}`);
}

// 该推：概念 / 操作 / 事实 三种 kind 均能入树
await run("C1", "该推", base, "accepted");
await run("C2", "该推", { ...base, title: opTitle, kind: "operation", branch: "发布与验收" }, "accepted");
await run("C3", "该推", { ...base, output_ref: "e2", title: factTitle, kind: "fact", branch: "发布与验收" }, "accepted");
// 容易误推：系统上限兜底（同产出第 3 条 / 当天第 4 条）
await run("C4", "容易误推", { ...base, title: "凑数候选甲" }, "over_limit", "output");
await run("C5", "容易误推", { ...base, output_ref: "e3", title: "凑数候选乙" }, "over_limit", "day");
// 重复：同产出重试幂等 / 跨产出关联
const c6 = await run("C6", "重复", base, "linked");
await run("C7", "重复", { ...base, output_ref: "e4" }, "linked");
// 缺证据：无来源 / 三问为空 / 危险 URL
const c8 = await run("C8", "缺证据", { ...base, output_ref: "e5", sources: [] }, "missing_evidence");
const c9 = await run("C9", "缺证据", { ...base, output_ref: "e5", judging: "", evidence: "", verify_action: "" }, "missing_evidence");
const c10 = await run("C10", "缺证据", { ...base, output_ref: "e5", sources: [{ title: "编造", url: "javascript:alert(1)" }] }, "missing_evidence");
// 版本变化：既有概念关联新版本 / 跨产出到已饱和产出被拦
await run("C11", "版本变化", { ...base, output_ref: "e6" }, "linked");
await run("C12", "版本变化", { ...base, output_ref: "e1", title: factTitle, kind: "fact" }, "over_limit", "output");

assert(Array.isArray(c8.missing) && (c8.missing as string[]).includes("sources"), "C8 missing 含 sources", JSON.stringify(c8.missing));
assert(
  Array.isArray(c9.missing) && ["judging", "evidence", "verify_action"].every((k) => (c9.missing as string[]).includes(k)),
  "C9 missing 含三问",
  JSON.stringify(c9.missing)
);
assert(Array.isArray(c10.missing) && (c10.missing as string[]).includes("sources"), "C10 危险 URL 记 sources", JSON.stringify(c10.missing));
assert(typeof c6.node_id === "string", "C6 幂等返回既有节点", String(c6.node_id));

const store = assembleStore(await loadRows(createFileDb(dataPath), LOCAL_OWNER));
const p = store.projects["eval-blog"];
const today = new Date().toISOString().slice(0, 10);
const byTitle = (t: string) => p.concepts.find((c) => c.title === t)!;
assert(p.concepts.length === 3, "概念数=3（概念/操作/事实各一）", `got ${p.concepts.length}`);
assert(byTitle(base.title!).applications.length === 3, "base 概念应用=3（e1/e4/e6，幂等不重复）", `got ${byTitle(base.title!).applications.length}`);
assert(p.days[today] === 3, "当天新推荐=3（linked 不计）", `got ${p.days[today]}`);
assert(p.outputs["e1"] === 2, "e1 产出计数=2", `got ${p.outputs["e1"]}`);

await client.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log(rows.join("\n"));
console.log(failures === 0 ? "\nEVAL-12 ALL PASS" : `\nEVAL-12 ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);