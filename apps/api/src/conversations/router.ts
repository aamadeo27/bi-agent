import { Router } from "express";
import type { Router as ExpressRouter, Request, Response } from "express";
import { z } from "zod";
import { SendMessageRequestSchema, type ApiErrorResponse } from "@bi/contracts";
import { logger } from "../observability/logger.js";
import {
  listConversations,
  createConversation,
  getMessages,
  deleteConversation,
  getConversation,
} from "./index.js";
import { runAskPipeline } from "../ask/orchestrator.js";
import { createLlmProvider } from "../llm/factory.js";

// Conversation id format: non-empty, max 128 chars (covers UUID and ULID).
const ConversationIdSchema = z.object({
  id: z.string().min(1).max(128),
});

// ── LLM provider singleton ────────────────────────────────────────────────────
//
// NOTE (lifecycle decision): The singleton is created lazily on first request and
// cached for the process lifetime. Hot-reload on config change and per-instance
// isolation in multi-process deployments are not yet handled — that is an
// Architect-level decision (see T5.5 concern). Tests may override via
// _setLlmProvider() before mounting the router.

import type { LlmProvider } from "../llm/port.js";

let _llmProvider: LlmProvider | undefined;

function getLlmProvider(): LlmProvider {
  _llmProvider ??= createLlmProvider({
    provider: process.env["LLM_PROVIDER"] ?? "gemini",
    model: process.env["LLM_MODEL"] ?? "gemini-2.0-flash",
    apiKey: process.env["GEMINI_API_KEY"] ?? "",
  });
  return _llmProvider;
}

/**
 * Override the LLM provider — for use in tests only.
 * Call _resetLlmProvider() in afterEach to restore production behaviour.
 */
export function _setLlmProvider(provider: LlmProvider): void {
  _llmProvider = provider;
}

/** Reset the provider singleton — for test teardown. */
export function _resetLlmProvider(): void {
  _llmProvider = undefined;
}

// ── Ask SSE rate limiter ──────────────────────────────────────────────────────
//
// Sliding-window counter (in-memory, per-user) to prevent a single authenticated
// user from looping paid LLM + data-plane calls (CWE-770, OWASP API4:2023).
// Configurable via env; defaults protect against runaway loops without blocking
// normal interactive use.

const ASK_RATE_LIMIT_MAX = Number(process.env["ASK_RATE_LIMIT_MAX"] ?? "20");
const ASK_RATE_LIMIT_WINDOW_MS = Number(process.env["ASK_RATE_LIMIT_WINDOW_MS"] ?? "60000");

/** Map: userId → sorted list of request timestamps within the current window. */
const _askRateLimitBuckets = new Map<string, number[]>();

/** Returns true when the request is allowed; false when the user is over-limit. */
function checkAskRateLimit(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - ASK_RATE_LIMIT_WINDOW_MS;
  const bucket = (_askRateLimitBuckets.get(userId) ?? []).filter((t) => t > cutoff);
  // Prune stale entry when window has fully expired — prevents unbounded Map growth.
  if (bucket.length === 0) {
    _askRateLimitBuckets.delete(userId);
  }
  if (bucket.length >= ASK_RATE_LIMIT_MAX) {
    _askRateLimitBuckets.set(userId, bucket);
    return false;
  }
  bucket.push(now);
  _askRateLimitBuckets.set(userId, bucket);
  return true;
}

/** Clear rate-limit state for a user — for use in tests only. */
export function _clearAskRateLimitForUser(userId: string): void {
  _askRateLimitBuckets.delete(userId);
}

export const conversationsRouter: ExpressRouter = Router();

// ── GET /api/conversations ────────────────────────────────────────────────────

conversationsRouter.get("/", async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  try {
    const conversations = await req.withTenantTx!((tx) => listConversations(tx, userId));
    res.json(conversations);
  } catch (err) {
    logger.error({ err }, "conversations GET / error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to list conversations" };
    res.status(500).json(body);
  }
});

// ── POST /api/conversations ───────────────────────────────────────────────────

conversationsRouter.post("/", async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  const id = crypto.randomUUID();
  try {
    const conversation = await req.withTenantTx!((tx) => createConversation(tx, id, userId));
    res.status(201).json(conversation);
  } catch (err) {
    logger.error({ err }, "conversations POST error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to create conversation" };
    res.status(500).json(body);
  }
});

// ── GET /api/conversations/:id/messages ──────────────────────────────────────

conversationsRouter.get("/:id/messages", async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  const parsed = ConversationIdSchema.safeParse(req.params);
  if (!parsed.success) {
    const body: ApiErrorResponse = { code: "VALIDATION", message: "Invalid conversation id" };
    res.status(400).json(body);
    return;
  }
  const { id } = parsed.data;
  try {
    const messages = await req.withTenantTx!((tx) => getMessages(tx, id, userId));
    if (messages === null) {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "Conversation not found" };
      res.status(404).json(body);
      return;
    }
    res.json(messages);
  } catch (err) {
    logger.error({ err }, "conversations GET /:id/messages error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to fetch messages" };
    res.status(500).json(body);
  }
});

