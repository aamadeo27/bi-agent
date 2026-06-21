import { describe, it, expect } from "vitest";
import {
  // error codes
  ErrorCodeSchema,
  AppErrorSchema,
  SseErrorEventSchema,
  ApiErrorResponseSchema,
  // chat
  ResultEnvelopeSchema,
  SendMessageRequestSchema,
  ConversationSummarySchema,
  SseMetaEventSchema,
  SseTokenEventSchema,
  SseResultEventSchema,
  SseDoneEventSchema,
  SSE_EVENT_SCHEMAS,
  // permission-block
  PermissionBlockSchema,
  SseBlockEventSchema,
  // rbac
  RoleSchema,
  ResourceGrantSchema,
  ResourceGrantSetSchema,
  UserSchema,
  DataSourceSchema,
  // audit
  AuditEventSchema,
  AuditEventTypeSchema,
  // generated-query
  GeneratedQueryViewSchema,
  // auth
  JwtClaimsSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  InviteAcceptRequestSchema,
  MeResponseSchema,
} from "./index.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const ISO = new Date().toISOString();

// ─── Error codes ────────────────────────────────────────────────────────────

describe("ErrorCodeSchema", () => {
  const codes = [
    "GATE_BLOCK",
    "CLARIFICATION",
    "VALIDATION",
    "DATA_SOURCE",
    "LLM_ERROR",
    "AUTH",
    "TENANT",
    "NOT_FOUND",
    "RATE_LIMIT",
    "INTERNAL",
  ] as const;

  it("accepts all ten defined codes", () => {
    for (const code of codes) {
      expect(ErrorCodeSchema.parse(code)).toBe(code);
    }
  });

  it("rejects unknown codes", () => {
    expect(() => ErrorCodeSchema.parse("UNKNOWN")).toThrow();
    expect(() => ErrorCodeSchema.parse("")).toThrow();
  });
});

describe("AppErrorSchema — discriminated union", () => {
  it("GATE_BLOCK requires a PermissionBlock", () => {
    const valid = {
      code: "GATE_BLOCK",
      message: "Access denied",
      block: {
        messageId: "m1",
        roleName: "analyst",
        missing: [{ kind: "table", identifier: "sales.orders", accessNeeded: "read" }],
      },
    };
    expect(() => AppErrorSchema.parse(valid)).not.toThrow();
    const parsed = AppErrorSchema.parse(valid);
    expect(parsed.code).toBe("GATE_BLOCK");
  });

  it("GATE_BLOCK without block field is rejected", () => {
    expect(() =>
      AppErrorSchema.parse({ code: "GATE_BLOCK", message: "denied" })
    ).toThrow();
  });

  it("CLARIFICATION requires a text field", () => {
    const valid = { code: "CLARIFICATION", message: "Clarify?", text: "Which date range?" };
    expect(() => AppErrorSchema.parse(valid)).not.toThrow();
    const parsed = AppErrorSchema.parse(valid);
    if (parsed.code === "CLARIFICATION") {
      expect(parsed.text).toBe("Which date range?");
    }
  });

  it("CLARIFICATION without text is rejected", () => {
    expect(() =>
      AppErrorSchema.parse({ code: "CLARIFICATION", message: "ok" })
    ).toThrow();
  });

  it.each([
    "VALIDATION",
    "DATA_SOURCE",
    "LLM_ERROR",
    "AUTH",
    "TENANT",
    "NOT_FOUND",
    "RATE_LIMIT",
    "INTERNAL",
  ] as const)("%s parses with just a message", (code) => {
    expect(() => AppErrorSchema.parse({ code, message: "error" })).not.toThrow();
  });

  it("rejects unknown code in discriminated union", () => {
    expect(() =>
      AppErrorSchema.parse({ code: "BOGUS", message: "x" })
    ).toThrow();
  });
});

