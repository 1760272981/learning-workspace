import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ProjectUpdateInput, SubmitInput } from "../shared/model.ts";
import { readUpdatesFromCloud, submitToCloud, submitUpdateToCloud } from "./cloud.ts";
import { answerLocalQuestion, readLocalQuestions, readLocalUpdates, submitToLocal, submitUpdateToLocal } from "./local.ts";
import { ChatBusinessError } from "../scripts/chat-store.mjs";

function reply(obj: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj) }] };
}

// 配置了云地址却缺凭证时明确报错，绝不静默回落本地（否则 agent 报成功、云端树上没有）。
function cloudRoute():
  | { mode: "cloud"; config: { apiBase: string; userToken?: string; writeKey?: string } }
  | { mode: "local" }
  | { mode: "misconfigured" } {
  const userToken = process.env.LW_USER_TOKEN?.trim();
  const writeKey = process.env.LW_WRITE_KEY?.trim();
  const apiBase = process.env.LW_API_BASE?.trim();
  if (apiBase && (userToken || writeKey)) return { mode: "cloud", config: { apiBase, userToken, writeKey } };
  if (apiBase) return { mode: "misconfigured" };
  return { mode: "local" };
}

const MISCONFIGURED_REPLY = {
  status: "failed",
  error: "cloud_credentials_missing",
  http_status: 0,
  hints: [
    "已配置 LW_API_BASE 但缺少 LW_USER_TOKEN 或 LW_WRITE_KEY，本次未提交任何数据。",
    "本地模式：移除 LW_API_BASE；云端模式：补齐令牌或写密钥后重试。",
  ],
};

const CHAT_LOCAL_ONLY_REPLY = {
  status: "failed",
  error: "chat_bridge_local_only",
  hints: [
    "页面问答桥当前仅支持本地链路（本地文件库 + 本地服务），云端模式不支持，也不会回落本地写入。",
    "要回答 Workspace 页面提问：移除 LW_API_BASE（及凭证）使用本地模式，并确保本地服务与页面用的是同一份数据文件。",
  ],
};

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
  async (args: SubmitInput) => {
    const route = cloudRoute();
    if (route.mode === "misconfigured") return reply(MISCONFIGURED_REPLY);
    if (route.mode === "cloud") {
      return reply(await submitToCloud(args, route.config) as unknown as Record<string, unknown>);
    }
    return reply(await submitToLocal(args) as unknown as Record<string, unknown>);
  }
);

server.registerTool(
  "submit_project_update",
  {
    description:
      "任务/本轮工作结束后，按 project-wrapup Skill 提交一条项目更新（项目事件）。与学习点独立，学习候选可为空。" +
      "必须区分：agent_report=你自己报告的完成情况；verifications=实际执行的验证（verified 必须附真实证据，未执行的标 unverified）；" +
      "用户验收由用户在网页亲自记录，你不代记。身份=project+task_id+run_id：同身份同内容重提返回原事件（duplicate），" +
      "同身份不同内容返回 conflict，新一轮工作用新 run_id。返回 accepted/duplicate/conflict/invalid；" +
      "超时或结果未知为 pending，不要自动重发，先用 read_project_updates 按原身份查回对账。",
    inputSchema: {
      project: z.string().optional().describe("项目标识"),
      task_id: z.string().optional().describe("任务标识（稳定、可追溯）"),
      run_id: z.string().optional().describe("工作轮次标识（同一任务重做用新轮次）"),
      task_title: z.string().optional().describe("任务一句话描述"),
      source_revision: z.object({
        type: z.enum(["git-commit", "workspace-snapshot"]),
        ref: z.string().describe("commit hash 或快照标识"),
        base: z.string().optional().describe("快照基底 commit"),
        diff_sha256: z.string().optional().describe("工作区 diff 的 SHA-256（快照必填）"),
      }).optional().describe("源修订：已有 Git 提交或可追溯工作区快照"),
      agent_report: z.string().optional().describe("Agent 自报完成情况（不等于验证通过）"),
      outcome: z.string().optional().describe("一句人话结果：用户能直接观察到的变化，不写函数名或文件路径"),
      changes: z.array(z.object({
        target: z.string().describe("文件路径或模块"),
        summary: z.string(),
        kind: z.enum(["code", "doc", "config", "other"]).optional(),
        sync: z.enum(["updated", "pending", "inferred"]).optional().describe("updated=实际写入；pending=未写入；inferred=仅推断待查"),
      })).optional().describe("重要改动清单，至少 1 条"),
      decisions: z.array(z.object({ decision: z.string(), reason: z.string() })).optional(),
      verifications: z.array(z.object({
        item: z.string(),
        status: z.enum(["verified", "unverified"]),
        revision: z.string().optional().describe("实际执行时的版本；与事件版本不一致会显示待复验"),
        environment: z.string().optional(),
        scope: z.string().optional(),
        evidence: z.string().optional().describe("verified 必填：真实运行输出/可定位证据"),
      })).optional().describe("验证清单：实际执行的标 verified 附证据，未执行的标 unverified"),
      risks: z.array(z.object({ text: z.string(), kind: z.enum(["risk", "unknown"]) })).optional(),
      learning_candidates: z.array(z.object({ title: z.string(), note: z.string().optional() })).optional().describe("可为空；学习点仍走 submit_learning_block"),
    },
  },
  async (args: ProjectUpdateInput) => {
    const route = cloudRoute();
    if (route.mode === "misconfigured") return reply(MISCONFIGURED_REPLY);
    if (route.mode === "cloud") {
      return reply(await submitUpdateToCloud(args, route.config) as unknown as Record<string, unknown>);
    }
    return reply(await submitUpdateToLocal(args) as unknown as Record<string, unknown>);
  }
);