// ── POST /api/conversations/:id/messages (SSE) ───────────────────────────────
//
// Submits a question and streams the Ask pipeline response as SSE.
// The SSE response always terminates with either a `done` or `error` event.
//
// Pre-conditions checked BEFORE sending SSE headers (so HTTP errors are possible):
//   1. Valid conversationId param
//   2. Valid request body { text }
//   3. Caller must have a role (roleId non-null)
//   4. Conversation must belong to the caller

conversationsRouter.post("/:id/messages", async (req: Request, res: Response) => {
  // ── 1. Validate params ──────────────────────────────────────────────────────
  const paramParsed = ConversationIdSchema.safeParse(req.params);
  if (!paramParsed.success) {
    const body: ApiErrorResponse = { code: "VALIDATION", message: "Invalid conversation id" };
    res.status(400).json(body);
    return;
  }
  const { id: conversationId } = paramParsed.data;

  // ── 2. Validate request body ────────────────────────────────────────────────
  const bodyParsed = SendMessageRequestSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    const body: ApiErrorResponse = { code: "VALIDATION", message: "Request body must include a non-empty 'text' field" };
    res.status(400).json(body);
    return;
  }
  const { text } = bodyParsed.data;

  // ── 3. Guard: auth middleware must have run ─────────────────────────────────
  if (!req.auth) {
    const body: ApiErrorResponse = { code: "AUTH", message: "Not authenticated" };
    res.status(401).json(body);
    return;
  }
  if (!req.withTenantTx) {
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Server configuration error" };
    res.status(500).json(body);
    return;
  }
  const auth = req.auth;

  // ── 4. Require a role ───────────────────────────────────────────────────────
  if (!auth.roleId) {
    const body: ApiErrorResponse = { code: "AUTH", message: "You must have a role assigned to use the Ask feature" };
    res.status(403).json(body);
    return;
  }

  // ── 5. Rate limit (per user, sliding window) ────────────────────────────────
  if (!checkAskRateLimit(auth.userId)) {
    const body: ApiErrorResponse = { code: "RATE_LIMIT", message: "Too many requests — please wait before asking again" };
    res.status(429).json(body);
    return;
  }

  // ── 6. Verify conversation ownership (before SSE headers, so 404 is possible) ──
  try {
    const conv = await req.withTenantTx((tx) =>
      getConversation(tx, conversationId, auth.userId),
    );
    if (!conv) {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "Conversation not found" };
      res.status(404).json(body);
      return;
    }
  } catch (err) {
    logger.error({ err }, "conversations POST /:id/messages ownership check error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to verify conversation" };
    res.status(500).json(body);
    return;
  }

  // ── 7. Open SSE stream ──────────────────────────────────────────────────────
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",     // disable nginx buffering
  });
  res.flushHeaders();

  const ac = new AbortController();
  // Client disconnect → abort the upstream LLM stream (no leak)
  req.on("close", () => ac.abort());

  /**
   * Write one SSE event.
   * Backpressure: if the kernel write buffer is full (res.write returns false),
   * abort the upstream stream to prevent unbounded memory growth on slow consumers.
   */
  const send = (event: string, data: unknown): void => {
    if (ac.signal.aborted || res.destroyed) return;
    const ok = res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (!ok) {
      // Kernel buffer full — abort to avoid unbounded buffering
      ac.abort();
    }
  };

  // ── 8. Run pipeline ─────────────────────────────────────────────────────────
  try {
    await runAskPipeline({
      tenantId: auth.tenantId,
      userId: auth.userId,
      roleId: auth.roleId,
      conversationId,
      text,
      llm: getLlmProvider(),
      send,
      signal: ac.signal,
      ...(req.ip !== undefined ? { ip: req.ip } : {}),
    });
  } catch (err) {
    // Pipeline errors are handled internally (always emits error/done).
    // This catch is a safety net for unexpected throws.
    logger.error({ err }, "conversations POST /:id/messages unhandled pipeline error");
  } finally {
    res.end();
  }
});

// ── DELETE /api/conversations/:id ─────────────────────────────────────────────

conversationsRouter.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  const parsed = ConversationIdSchema.safeParse(req.params);
  if (!parsed.success) {
    const body: ApiErrorResponse = { code: "VALIDATION", message: "Invalid conversation id" };
    res.status(400).json(body);
    return;
  }
  const { id } = parsed.data;
  try {
    const deleted = await req.withTenantTx!((tx) => deleteConversation(tx, id, userId));
    if (!deleted) {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "Conversation not found" };
      res.status(404).json(body);
      return;
    }
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "conversations DELETE /:id error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to delete conversation" };
    res.status(500).json(body);
  }
});
