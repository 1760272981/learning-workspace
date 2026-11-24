// 真实闭环提交助手：读候选 JSON，经真实 MCP stdio 服务提交，打印四态结果。
// 用法: node scripts/submit-block.ts <candidate.json> [localDataFile]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const candidatePath = process.argv[2];
const dataPath = process.argv[3] || path.join(root, "local-data", "lw-local-db.json");
if (!candidatePath) {
  console.error("usage: node scripts/submit-block.ts <candidate.json> [localDataFile]");
  process.exit(1);
}
const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "mcp", "server.ts")],
  env: { ...process.env, LW_LOCAL_DATA_FILE: dataPath, LW_USER_TOKEN: "", LW_API_BASE: "" },
});
const client = new Client({ name: "lw-submit-helper", version: "0.1.0" });
await client.connect(transport);
const res = await client.callTool({ name: "submit_learning_block", arguments: candidate });
console.log((res.content as { type: string; text: string }[])[0].text);
await client.close();