server.registerTool(
  "read_project_updates",
  {
    description:
      "读取 Workspace 已保存的项目更新（只读）。用于提交后确认、pending 后按原 project+task_id+run_id 对账、" +
      "或查看某事件的用户验收状态。不传参数返回本人全部事件（按接收时间倒序）。",
    inputSchema: {
      project: z.string().optional(),
      task_id: z.string().optional(),
      run_id: z.string().optional(),
      event_id: z.string().optional(),
    },
  },
  async (params: { project?: string; task_id?: string; run_id?: string; event_id?: string }) => {
    const route = cloudRoute();
    if (route.mode === "misconfigured") return reply(MISCONFIGURED_REPLY);
    if (route.mode === "cloud") {
      return reply(await readUpdatesFromCloud(params, route.config) as unknown as Record<string, unknown>);
    }
    try {
      return reply({ status: "ok", events: await readLocalUpdates(params) });
    } catch {
      return reply({ status: "pending", pending: true, error: "write_result_unknown", hints: ["本地读取结果未知，稍后重试读取；不要据此重发提交。"] });
    }
  }
);

server.registerTool(
  "read_learning_questions",
  {
    description:
      "供用户的 Agent 读取 Workspace 页面上等待回答的用户提问（只读，仅本地链路）。" +
      "用户在项目更新详情里提问后，问题保存在本地库；本工具返回尚无回答的问题列表（按提问时间升序）。" +
      "配合 teaching-explain Skill 使用：先读本工具，再按 event_id 调 read_project_updates 取该事件真实记录，" +
      "用大白话解释后用 answer_learning_question 写回。非实时：需要 Agent 会话运行时主动读取，页面不会推送。" +
      "云端模式返回 failed/chat_bridge_local_only，不回落本地。",
    inputSchema: {
      project: z.string().optional().describe("按项目过滤（可选）"),
      event_id: z.string().optional().describe("按项目事件过滤（可选）"),
    },
  },
  async (params: { project?: string; event_id?: string }) => {
    if (cloudRoute().mode !== "local") return reply(CHAT_LOCAL_ONLY_REPLY);
    try {
      return reply({ status: "ok", questions: await readLocalQuestions(params) });
    } catch {
      return reply({ status: "pending", pending: true, error: "write_result_unknown", hints: ["本地读取结果未知，稍后重试读取。"] });
    }
  }
);

server.registerTool(
  "answer_learning_question",
  {
    description:
      "供用户的 Agent 把回答写回 Workspace 页面提问（仅本地链路）。question_id 来自 read_learning_questions。" +
      "回答只以该事件记录字段 + 通用机制知识为依据，不编造记录里没有的事实；机制性推断要标明。" +
      "返回 accepted（已写回，页面可见）/ duplicate（同文回答已存在，返回原回答）/ " +
      "failed（question_not_found 问题不存在或非本人 / already_answered 已有不同回答，不覆盖）。" +
      "云端模式返回 failed/chat_bridge_local_only，不回落本地。",
    inputSchema: {
      question_id: z.string().optional().describe("要回答的问题 ID"),
      answer: z.string().optional().describe("回答全文（大白话解释，写回后用户在页面看到）"),
    },
  },
  async (params: { question_id?: string; answer?: string }) => {
    if (cloudRoute().mode !== "local") return reply(CHAT_LOCAL_ONLY_REPLY);
    try {
      const result = await answerLocalQuestion(params);
      return reply({
        ...result,
        hints: result.status === "duplicate"
          ? ["同一问题已有相同回答，返回原回答，不产生新记录。"]
          : ["回答已保存。用户在 Workspace 页面该事件的问答面板可见（非实时，页面轮询或手动刷新）。"],
      });
    } catch (error) {
      if (error instanceof ChatBusinessError) {
        return reply({
          status: "failed",
          error: error.code,
          hints: error.code === "question_not_found"
            ? ["问题不存在或不属于当前用户。先用 read_learning_questions 查回真实问题 ID。"]
            : error.code === "already_answered"
              ? ["该问题已有内容不同的回答，不覆盖。如确需更正，向用户说明并由用户决定。"]
              : ["检查 question_id 与回答内容（回答不能为空）后重试。"],
        });
      }
      return reply({ status: "pending", pending: true, error: "write_result_unknown", hints: ["本地写入结果未知，不要自动重发。先用 read_learning_questions / 页面问答面板对账。"] });
    }
  }
);

await server.connect(new StdioServerTransport());
