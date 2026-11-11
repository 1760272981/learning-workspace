import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applySubmit, makeApplication, CAP_PER_OUTPUT, type Store, type SubmitInput, type Kind } from "../shared/model.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const serverPath = path.join(root, "mcp", "server.ts");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lw-mcp-test-"));
const storePath = path.join(tmp, "store.json");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, LW_STORE: storePath },
});
const client = new Client({ name: "lw-selftest", version: "0.1.0" });
await client.connect(transport);

let failures = 0;
function check(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const tools = await client.listTools();
check(
  tools.tools.some((t) => t.name === "submit_learning_block"),
  "listTools 包含 submit_learning_block"
);

interface ReplyBody {
  status: string;
  missing?: string[];
  [key: string]: unknown;
}

async function call(
  args: SubmitInput,
  expected: string,
  label: string
): Promise<ReplyBody> {
  const res = await client.callTool({
    name: "submit_learning_block",
    arguments: { ...args },
  });
  const body = JSON.parse(
    (res.content as { type: string; text: string }[])[0].text
  ) as ReplyBody;
  check(
    body.status === expected,
    label,
    body.status === expected
      ? body.status
      : `got ${body.status}, want ${expected}: ${JSON.stringify(body)}`
  );
  return body;
}

const base: SubmitInput = {
  project: "personal-blog",
  output_ref: "v1",
  title: "按共同变更判断该不该提取共用组件",
  kind: "concept",
  judging: "下一步要给四个页面同时加栏目，判断现在该不该提取共用导航组件",
  evidence: "三个页面各自维护一份相同的导航，加栏目要改三处",
  consequence: "不提取则每次改栏目漏改页面，导航不一致",
  verify_action: "要求 AI 演示改一处导航能否同步各页，并指出哪些页应保留例外",
  sources: [
    {
      title: "React 官方：Thinking in React",
      url: "https://react.dev/learn/thinking-in-react",
    },
  ],
  branch: "可维护性",
};

const m = await call({ project: "personal-blog" }, "missing_evidence", "缺字段");
check(
  Array.isArray(m.missing) &&
    m.missing.includes("sources") &&
    m.missing.includes("judging"),
  "missing_evidence 列出缺失字段",
  JSON.stringify(m.missing)
);

await call(base, "accepted", "完整候选入树");
await call({ ...base, output_ref: "v2" }, "linked", "同概念新产出关联");
await call(
  {
    ...base,
    output_ref: "v2",
    title: "判断作品链接能否被未登录访客打开",
    kind: "operation",
    judging: "发布前要确认评委未登录也能打开作品",
    evidence: "部署平台默认访问策略可能限组织内",
    consequence: "评委打开是空白或 403，直接失去评审机会",
    verify_action: "用未登录浏览器窗口打开公网链接确认可访问",
    branch: "发布与验收",
  },
  "accepted",
  "同产出第二条新候选"
);
await call(
  { ...base, output_ref: "v2", title: "候选三" },
  "over_limit",
  "产出版本上限"
);
await call(
  { ...base, output_ref: "v3", title: "判断静态资源缓存是否影响验收" },
  "accepted",
  "当天第三条新推荐"
);
await call(
  { ...base, output_ref: "v4", title: "候选四" },
  "over_limit",
  "每日上限"
);
await call(base, "linked", "同一产出重试幂等");

interface StoreShape {
  projects: Record<
    string,
    {
      days: Record<string, number>;
      outputs: Record<string, number>;
      concepts: { applications: unknown[] }[];
    }
  >;
}
const store = JSON.parse(fs.readFileSync(storePath, "utf8")) as StoreShape;
const p = store.projects["personal-blog"];
check(p.concepts.length === 3, "存储含 3 条概念", `got ${p.concepts.length}`);
const today = new Date().toISOString().slice(0, 10);
check(p.days[today] === 3, "当天新推荐计数为 3", `got ${p.days[today]}`);
check(
  p.concepts[0].applications.length === 2,
  "概念与应用分离（1 概念 2 应用）",
  `got ${p.concepts[0].applications.length}`
);

const badUrl = await call(
  {
    ...base,
    output_ref: "v9",
    title: "非法来源候选",
    sources: [{ title: "编造", url: "javascript:alert(1)" }],
  },
  "missing_evidence",
  "非法/危险 URL 拒绝"
);
check(
  Array.isArray(badUrl.missing) && badUrl.missing.includes("sources"),
  "非法 URL 时 missing 列出 sources",
  JSON.stringify(badUrl.missing)
);

// 纯逻辑单测：非法 kind、既有概念产出上限、幂等（MCP schema 会先拦 kind，故直接测共享逻辑）
const s: Store = { projects: {} };
const badKind = applySubmit(s, { ...base, kind: "banana" as Kind });
check(
  badKind.status === "missing_evidence" && !!badKind.missing?.includes("kind"),
  "纯逻辑：非法 kind 拒绝",
  badKind.status
);
check(applySubmit(s, base).status === "accepted", "纯逻辑：首条入树");
check(
  applySubmit(s, { ...base, output_ref: "v2" }).status === "linked",
  "纯逻辑：同概念新产出关联"
);
check(
  applySubmit(s, { ...base, output_ref: "v2" }).status === "linked",
  "纯逻辑：同产出重试幂等"
);
check(
  s.projects["personal-blog"].concepts[0].applications.length === 2,
  "纯逻辑：幂等不重复加应用",
  `got ${s.projects["personal-blog"].concepts[0].applications.length}`
);
const seeded: Store = {
  projects: {
    p: {
      days: {},
      outputs: { vX: CAP_PER_OUTPUT },
      concepts: [
        {
          id: "c1",
          title: base.title!,
          kind: "concept",
          branch: "可维护性",
          created_at: new Date().toISOString(),
          applications: [{ ...makeApplication(base), output_ref: "vOld" }],
          verifications: [],
        },
      ],
    },
  },
};
const capExisting = applySubmit(seeded, { ...base, project: "p", output_ref: "vX" });
check(
  capExisting.status === "over_limit" && capExisting.scope === "output",
  "纯逻辑：既有概念+产出已达上限",
  `${capExisting.status}/${capExisting.scope}`
);

await client.close();
fs.rmSync(tmp, { recursive: true, force: true });

if (failures === 0) {
  console.log("\nALL PASS");
  process.exit(0);
} else {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}