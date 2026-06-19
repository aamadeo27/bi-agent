import { describe, it, expect } from "vitest";
import { getTenantSlug } from "./tenant";

describe("getTenantSlug", () => {
  it("returns null for bare localhost", () => {
    expect(getTenantSlug("localhost")).toBeNull();
  });

  it("returns null for localhost with port", () => {
    expect(getTenantSlug("localhost:5173")).toBeNull();
  });

  it("returns null for reserved label 'www'", () => {
    expect(getTenantSlug("www.example.com")).toBeNull();
  });

  it("returns null for reserved label 'app'", () => {
    expect(getTenantSlug("app.example.com")).toBeNull();
  });

  it("returns null for reserved label 'api'", () => {
    expect(getTenantSlug("api.example.com")).toBeNull();
  });

  it("returns tenant slug from subdomain", () => {
    expect(getTenantSlug("acme.example.com")).toBe("acme");
  });

  it("returns tenant slug from nested subdomain (first part)", () => {
    expect(getTenantSlug("acme.app.example.com")).toBe("acme");
  });

  it("returns tenant slug for dev pattern acme.localhost", () => {
    expect(getTenantSlug("acme.localhost")).toBe("acme");
  });

  it("returns tenant slug for acme.localhost with port", () => {
    expect(getTenantSlug("acme.localhost:5173")).toBe("acme");
  });

  it("returns null for plain IP (single label)", () => {
    expect(getTenantSlug("127")).toBeNull();
  });
});