describe("SseErrorEventSchema", () => {
  it("parses valid SSE error event", () => {
    expect(() =>
      SseErrorEventSchema.parse({ code: "INTERNAL", message: "fail" })
    ).not.toThrow();
  });

  it("rejects unknown code", () => {
    expect(() =>
      SseErrorEventSchema.parse({ code: "OOPS", message: "x" })
    ).toThrow();
  });
});

describe("ApiErrorResponseSchema", () => {
  it("parses without optional requestId", () => {
    expect(() =>
      ApiErrorResponseSchema.parse({ code: "AUTH", message: "Unauthorized" })
    ).not.toThrow();
  });

  it("parses with requestId", () => {
    expect(() =>
      ApiErrorResponseSchema.parse({ code: "AUTH", message: "Unauthorized", requestId: "req-1" })
    ).not.toThrow();
  });
});

// ─── Chat / SSE ─────────────────────────────────────────────────────────────

describe("ResultEnvelopeSchema", () => {
  const base = {
    messageId: "m1",
    queryType: "sql",
    chartType: "bar",
    columns: [{ name: "region", type: "string", role: "dimension" }],
    rows: [{ region: "North", sales: 1200, active: null }],
    rowCount: 1,
    truncated: false,
  };

  it("parses a minimal valid envelope", () => {
    expect(() => ResultEnvelopeSchema.parse(base)).not.toThrow();
  });

  it("accepts optional notes field", () => {
    expect(() =>
      ResultEnvelopeSchema.parse({ ...base, notes: "downgraded to table" })
    ).not.toThrow();
  });

  it("rejects invalid chartType", () => {
    expect(() =>
      ResultEnvelopeSchema.parse({ ...base, chartType: "scatter" })
    ).toThrow();
  });

  it("rejects invalid column type", () => {
    expect(() =>
      ResultEnvelopeSchema.parse({
        ...base,
        columns: [{ name: "x", type: "bigint", role: "measure" }],
      })
    ).toThrow();
  });

  it("rejects negative rowCount", () => {
    expect(() =>
      ResultEnvelopeSchema.parse({ ...base, rowCount: -1 })
    ).toThrow();
  });
});

describe("SendMessageRequestSchema", () => {
  it("parses valid body", () => {
    expect(() =>
      SendMessageRequestSchema.parse({ text: "Show me sales" })
    ).not.toThrow();
  });

  it("rejects empty text", () => {
    expect(() => SendMessageRequestSchema.parse({ text: "" })).toThrow();
  });

  it("rejects missing text", () => {
    expect(() => SendMessageRequestSchema.parse({})).toThrow();
  });
});

describe("ConversationSummarySchema", () => {
  it("parses valid summary", () => {
    expect(() =>
      ConversationSummarySchema.parse({ id: "c1", title: "Sales Q4", updatedAt: ISO })
    ).not.toThrow();
  });

  it("rejects invalid datetime", () => {
    expect(() =>
      ConversationSummarySchema.parse({ id: "c1", title: "t", updatedAt: "not-a-date" })
    ).toThrow();
  });
});

describe("SSE event schemas", () => {
  it("SseMetaEventSchema parses meta", () => {
    expect(() =>
      SseMetaEventSchema.parse({ messageId: "m1", queryType: "sql" })
    ).not.toThrow();
  });

  it("SseTokenEventSchema parses token delta", () => {
    expect(() => SseTokenEventSchema.parse({ delta: "Hello" })).not.toThrow();
  });

  it("SseResultEventSchema parses result with full envelope", () => {
    const envelope = {
      messageId: "m1",
      queryType: "sql",
      chartType: "table",
      columns: [{ name: "n", type: "number", role: "measure" }],
      rows: [{ n: 42 }],
      rowCount: 1,
      truncated: false,
    };
    expect(() => SseResultEventSchema.parse({ envelope })).not.toThrow();
  });

  it("SseBlockEventSchema parses block event", () => {
    const block = {
      messageId: "m2",
      roleName: "viewer",
      missing: [{ kind: "schema", identifier: "finance", accessNeeded: "read" }],
    };
    expect(() => SseBlockEventSchema.parse({ block })).not.toThrow();
  });

  it("SseDoneEventSchema parses done event", () => {
    expect(() => SseDoneEventSchema.parse({ messageId: "m3" })).not.toThrow();
  });

  it("SSE_EVENT_SCHEMAS covers all six event names", () => {
    const names: Array<keyof typeof SSE_EVENT_SCHEMAS> = [
      "meta",
      "token",
      "result",
      "block",
      "error",
      "done",
    ];
    for (const name of names) {
      expect(SSE_EVENT_SCHEMAS[name]).toBeDefined();
    }
  });
});

