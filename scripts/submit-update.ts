// 项目更新提交助手：读事件 JSON，经真实 MCP stdio 服务提交，打印回执。
// 用法: node scripts/submit-update.ts <update.json> [localDataFile]
// 注意：这是脚本直连 MCP 服务（与 agent 连接器同一入口同一协议），不是 Qoder 连接器实连。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const updatePath = process.argv[2];
const dataPath = process.argv[3] || path.join(root, "local-data", "lw-local-db.json");
if (!updatePath) {
  console.error("usage: node scripts/submit-update.ts <update.json> [localDataFile]");
  process.exit(1);
}
const update = JSON.parse(fs.readFileSync(updatePath, "utf8"));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "mcp", "server.ts")],
  env: { ...process.env, LW_LOCAL_DATA_FILE: dataPath, LW_USER_TOKEN: "", LW_API_BASE: "", LW_WRITE_KEY: "" },
});
const client = new Client({ name: "lw-update-helper", version: "0.1.0" });
await client.connect(transport);
const res = await client.callTool({ name: "submit_project_update", arguments: update });
console.log((res.content as { type: string; text: string }[])[0].text);
await client.close();