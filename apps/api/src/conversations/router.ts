import { Router } from "express";
import type { Router as ExpressRouter, Request, Response } from "express";
import type { ApiErrorResponse } from "@bi/contracts";
import { logger } from "../observability/logger.js";
import {
  listConversations,
  createConversation,
  getMessages,
  deleteConversation,
} from "./index.js";

export const conversationsRouter: ExpressRouter = Router();

// ── GET /api/conversations ────────────────────────────────────────────────────

conversationsRouter.get("/", async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  try {
    const conversations = await req.withTenantTx!((tx) => listConversations(tx, userId));
    res.json(conversations);
  } catch (err) {
    logger.error(err, "conversations GET / error");
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
    logger.error(err, "conversations POST error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to create conversation" };
    res.status(500).json(body);
  }
});

// ── GET /api/conversations/:id/messages ──────────────────────────────────────

conversationsRouter.get("/:id/messages", async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  const { id } = req.params;
  try {
    const messages = await req.withTenantTx!((tx) => getMessages(tx, id, userId));
    if (messages === null) {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "Conversation not found" };
      res.status(404).json(body);
      return;
    }
    res.json(messages);
  } catch (err) {
    logger.error(err, "conversations GET /:id/messages error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to fetch messages" };
    res.status(500).json(body);
  }
});

// ── DELETE /api/conversations/:id ─────────────────────────────────────────────

conversationsRouter.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  const { id } = req.params;
  try {
    const deleted = await req.withTenantTx!((tx) => deleteConversation(tx, id, userId));
    if (!deleted) {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "Conversation not found" };
      res.status(404).json(body);
      return;
    }
    res.status(204).send();
  } catch (err) {
    logger.error(err, "conversations DELETE /:id error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to delete conversation" };
    res.status(500).json(body);
  }
});