// ─── Permission block ────────────────────────────────────────────────────────

describe("PermissionBlockSchema", () => {
  it("parses valid block with multiple missing resources", () => {
    const block = {
      messageId: "m2",
      roleName: "analyst",
      missing: [
        { kind: "table", identifier: "sales.orders", accessNeeded: "read" },
        { kind: "column", identifier: "sales.orders.revenue", accessNeeded: "read" },
      ],
    };
    expect(() => PermissionBlockSchema.parse(block)).not.toThrow();
  });

  it("parses empty missing array", () => {
    expect(() =>
      PermissionBlockSchema.parse({ messageId: "m", roleName: "r", missing: [] })
    ).not.toThrow();
  });

  it("rejects accessNeeded other than 'read'", () => {
    expect(() =>
      PermissionBlockSchema.parse({
        messageId: "m",
        roleName: "r",
        missing: [{ kind: "table", identifier: "x", accessNeeded: "write" }],
      })
    ).toThrow();
  });

  it("rejects invalid kind", () => {
    expect(() =>
      PermissionBlockSchema.parse({
        messageId: "m",
        roleName: "r",
        missing: [{ kind: "database", identifier: "x", accessNeeded: "read" }],
      })
    ).toThrow();
  });
});

// ─── RBAC model ──────────────────────────────────────────────────────────────

describe("RoleSchema", () => {
  const base = {
    id: "role-1",
    name: "analyst",
    capabilities: { canInspectQuery: false },
    createdAt: ISO,
    updatedAt: ISO,
  };

  it("parses valid role", () => {
    expect(() => RoleSchema.parse(base)).not.toThrow();
  });

  it("parses role with optional description", () => {
    expect(() => RoleSchema.parse({ ...base, description: "Read-only" })).not.toThrow();
  });

  it("rejects name longer than 64 chars", () => {
    expect(() => RoleSchema.parse({ ...base, name: "a".repeat(65) })).toThrow();
  });

  it("rejects description longer than 256 chars", () => {
    expect(() =>
      RoleSchema.parse({ ...base, description: "x".repeat(257) })
    ).toThrow();
  });
});

describe("ResourceGrantSchema", () => {
  it("parses schema-level grant", () => {
    expect(() =>
      ResourceGrantSchema.parse({
        roleId: "r1",
        dataSourceId: "ds1",
        kind: "schema",
        schema: "sales",
      })
    ).not.toThrow();
  });

  it("parses column-level grant", () => {
    expect(() =>
      ResourceGrantSchema.parse({
        roleId: "r1",
        dataSourceId: "ds1",
        kind: "column",
        schema: "sales",
        table: "orders",
        column: "revenue",
      })
    ).not.toThrow();
  });

  it("rejects invalid kind", () => {
    expect(() =>
      ResourceGrantSchema.parse({
        roleId: "r1",
        dataSourceId: "ds1",
        kind: "row",
        schema: "x",
      })
    ).toThrow();
  });
});

describe("ResourceGrantSetSchema", () => {
  it("accepts empty array", () => {
    expect(() => ResourceGrantSetSchema.parse([])).not.toThrow();
  });
});

