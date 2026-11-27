import type { DatabaseClient } from '../functions/database.ts'

export const QUESTION_MAX_LENGTH: 2000

export class ChatBusinessError extends Error {
  code: string
  constructor(code: string)
}

export interface ChatRow {
  id: string
  owner_id: string
  project_id: string
  event_id: string
  role: 'user' | 'agent'
  question_id: string | null
  text: string
  created_at: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  question_id: string | null
  text: string
  created_at: string
  answered?: boolean
  source?: string
  provider?: string
  model?: string
  requested_model?: string
  request_id?: string
}

export interface PendingQuestion {
  id: string
  project_id: string
  event_id: string
  text: string
  created_at: string
}

export type AnswerResult = { status: 'accepted' | 'duplicate', answer_id: string, question_id: string }

export function insertQuestion(db: DatabaseClient, args: { ownerId: string, projectId: string, eventId: string, text: string, provider?: string }): Promise<ChatRow>
export function insertAnswer(db: DatabaseClient, args: { ownerId: string, questionId: string, text: string, source?: string, runtime?: { provider: string, model: string, requested_model?: string, request_id?: string } }): Promise<AnswerResult>
export function listChat(db: DatabaseClient, args: { ownerId: string, eventId: string }): Promise<ChatMessage[]>
export function listPendingQuestions(db: DatabaseClient, args: { ownerId: string, projectId?: string, eventId?: string }): Promise<PendingQuestion[]>