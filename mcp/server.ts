import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applySubmit, type Store, type SubmitInput } from "../shared/model.ts";

const dir = path.dirname(fileURLToPath(import.meta.url));
const STORE = process.env.LW_STORE || path.join(dir, "data", "store.json");

function load(): Store {
  try {
    return JSON.parse(fs.readFileSync(STORE, "utf8")) as Store;
  } catch {
    return { projects: {} };
  }
}

function save(store: Store): void {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2), "utf8");
}

function reply(obj: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj) }] };
}

const server = new McpServer({ name: "learning-workspace", version: "0.1.0" });

server.registerTool(
  "submit_learning_block",
  {
    description:
      "提交一条候选学习知识到 Learning Workspace 知识树。仅在负责人主动触发整理时使用。" +
      "红线：必要，不是什么都塞——必要 = 能帮负责人做出一项具体判断或完成一次可靠验收。" +
      "提交前过三问：现在要判断什么（judging）、产出里有什么证据（evidence）、学完能做什么验收动作（verify_action）；答不出就不要提交。" +
      "sources 必须先真实搜索，禁止编造 URL。每个产出版本最多 2 条、每项目每天最多 3 条新推荐，超限请收手。" +
      "返回四态：accepted（已入树）/ linked（关联到既有概念）/ missing_evidence（缺证据，补齐或问一个具体问题）/ over_limit（超限，本轮停止）。",
    inputSchema: {
      project: z.string().optional().describe("项目标识"),
      output_ref: z
        .string()
        .optional()
        .describe("产出版本/可定位引用（commit、文件、文档段）"),
      title: z.string().optional().describe("判断问题式标题"),
      kind: z
        .enum(["concept", "operation", "fact"])
        .optional()
        .describe("concept 概念 / operation 影响验收的操作 / fact 影响验收的事实"),
      judging: z.string().optional().describe("三问1：负责人即将做出的具体判断"),
      evidence: z
        .string()
        .optional()
        .describe("三问2：产出中的实际证据 + 不懂会漏检什么、错选什么"),
      consequence: z.string().optional().describe("误判后果（用于优先级）"),
      verify_action: z
        .string()
        .optional()
        .describe("三问3：学完能亲自问、比较或验证的动作"),
      sources: z
        .array(
          z.object({
            title: z.string().optional(),
            url: z.string().optional(),
          })
        )
        .optional()
        .describe("至少 1 条真实来源 {title, url}；先搜索再提交，禁编造"),
      branch: z
        .string()
        .optional()
        .describe("稳定分支建议（如 可维护性 / 发布与验收），主父节点由产品定"),
    },
  },
  (args: SubmitInput) => {
    const store = load();
    const result = applySubmit(store, args);
    if (result.status === "accepted" || result.status === "linked") {
      save(store);
    }
    return reply(result as unknown as Record<string, unknown>);
  }
);

await server.connect(new StdioServerTransport());