describe("UserSchema", () => {
  const base = {
    id: "u1",
    email: "alice@example.com",
    displayName: "Alice",
    status: "active",
    roleId: "role-1",
    authMethods: ["password"],
    createdAt: ISO,
  };

  it("parses active user", () => {
    expect(() => UserSchema.parse(base)).not.toThrow();
  });

  it("parses user with null roleId", () => {
    expect(() => UserSchema.parse({ ...base, roleId: null })).not.toThrow();
  });

  it("rejects invalid email", () => {
    expect(() => UserSchema.parse({ ...base, email: "not-an-email" })).toThrow();
  });

  it("rejects invalid status", () => {
    expect(() => UserSchema.parse({ ...base, status: "deleted" })).toThrow();
  });

  it("rejects invalid authMethod", () => {
    expect(() =>
      UserSchema.parse({ ...base, authMethods: ["oauth"] })
    ).toThrow();
  });
});

describe("DataSourceSchema", () => {
  it("parses all four types", () => {
    for (const type of ["postgres", "mysql", "bigquery", "rest"] as const) {
      expect(() =>
        DataSourceSchema.parse({ id: "ds1", name: "n", type, status: "connected" })
      ).not.toThrow();
    }
  });

  it("rejects unknown type", () => {
    expect(() =>
      DataSourceSchema.parse({ id: "ds1", name: "n", type: "mssql", status: "connected" })
    ).toThrow();
  });
});

// ─── Audit event ─────────────────────────────────────────────────────────────

describe("AuditEventSchema", () => {
  const base = {
    id: "evt-1",
    tenantId: "t1",
    at: ISO,
    actorUserId: "u1",
    roleNameAtEvent: "analyst",
    type: "query_executed",
    outcome: "success",
    detail: {},
  };

  it("parses a minimal audit event", () => {
    expect(() => AuditEventSchema.parse(base)).not.toThrow();
  });

  it("parses event with optional fields", () => {
    expect(() =>
      AuditEventSchema.parse({ ...base, dataSourceId: "ds1", ip: "1.2.3.4" })
    ).not.toThrow();
  });

  it("parses all defined event types", () => {
    const types = [
      "query_executed",
      "query_blocked",
      "query_validation_failed",
      "export",
      "role_changed",
      "permission_changed",
      "user_role_assigned",
      "data_source_changed",
      "login",
      "login_failed",
    ] as const;
    for (const type of types) {
      expect(() => AuditEventSchema.parse({ ...base, type })).not.toThrow();
    }
  });

  it("rejects unknown event type", () => {
    expect(() =>
      AuditEventSchema.parse({ ...base, type: "password_reset" })
    ).toThrow();
  });

  it("rejects unknown outcome", () => {
    expect(() =>
      AuditEventSchema.parse({ ...base, outcome: "pending" })
    ).toThrow();
  });
});

describe("AuditEventTypeSchema", () => {
  it("accepts all ten types", () => {
    expect(AuditEventTypeSchema.options).toHaveLength(10);
  });
});

// ─── GeneratedQueryView ──────────────────────────────────────────────────────

describe("GeneratedQueryViewSchema", () => {
  it("parses valid SQL view", () => {
    expect(() =>
      GeneratedQueryViewSchema.parse({
        messageId: "m1",
        queryType: "sql",
        queryText: "SELECT * FROM sales",
        dataSourceName: "prod-db",
        executedAt: ISO,
        rowCount: 100,
      })
    ).not.toThrow();
  });

  it("rejects invalid queryType", () => {
    expect(() =>
      GeneratedQueryViewSchema.parse({
        messageId: "m1",
        queryType: "graphql",
        queryText: "{ orders }",
        dataSourceName: "api",
        executedAt: ISO,
        rowCount: 0,
      })
    ).toThrow();
  });

  it("rejects negative rowCount", () => {
    expect(() =>
      GeneratedQueryViewSchema.parse({
        messageId: "m1",
        queryType: "rest",
        queryText: "/orders",
        dataSourceName: "api",
        executedAt: ISO,
        rowCount: -5,
      })
    ).toThrow();
  });
});

// ─── Auth ────────────────────────────────────────────────────────────────────

