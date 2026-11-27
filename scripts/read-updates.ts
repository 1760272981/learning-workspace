// 项目更新读回助手：经真实 MCP stdio 服务读取，用于提交确认与 pending 对账。
// 用法: node scripts/read-updates.ts [project] [task_id] [run_id] [localDataFile]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [project, task_id, run_id] = process.argv.slice(2);
const dataPath = process.argv[5] || path.join(root, "local-data", "lw-local-db.json");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "mcp", "server.ts")],
  env: { ...process.env, LW_LOCAL_DATA_FILE: dataPath, LW_USER_TOKEN: "", LW_API_BASE: "", LW_WRITE_KEY: "" },
});
const client = new Client({ name: "lw-read-helper", version: "0.1.0" });
await client.connect(transport);
const res = await client.callTool({ name: "read_project_updates", arguments: { project, task_id, run_id } });
console.log((res.content as { type: string; text: string }[])[0].text);
await client.close();