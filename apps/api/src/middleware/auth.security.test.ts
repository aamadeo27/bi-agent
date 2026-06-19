/**
 * Security-adversarial tests for authMiddleware.
 * Covers expired tokens, tampered payloads, wrong secrets, and alg-confusion.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { SignJWT } from "jose";
import { TEST_SECRET, SECRET_KEY, signToken, buildAuthApp } from "./test-helpers.js";

const OTHER_SECRET = new TextEncoder().encode("a-completely-different-secret!!!");

describe("authMiddleware — security", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", TEST_SECRET);
  });

  it("rejects an expired token", async () => {
    const token = await signToken(
      { sub: "user1", tenantId: "t1", roleId: null },
      SECRET_KEY,
      "-1m"
    );
    const res = await request(buildAuthApp())
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signToken(
      { sub: "user1", tenantId: "t1", roleId: null },
      OTHER_SECRET
    );
    const res = await request(buildAuthApp())
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("rejects a token with tampered payload (signature mismatch)", async () => {
    const token = await signToken({ sub: "user1", tenantId: "t1", roleId: null });
    const parts = token.split(".");
    const original = parts[1]!;
    const flipped =
      original.slice(0, -1) + (original.slice(-1) === "a" ? "b" : "a");
    const tampered = [parts[0], flipped, parts[2]].join(".");

    const res = await request(buildAuthApp())
      .get("/protected")
      .set("Authorization", `Bearer ${tampered}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("rejects a 'none' algorithm token (alg-confusion attack)", async () => {
    const hdr = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url"
    );
    const claims = {
      sub: "attacker",
      tenantId: "victim-tenant",
      roleId: null,
      exp: Math.floor(Date.now() / 1000) + 900,
    };
    const pld = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const noneToken = `${hdr}.${pld}.`;

    const res = await request(buildAuthApp())
      .get("/protected")
      .set("Authorization", `Bearer ${noneToken}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("rejects a token missing required claims (tenantId absent)", async () => {
    const token = await new SignJWT({ sub: "user1", roleId: null })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("15m")
      .sign(SECRET_KEY);

    const res = await request(buildAuthApp())
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("does not leak internal error details in the response", async () => {
    const res = await request(buildAuthApp())
      .get("/protected")
      .set("Authorization", "Bearer bad");

    expect(res.status).toBe(401);
    const msg: string = res.body.message ?? "";
    expect(msg).not.toMatch(/stack|Error:|secret|JWT_SECRET/i);
  });
});
