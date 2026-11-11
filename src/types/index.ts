// 类型单一来源：共享模型（前端 + MCP 共用）
export type {
  Source,
  Application,
  Kind,
  Verification,
  Concept,
  MarkStatus,
  ProjectStore,
  Store,
  SubmitInput,
  SubmitResult,
} from '../../shared/model'
export {
  CAP_PER_OUTPUT,
  CAP_PER_DAY,
  KINDS,
  normTitle,
  isHttpUrl,
  validateSubmit,
  makeApplication,
  applySubmit,
} from '../../shared/model'