describe("JwtClaimsSchema", () => {
  it("parses valid claims with role", () => {
    expect(() =>
      JwtClaimsSchema.parse({
        sub: "u1",
        tenantId: "t1",
        roleId: "role-1",
        exp: Math.floor(Date.now() / 1000) + 900,
      })
    ).not.toThrow();
  });

  it("parses claims with null roleId", () => {
    expect(() =>
      JwtClaimsSchema.parse({
        sub: "u1",
        tenantId: "t1",
        roleId: null,
        exp: 9999999999,
      })
    ).not.toThrow();
  });

  it("rejects non-integer exp", () => {
    expect(() =>
      JwtClaimsSchema.parse({ sub: "u1", tenantId: "t1", roleId: null, exp: 1.5 })
    ).toThrow();
  });
});

describe("LoginRequestSchema", () => {
  it("parses valid credentials", () => {
    expect(() =>
      LoginRequestSchema.parse({ email: "user@example.com", password: "s3cr3t" })
    ).not.toThrow();
  });

  it("rejects invalid email", () => {
    expect(() =>
      LoginRequestSchema.parse({ email: "bad", password: "pass" })
    ).toThrow();
  });

  it("rejects empty password", () => {
    expect(() =>
      LoginRequestSchema.parse({ email: "user@example.com", password: "" })
    ).toThrow();
  });
});

describe("LoginResponseSchema", () => {
  it("parses access token", () => {
    expect(() =>
      LoginResponseSchema.parse({ accessToken: "eyJ..." })
    ).not.toThrow();
  });
});

describe("InviteAcceptRequestSchema", () => {
  it("parses with token only", () => {
    expect(() =>
      InviteAcceptRequestSchema.parse({ token: "inv-tok" })
    ).not.toThrow();
  });

  it("parses with token + password", () => {
    expect(() =>
      InviteAcceptRequestSchema.parse({ token: "inv-tok", password: "newPass123" })
    ).not.toThrow();
  });

  it("rejects password shorter than 8 chars", () => {
    expect(() =>
      InviteAcceptRequestSchema.parse({ token: "inv-tok", password: "short" })
    ).toThrow();
  });
});

describe("MeResponseSchema", () => {
  const baseTenant = { id: "t1", displayName: "Acme Corp" };
  const baseRole = { id: "role-1", name: "Analyst" };
  const baseUser = {
    id: "u1",
    email: "alice@example.com",
    displayName: "Alice",
    status: "active" as const,
    authMethods: ["password"] as const,
  };

  it("parses valid me response with role and tenant objects", () => {
    expect(() =>
      MeResponseSchema.parse({
        user: baseUser,
        role: baseRole,
        capabilities: { canInspectQuery: true },
        tenant: baseTenant,
      })
    ).not.toThrow();
  });

  it("parses with null role (no role assigned)", () => {
    expect(() =>
      MeResponseSchema.parse({
        user: { ...baseUser, authMethods: ["sso"] },
        role: null,
        capabilities: { canInspectQuery: false },
        tenant: baseTenant,
      })
    ).not.toThrow();
  });

  it("parses with both password and sso authMethods", () => {
    expect(() =>
      MeResponseSchema.parse({
        user: { ...baseUser, authMethods: ["password", "sso"] },
        role: baseRole,
        capabilities: { canInspectQuery: false },
        tenant: baseTenant,
      })
    ).not.toThrow();
  });

  it("rejects missing authMethods", () => {
    const { authMethods: _, ...userWithoutMethods } = baseUser;
    expect(() =>
      MeResponseSchema.parse({
        user: userWithoutMethods,
        role: baseRole,
        capabilities: { canInspectQuery: false },
        tenant: baseTenant,
      })
    ).toThrow();
  });

  it("rejects tenant without displayName", () => {
    expect(() =>
      MeResponseSchema.parse({
        user: baseUser,
        role: baseRole,
        capabilities: { canInspectQuery: false },
        tenant: { id: "t1" },
      })
    ).toThrow();
  });
});
