import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  encryptCredential,
  decryptCredential,
  getMasterKey,
  KEY_REF_V1,
  setCredential,
  getCredential,
  deleteCredential,
} from "./vault.js";
import type { Prisma } from "@prisma/client";

// ── Test master key (64 hex chars = 32 bytes) ──────────────────────────────────
const TEST_MASTER_KEY = "a".repeat(64); // 32 bytes of 0xAA

// ── Fixtures ───────────────────────────────────────────────────────────────────
const CRED = { host: "db.example.com", port: 5432, database: "analytics", username: "reader", password: "s3cr3t" };

// ── Helpers ────────────────────────────────────────────────────────────────────

function withMasterKey(key = TEST_MASTER_KEY): void {
  process.env["VAULT_MASTER_KEY"] = key;
}

function clearMasterKey(): void {
  delete process.env["VAULT_MASTER_KEY"];
}

// ── getMasterKey ───────────────────────────────────────────────────────────────

describe("getMasterKey", () => {
  afterEach(clearMasterKey);

  it("returns a 32-byte buffer from the env var", () => {
    withMasterKey();
    const key = getMasterKey();
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it("throws when VAULT_MASTER_KEY is not set", () => {
    clearMasterKey();
    expect(() => getMasterKey()).toThrow("VAULT_MASTER_KEY is not set");
  });

  it("throws when VAULT_MASTER_KEY is wrong length", () => {
    process.env["VAULT_MASTER_KEY"] = "deadbeef"; // only 4 bytes
    expect(() => getMasterKey()).toThrow("32 bytes");
  });
});

// ── encryptCredential / decryptCredential round-trip ──────────────────────────

describe("encryptCredential / decryptCredential", () => {
  beforeEach(() => withMasterKey());
  afterEach(clearMasterKey);

  it("round-trips a credential object", () => {
    const ciphertext = encryptCredential(CRED);
    const decrypted = decryptCredential(ciphertext);
    expect(decrypted).toEqual(CRED);
  });

  it("produces different ciphertext on each call (fresh DEK + IV)", () => {
    const a = encryptCredential(CRED);
    const b = encryptCredential(CRED);
    expect(a).not.toBe(b);
  });

  it("stores a version-1 envelope with correct keyRef", () => {
    const ciphertext = encryptCredential(CRED);
    const envelope = JSON.parse(ciphertext);
    expect(envelope.version).toBe(1);
    expect(envelope.keyRef).toBe(KEY_REF_V1);
    expect(envelope.wrappedDek).toHaveProperty("iv");
    expect(envelope.wrappedDek).toHaveProperty("tag");
    expect(envelope.wrappedDek).toHaveProperty("data");
    expect(envelope.payload).toHaveProperty("iv");
    expect(envelope.payload).toHaveProperty("tag");
    expect(envelope.payload).toHaveProperty("data");
  });

  it("envelope does not contain any plaintext credential value", () => {
    const ciphertext = encryptCredential(CRED);
    expect(ciphertext).not.toContain(CRED.password);
    expect(ciphertext).not.toContain(CRED.host);
    expect(ciphertext).not.toContain(CRED.username);
  });

  it("throws on tampered ciphertext (GCM authentication failure)", () => {
    const ciphertext = encryptCredential(CRED);
    const envelope = JSON.parse(ciphertext);
    // Flip one byte in the payload data
    const payloadData = Buffer.from(envelope.payload.data, "base64");
    payloadData[0] ^= 0xff;
    envelope.payload.data = payloadData.toString("base64");
    expect(() => decryptCredential(JSON.stringify(envelope))).toThrow();
  });

  it("throws on tampered wrappedDek", () => {
    const ciphertext = encryptCredential(CRED);
    const envelope = JSON.parse(ciphertext);
    const dekData = Buffer.from(envelope.wrappedDek.data, "base64");
    dekData[0] ^= 0xff;
    envelope.wrappedDek.data = dekData.toString("base64");
    expect(() => decryptCredential(JSON.stringify(envelope))).toThrow();
  });

  it("throws on unsupported version", () => {
    const ciphertext = encryptCredential(CRED);
    const envelope = JSON.parse(ciphertext);
    envelope.version = 99;
    expect(() => decryptCredential(JSON.stringify(envelope))).toThrow("version");
  });

  it("throws when master key is wrong for decryption", () => {
    withMasterKey(TEST_MASTER_KEY);
    const ciphertext = encryptCredential(CRED);
    // Switch to a different key
    process.env["VAULT_MASTER_KEY"] = "b".repeat(64);
    expect(() => decryptCredential(ciphertext)).toThrow();
  });
});

// ── setCredential / getCredential / deleteCredential ──────────────────────────

describe("setCredential / getCredential / deleteCredential", () => {
  beforeEach(() => withMasterKey());
  afterEach(clearMasterKey);

  function buildTx(store: Map<string, string>): Prisma.TransactionClient {
    return {
      $executeRawUnsafe: vi.fn().mockImplementation(
        async (_sql: string, _id: string, dsId: string, roleId: string, encrypted: string) => {
          store.set(`${dsId}:${roleId}`, encrypted);
          return 1;
        },
      ),
      $queryRawUnsafe: vi.fn().mockImplementation(
        async (_sql: string, dsId: string, roleId: string) => {
          const enc = store.get(`${dsId}:${roleId}`);
          if (!enc) return [];
          return [{ id: "r1", data_source_id: dsId, role_id: roleId, encrypted_cred: enc, key_ref: KEY_REF_V1 }];
        },
      ),
    } as unknown as Prisma.TransactionClient;
  }

  it("stores encrypted credential and retrieves it decrypted", async () => {
    const store = new Map<string, string>();
    const tx = buildTx(store);
    await setCredential("ds-1", "role-1", CRED, tx);
    const retrieved = await getCredential("ds-1", "role-1", tx);
    expect(retrieved).toEqual(CRED);
  });

  it("stored value is ciphertext — not plaintext", async () => {
    const store = new Map<string, string>();
    const tx = buildTx(store);
    await setCredential("ds-1", "role-1", CRED, tx);
    const stored = store.get("ds-1:role-1")!;
    expect(stored).not.toContain(CRED.password);
    expect(stored).not.toContain(CRED.host);
  });

  it("returns null when credential not found", async () => {
    const store = new Map<string, string>();
    const tx = buildTx(store);
    const result = await getCredential("ds-99", "role-99", tx);
    expect(result).toBeNull();
  });

  it("deleteCredential calls executeRawUnsafe with DELETE statement", async () => {
    const store = new Map<string, string>();
    const tx = buildTx(store);
    const execSpy = tx.$executeRawUnsafe as ReturnType<typeof vi.fn>;
    await deleteCredential("ds-1", "role-1", tx);
    expect(execSpy).toHaveBeenCalledWith(
      expect.stringContaining("DELETE"),
      "ds-1",
      "role-1",
    );
  });
});
