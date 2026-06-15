import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  safeParse,
  parseOrThrow,
  parseSseEventData,
  parseAppError,
  safeParseAppError,
  formatZodError,
  assertNever,
} from "./parse.js";
import { ResultEnvelopeSchema } from "./chat.js";

const validEnvelope = {
  messageId: "m1",
  queryType: "sql",
  chartType: "bar",
  columns: [{ name: "n", type: "number", role: "measure" }],
  rows: [{ n: 1 }],
  rowCount: 1,
  truncated: false,
} as const;

describe("safeParse", () => {
  it("returns success=true for valid data", () => {
    const result = safeParse(ResultEnvelopeSchema, validEnvelope);
    expect(result.success).toBe(true);
  });

  it("returns success=false and error for invalid data", () => {
    const result = safeParse(ResultEnvelopeSchema, { invalid: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(z.ZodError);
    }
  });
});

describe("parseOrThrow", () => {
  it("returns value for valid data", () => {
    const val = parseOrThrow(ResultEnvelopeSchema, validEnvelope);
    expect(val.messageId).toBe("m1");
  });

  it("throws ZodError for invalid data", () => {
    expect(() => parseOrThrow(ResultEnvelopeSchema, { bad: 1 })).toThrow(z.ZodError);
  });
});

describe("parseSseEventData", () => {
  it("parses meta event", () => {
    const data = parseSseEventData("meta", { messageId: "m1", queryType: "sql" });
    expect(data.messageId).toBe("m1");
    expect(data.queryType).toBe("sql");
  });

  it("parses token event", () => {
    const data = parseSseEventData("token", { delta: "Hello" });
    expect(data.delta).toBe("Hello");
  });

  it("parses done event", () => {
    const data = parseSseEventData("done", { messageId: "m1" });
    expect(data.messageId).toBe("m1");
  });

  it("parses block event", () => {
    const data = parseSseEventData("block", {
      block: {
        messageId: "m1",
        roleName: "viewer",
        missing: [{ kind: "table", identifier: "x.y", accessNeeded: "read" }],
      },
    });
    expect(data.block.roleName).toBe("viewer");
  });

  it("parses error event", () => {
    const data = parseSseEventData("error", { code: "AUTH", message: "Forbidden" });
    expect(data.code).toBe("AUTH");
  });

  it("throws on invalid payload for the event type", () => {
    expect(() => parseSseEventData("meta", { bad: true })).toThrow();
  });
});

describe("parseAppError", () => {
  it("parses GATE_BLOCK with block payload", () => {
    const err = parseAppError({
      code: "GATE_BLOCK",
      message: "blocked",
      block: {
        messageId: "m1",
        roleName: "r",
        missing: [{ kind: "column", identifier: "s.t.c", accessNeeded: "read" }],
      },
    });
    expect(err.code).toBe("GATE_BLOCK");
  });

  it("parses INTERNAL with only a message", () => {
    const err = parseAppError({ code: "INTERNAL", message: "server error" });
    expect(err.code).toBe("INTERNAL");
  });

  it("throws for unknown code", () => {
    expect(() => parseAppError({ code: "NOPE", message: "x" })).toThrow();
  });
});

describe("safeParseAppError", () => {
  it("succeeds for valid app error", () => {
    const result = safeParseAppError({ code: "NOT_FOUND", message: "missing" });
    expect(result.success).toBe(true);
  });

  it("fails for invalid data without throwing", () => {
    const result = safeParseAppError(null);
    expect(result.success).toBe(false);
  });
});

describe("formatZodError", () => {
  it("formats field errors into a readable string", () => {
    const result = z.object({ name: z.string() }).safeParse({ name: 42 });
    if (!result.success) {
      const msg = formatZodError(result.error);
      expect(msg).toContain("name");
      expect(msg).toContain("Expected string");
    }
  });

  it("handles root-level errors (empty path)", () => {
    const result = z.string().safeParse(123);
    if (!result.success) {
      const msg = formatZodError(result.error);
      expect(msg).toBeTruthy();
      expect(msg).not.toContain("undefined");
    }
  });
});

describe("assertNever", () => {
  it("throws at runtime when called", () => {
    expect(() => assertNever("x" as never)).toThrow("Unhandled discriminant");
  });

  it("enables exhaustive switch at compile time", () => {
    type Color = "red" | "blue";
    function label(c: Color): string {
      switch (c) {
        case "red":
          return "Red";
        case "blue":
          return "Blue";
        default:
          return assertNever(c);
      }
    }
    expect(label("red")).toBe("Red");
    expect(label("blue")).toBe("Blue");
  });
});
