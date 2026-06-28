import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";

import {
  listConversations,
  createConversation,
  getConversation,
  getMessages,
  deleteConversation,
  addMessage,
  getHistoryWindow,
  estimateTokens,
} from "./index.js";

// ---------------------------------------------------------------------------
// Helpers to build mock rows
// ---------------------------------------------------------------------------

function makeConvRow(overrides: Partial<{
  id: string;
  user_id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
}> = {}) {
  return {
    id: "conv-1",
    user_id: "user-a",
    title: "",
    created_at: new Date("2025-01-01T00:00:00Z"),
    updated_at: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeMessageRow(overrides: Partial<{
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  query_type: string | null;
  generated_query: string | null;
  result_envelope: unknown | null;
  created_at: Date;
}> = {}) {
  return {
    id: "msg-1",
    conversation_id: "conv-1",
    role: "user",
    content: "Hello",
    query_type: null,
    generated_query: null,
    result_envelope: null,
    created_at: new Date("2025-01-01T00:01:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Prisma transaction client
// ---------------------------------------------------------------------------

function buildMockTx(responses: Array<unknown>) {
  let call = 0;
  return {
    $queryRawUnsafe: vi.fn().mockImplementation(() => {
      return Promise.resolve(responses[call++] ?? []);
    }),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
  } as unknown as Prisma.TransactionClient;
}

// ---------------------------------------------------------------------------
// listConversations
// ---------------------------------------------------------------------------

describe("listConversations", () => {
  it("returns mapped summaries for a user", async () => {
    const row = makeConvRow({ title: "My conv", user_id: "user-a" });
    const tx = buildMockTx([[row]]);
    const result = await listConversations(tx, "user-a");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("conv-1");
    expect(result[0].title).toBe("My conv");
    expect(result[0].updatedAt).toBe(row.updated_at.toISOString());
  });

  it("returns empty array when user has no conversations", async () => {
    const tx = buildMockTx([[]]);
    const result = await listConversations(tx, "user-b");
    expect(result).toEqual([]);
  });

  it("queries with the correct userId parameter", async () => {
    const tx = buildMockTx([[]]);
    await listConversations(tx, "user-xyz");
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("user_id"),
      "user-xyz",
    );
  });
});

// ---------------------------------------------------------------------------
// createConversation
// ---------------------------------------------------------------------------

describe("createConversation", () => {
  it("inserts a conversation and returns a summary", async () => {
    const row = makeConvRow({ id: "new-id", user_id: "user-a", title: "" });
    const tx = buildMockTx([[row]]);
    const result = await createConversation(tx, "new-id", "user-a");
    expect(result.id).toBe("new-id");
    expect(result.title).toBe("");
  });

  it("passes id and userId to the INSERT", async () => {
    const row = makeConvRow({ id: "c-99", user_id: "u-1" });
    const tx = buildMockTx([[row]]);
    await createConversation(tx, "c-99", "u-1");
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO conversations"),
      "c-99",
      "u-1",
    );
  });
});

// ---------------------------------------------------------------------------
// getConversation
// ---------------------------------------------------------------------------

describe("getConversation", () => {
  it("returns summary when conversation belongs to user", async () => {
    const row = makeConvRow({ id: "c1", user_id: "u1" });
    const tx = buildMockTx([[row]]);
    const result = await getConversation(tx, "c1", "u1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("c1");
  });

  it("returns null when conversation not found (wrong user or missing)", async () => {
    const tx = buildMockTx([[]]); // no rows
    const result = await getConversation(tx, "c1", "other-user");
    expect(result).toBeNull();
  });

  it("queries with both conversationId and userId (tenant scoping)", async () => {
    const tx = buildMockTx([[]]);
    await getConversation(tx, "c-abc", "u-xyz");
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("user_id"),
      "c-abc",
      "u-xyz",
    );
  });
});

// ---------------------------------------------------------------------------
// getMessages
// ---------------------------------------------------------------------------

describe("getMessages", () => {
  it("returns messages for an owned conversation", async () => {
    const convRow = makeConvRow({ id: "c1", user_id: "u1" });
    const msgRow = makeMessageRow({ id: "m1", conversation_id: "c1", content: "Hi" });
    // First call = getConversation, second = messages select
    const tx = buildMockTx([[convRow], [msgRow]]);
    const result = await getMessages(tx, "c1", "u1");
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].content).toBe("Hi");
    expect(result![0].role).toBe("user");
  });

  it("returns null when conversation does not belong to user", async () => {
    // getConversation returns empty → null
    const tx = buildMockTx([[]]); // ownership check fails
    const result = await getMessages(tx, "c1", "different-user");
    expect(result).toBeNull();
  });

  it("maps result_envelope from JSONB to object", async () => {
    const convRow = makeConvRow({ id: "c1", user_id: "u1" });
    const envelope = {
      messageId: "m1",
      queryType: "sql",
      chartType: "bar",
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
    };
    const msgRow = makeMessageRow({
      id: "m1",
      role: "assistant",
      result_envelope: envelope,
    });
    const tx = buildMockTx([[convRow], [msgRow]]);
    const result = await getMessages(tx, "c1", "u1");
    expect(result![0].resultEnvelope).toEqual(envelope);
  });

  it("maps queryType and generatedQuery fields", async () => {
    const convRow = makeConvRow({ id: "c1", user_id: "u1" });
    const msgRow = makeMessageRow({
      role: "assistant",
      query_type: "sql",
      generated_query: "SELECT 1",
    });
    const tx = buildMockTx([[convRow], [msgRow]]);
    const result = await getMessages(tx, "c1", "u1");
    expect(result![0].queryType).toBe("sql");
    expect(result![0].generatedQuery).toBe("SELECT 1");
  });
});

// ---------------------------------------------------------------------------
// deleteConversation
// ---------------------------------------------------------------------------

describe("deleteConversation", () => {
  it("returns true when conversation deleted successfully", async () => {
    const tx = buildMockTx([[{ id: "c1" }]]);
    const result = await deleteConversation(tx, "c1", "u1");
    expect(result).toBe(true);
  });

  it("returns false when conversation not found or wrong user", async () => {
    const tx = buildMockTx([[]]); // DELETE returns no rows
    const result = await deleteConversation(tx, "c-missing", "u1");
    expect(result).toBe(false);
  });

  it("passes both conversationId and userId to DELETE (tenant scoping)", async () => {
    const tx = buildMockTx([[{ id: "c1" }]]);
    await deleteConversation(tx, "c1", "u-abc");
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("user_id"),
      "c1",
      "u-abc",
    );
  });

  it("cascade — DELETE statement references conversations table (messages cascade via FK)", async () => {
    const tx = buildMockTx([[{ id: "c1" }]]);
    await deleteConversation(tx, "c1", "u1");
    const call = (tx.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toMatch(/DELETE FROM conversations/);
  });
});

// ---------------------------------------------------------------------------
// addMessage
// ---------------------------------------------------------------------------

describe("addMessage", () => {
  it("inserts a user message and updates conversation title when empty", async () => {
    const msgRow = makeMessageRow({ id: "m-new", role: "user", content: "Sales report?" });
    const tx = buildMockTx([[msgRow]]);
    const result = await addMessage(tx, {
      id: "m-new",
      conversationId: "c1",
      role: "user",
      content: "Sales report?",
    });
    expect(result.id).toBe("m-new");
    expect(result.role).toBe("user");
    // Should also update conversation (title + updated_at)
    expect(tx.$executeRawUnsafe).toHaveBeenCalled();
  });

  it("inserts an assistant message and updates updated_at only", async () => {
    const msgRow = makeMessageRow({ id: "m-2", role: "assistant", content: "Here is the data" });
    const tx = buildMockTx([[msgRow]]);
    await addMessage(tx, {
      id: "m-2",
      conversationId: "c1",
      role: "assistant",
      content: "Here is the data",
    });
    // executeRawUnsafe called for updated_at update but not title
    const updateCall = (tx.$executeRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(updateCall).not.toContain("LEFT(");
  });

  it("stores result_envelope as JSON", async () => {
    const envelope = {
      messageId: "m-3",
      queryType: "sql" as const,
      chartType: "table" as const,
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
    };
    const msgRow = makeMessageRow({ id: "m-3", role: "assistant", result_envelope: envelope });
    const tx = buildMockTx([[msgRow]]);
    await addMessage(tx, {
      id: "m-3",
      conversationId: "c1",
      role: "assistant",
      content: "results",
      resultEnvelope: envelope,
    });
    const insertCall = (tx.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0];
    // 7th arg is the JSON-serialised envelope
    expect(insertCall[7]).toBe(JSON.stringify(envelope));
  });
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  it("returns ceil(length / 4) tokens", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// getHistoryWindow
// ---------------------------------------------------------------------------

describe("getHistoryWindow", () => {
  function buildMessages(contents: string[]) {
    return contents.map((content, i) =>
      makeMessageRow({
        id: `m-${i}`,
        conversation_id: "c1",
        role: i % 2 === 0 ? "user" : "assistant",
        content,
        created_at: new Date(Date.UTC(2025, 0, 1, 0, i)),
      }),
    );
  }

  it("returns all messages when budget is large enough", async () => {
    const convRow = makeConvRow({ id: "c1", user_id: "u1" });
    const msgRows = buildMessages(["Hello", "World", "Foo"]);
    const tx = buildMockTx([[convRow], msgRows]);
    const result = await getHistoryWindow(tx, "c1", "u1", 10_000);
    expect(result).toHaveLength(3);
  });

  it("returns empty when conversation not found (wrong user)", async () => {
    const tx = buildMockTx([[]]); // ownership check fails
    const result = await getHistoryWindow(tx, "c1", "wrong-user", 10_000);
    expect(result).toEqual([]);
  });

  it("truncates oldest messages to fit budget", async () => {
    const convRow = makeConvRow({ id: "c1", user_id: "u1" });
    // 3 messages, each 4 chars = 1 token each → budget of 2 keeps last 2
    const msgRows = buildMessages(["aaaa", "bbbb", "cccc"]);
    const tx = buildMockTx([[convRow], msgRows]);
    const result = await getHistoryWindow(tx, "c1", "u1", 2);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("bbbb");
    expect(result[1].content).toBe("cccc");
  });

  it("returns empty when budget is 0", async () => {
    const convRow = makeConvRow({ id: "c1", user_id: "u1" });
    const msgRows = buildMessages(["hello"]);
    const tx = buildMockTx([[convRow], msgRows]);
    const result = await getHistoryWindow(tx, "c1", "u1", 0);
    expect(result).toEqual([]);
  });

  it("preserves chronological order (oldest first) in returned window", async () => {
    const convRow = makeConvRow({ id: "c1", user_id: "u1" });
    // budget of 2 tokens → last 2 of 3
    const msgRows = buildMessages(["aaaa", "bbbb", "cccc"]);
    const tx = buildMockTx([[convRow], msgRows]);
    const result = await getHistoryWindow(tx, "c1", "u1", 2);
    expect(result[0].content).toBe("bbbb");
    expect(result[1].content).toBe("cccc");
  });

  it("stops accumulating when a single message exceeds remaining budget", async () => {
    const convRow = makeConvRow({ id: "c1", user_id: "u1" });
    // 3 messages: costs 2, 2, 2 tokens. Budget = 3 → only last 1 (cost=2) fits? No...
    // "abcdefgh" = 8 chars = 2 tokens. Budget=3 → can fit 1 (2 tokens used, 1 remaining)
    // then next from the back: another 8 chars = 2 tokens, 1 remaining < 2 → stop
    const msgRows = buildMessages(["abcdefgh", "abcdefgh", "abcdefgh"]);
    const tx = buildMockTx([[convRow], msgRows]);
    const result = await getHistoryWindow(tx, "c1", "u1", 3);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("abcdefgh");
  });
});
