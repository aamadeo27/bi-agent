import { describe, it, expect } from "vitest";
import {
  ErrorCodeSchema,
  ResultEnvelopeSchema,
  PermissionBlockSchema,
  AuditEventSchema,
  GeneratedQueryViewSchema,
  JwtClaimsSchema,
  RoleSchema,
} from "./index";

describe("contracts stubs compile and parse valid payloads", () => {
  it("ErrorCodeSchema accepts all defined error codes", () => {
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
    for (const code of codes) {
      expect(ErrorCodeSchema.parse(code)).toBe(code);
    }
  });

  it("ResultEnvelopeSchema parses a minimal valid envelope", () => {
    const envelope = {
      messageId: "msg-001",
      queryType: "sql",
      chartType: "bar",
      columns: [{ name: "region", type: "string", role: "dimension" }],
      rows: [{ region: "North" }],
      rowCount: 1,
      truncated: false,
    };
    expect(() => ResultEnvelopeSchema.parse(envelope)).not.toThrow();
  });

  it("PermissionBlockSchema parses a valid block", () => {
    const block = {
      messageId: "msg-002",
      roleName: "analyst",
      missing: [
        { kind: "table", identifier: "sales.orders", accessNeeded: "read" },
      ],
    };
    expect(() => PermissionBlockSchema.parse(block)).not.toThrow();
  });

  it("AuditEventSchema parses a valid event", () => {
    const event = {
      id: "evt-001",
      tenantId: "tenant-1",
      at: new Date().toISOString(),
      actorUserId: "user-1",
      roleNameAtEvent: "analyst",
      type: "query_executed",
      outcome: "success",
      detail: {},
    };
    expect(() => AuditEventSchema.parse(event)).not.toThrow();
  });

  it("GeneratedQueryViewSchema rejects invalid queryType", () => {
    const view = {
      messageId: "msg-003",
      queryType: "graphql",
      queryText: "SELECT 1",
      dataSourceName: "prod-db",
      executedAt: new Date().toISOString(),
      rowCount: 0,
    };
    expect(() => GeneratedQueryViewSchema.parse(view)).toThrow();
  });

  it("JwtClaimsSchema parses valid claims", () => {
    const claims = {
      sub: "user-1",
      tenantId: "tenant-1",
      roleId: "role-1",
      exp: Math.floor(Date.now() / 1000) + 900,
    };
    expect(() => JwtClaimsSchema.parse(claims)).not.toThrow();
  });

  it("RoleSchema enforces name max length", () => {
    const role = {
      id: "role-1",
      name: "a".repeat(65),
      capabilities: { canInspectQuery: false },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(() => RoleSchema.parse(role)).toThrow();
  });
});
