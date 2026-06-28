import type { Prisma } from "@prisma/client";
import type { ConversationSummary, ResultEnvelope } from "@bi/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { ConversationSummary };
export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  queryType: "sql" | "rest" | null;
  generatedQuery: string | null;
  resultEnvelope: ResultEnvelope | null;
  createdAt: string; // ISO-8601
}

export interface CreateMessageInput {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  queryType?: "sql" | "rest";
  generatedQuery?: string;
  resultEnvelope?: ResultEnvelope;
}

// ---------------------------------------------------------------------------
// Internal DB row shapes
// ---------------------------------------------------------------------------

interface ConvRow {
  id: string;
  user_id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  query_type: string | null;
  generated_query: string | null;
  result_envelope: unknown;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapConvRow(row: ConvRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapMessageRow(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as MessageRole,
    content: row.content,
    queryType: (row.query_type as "sql" | "rest" | null) ?? null,
    generatedQuery: row.generated_query ?? null,
    resultEnvelope: row.result_envelope ? (row.result_envelope as ResultEnvelope) : null,
    createdAt: row.created_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Service functions — all accept a Prisma transaction client from withTenant
// ---------------------------------------------------------------------------

/** List all conversations for a user, newest first. */
export async function listConversations(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<ConversationSummary[]> {
  const rows = await tx.$queryRawUnsafe<ConvRow[]>(
    `SELECT id, user_id, title, created_at, updated_at
     FROM conversations
     WHERE user_id = $1
     ORDER BY updated_at DESC`,
    userId,
  );
  return rows.map(mapConvRow);
}

/** Create an empty conversation. Title set from first user message. */
export async function createConversation(
  tx: Prisma.TransactionClient,
  id: string,
  userId: string,
): Promise<ConversationSummary> {
  const rows = await tx.$queryRawUnsafe<ConvRow[]>(
    `INSERT INTO conversations (id, user_id, title, created_at, updated_at)
     VALUES ($1, $2, '', NOW(), NOW())
     RETURNING id, user_id, title, created_at, updated_at`,
    id,
    userId,
  );
  return mapConvRow(rows[0]);
}

/** Get a single conversation by id, scoped to the user. Returns null if missing/not-owned. */
export async function getConversation(
  tx: Prisma.TransactionClient,
  conversationId: string,
  userId: string,
): Promise<ConversationSummary | null> {
  const rows = await tx.$queryRawUnsafe<ConvRow[]>(
    `SELECT id, user_id, title, created_at, updated_at
     FROM conversations
     WHERE id = $1 AND user_id = $2`,
    conversationId,
    userId,
  );
  return rows.length ? mapConvRow(rows[0]) : null;
}

/** Get all messages for a conversation, user-scoped (verifies ownership). */
export async function getMessages(
  tx: Prisma.TransactionClient,
  conversationId: string,
  userId: string,
): Promise<Message[] | null> {
  // Verify ownership first
  const conv = await getConversation(tx, conversationId, userId);
  if (!conv) return null;

  const rows = await tx.$queryRawUnsafe<MessageRow[]>(
    `SELECT id, conversation_id, role, content, query_type, generated_query, result_envelope, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    conversationId,
  );
  return rows.map(mapMessageRow);
}

/** Delete a conversation (and its messages via ON DELETE CASCADE), user-scoped. */
export async function deleteConversation(
  tx: Prisma.TransactionClient,
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `DELETE FROM conversations
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    conversationId,
    userId,
  );
  return rows.length > 0;
}

/**
 * Insert a message into a conversation.
 * Updates the conversation title (from first user message) and updated_at.
 */
export async function addMessage(
  tx: Prisma.TransactionClient,
  input: CreateMessageInput,
): Promise<Message> {
  const resultEnvelopeJson = input.resultEnvelope ? JSON.stringify(input.resultEnvelope) : null;

  const rows = await tx.$queryRawUnsafe<MessageRow[]>(
    `INSERT INTO messages (id, conversation_id, role, content, query_type, generated_query, result_envelope, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
     RETURNING id, conversation_id, role, content, query_type, generated_query, result_envelope, created_at`,
    input.id,
    input.conversationId,
    input.role,
    input.content,
    input.queryType ?? null,
    input.generatedQuery ?? null,
    resultEnvelopeJson,
  );

  // Update conversation updated_at, and title if this is the first user message
  if (input.role === "user") {
    await tx.$executeRawUnsafe(
      `UPDATE conversations
       SET updated_at = NOW(),
           title = CASE
             WHEN title = '' THEN LEFT($2, 120)
             ELSE title
           END
       WHERE id = $1`,
      input.conversationId,
      input.content,
    );
  } else {
    await tx.$executeRawUnsafe(
      `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
      input.conversationId,
    );
  }

  return mapMessageRow(rows[0]);
}

// ---------------------------------------------------------------------------
// Token-budget windowing helper
// ---------------------------------------------------------------------------

/**
 * Estimate token count for a string.
 * Approximation: 1 token ≈ 4 characters (GPT-style average).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Returns recent messages from `conversationId` that fit within `budget` tokens,
 * ordered chronologically (oldest-first), keeping as many recent messages as possible.
 *
 * Used by the orchestrator to build LLM context windows.
 */
export async function getHistoryWindow(
  tx: Prisma.TransactionClient,
  conversationId: string,
  userId: string,
  budget: number,
): Promise<Message[]> {
  const all = await getMessages(tx, conversationId, userId);
  if (!all) return [];

  // Walk from newest to oldest, accumulate until budget exhausted
  let remaining = budget;
  const selected: Message[] = [];

  for (let i = all.length - 1; i >= 0; i--) {
    const msg = all[i];
    const cost = estimateTokens(msg.content);
    if (cost > remaining) break;
    remaining -= cost;
    selected.unshift(msg);
  }

  return selected;
}
