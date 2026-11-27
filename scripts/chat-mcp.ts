import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const [action, id, content] = process.argv.slice(2)
const tools = { questions: 'read_learning_questions', event: 'read_project_updates', answer: 'answer_learning_question' }
if (!(action === 'questions' || (action === 'event' && id) || (action === 'answer' && id && content))) {
  console.error('用法：node scripts/chat-mcp.ts questions [eventId] | event <eventId> | answer <questionId> <回答或@文件>')
  process.exit(1)
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../mcp/server.ts', import.meta.url))],
  env: { ...process.env, LW_USER_TOKEN: '', LW_API_BASE: '', LW_WRITE_KEY: '' },
})
const client = new Client({ name: 'lw-chat-helper', version: '0.1.0' })
try {
  const args = action === 'answer'
    ? { question_id: id, answer: content.startsWith('@') ? await readFile(content.slice(1), 'utf8') : content }
    : id ? { event_id: id } : {}
  await client.connect(transport)
  const result = await client.callTool({ name: tools[action], arguments: args })
  const message = (result.content as { type: string; text: string }[]).find((part) => part.type === 'text')
  if (result.isError || !message) throw new Error('MCP 没有返回有效结果')
  console.log(message.text)
  if (!['ok', 'accepted', 'duplicate'].includes(JSON.parse(message.text).status)) process.exitCode = 1
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await client.close()
}
