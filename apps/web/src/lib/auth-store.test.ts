import { describe, it, expect, beforeEach } from "vitest";
import { getAccessToken, setAccessToken, clearAccessToken } from "./auth-store";

describe("auth-store", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  it("initially returns null", () => {
    expect(getAccessToken()).toBeNull();
  });

  it("stores and retrieves an access token", () => {
    setAccessToken("tok_abc");
    expect(getAccessToken()).toBe("tok_abc");
  });

  it("overwrites an existing token", () => {
    setAccessToken("tok_old");
    setAccessToken("tok_new");
    expect(getAccessToken()).toBe("tok_new");
  });

  it("clears the token", () => {
    setAccessToken("tok_abc");
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });

  it("is idempotent — clear on empty store stays null", () => {
    clearAccessToken();
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });
});
