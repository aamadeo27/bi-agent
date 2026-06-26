/**
 * Credential vault — envelope encryption with AES-256-GCM.
 *
 * Encryption flow (envelope pattern):
 *   1. Generate a random 32-byte data-encryption key (DEK).
 *   2. Encrypt the plaintext credential JSON with the DEK (AES-256-GCM).
 *   3. Wrap the DEK with the master key (AES-256-GCM).
 *   4. Return/store the compound envelope — never the DEK or plaintext.
 *
 * Master key: VAULT_MASTER_KEY env var (64 hex chars = 32 bytes).
 * Plaintext is only ever in memory; never logged or returned in API responses.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";

// ── Constants ──────────────────────────────────────────────────────────────────

export const KEY_REF_V1 = "master_key_v1";

const ALGORITHM = "aes-256-gcm" as const;
const KEY_LEN = 32; // bytes
const IV_LEN = 12;  // bytes (96-bit nonce, optimal for GCM)

// ── Internal types ─────────────────────────────────────────────────────────────

interface GcmBlob {
  iv: string;   // base64
  tag: string;  // base64 (16-byte auth tag)
  data: string; // base64 ciphertext
}

interface EncryptedEnvelope {
  version: 1;
  keyRef: string;
  wrappedDek: GcmBlob; // DEK encrypted with master key
  payload: GcmBlob;    // plaintext encrypted with DEK
}

// ── Master key resolution ──────────────────────────────────────────────────────

export function getMasterKey(): Buffer {
  const hex = process.env["VAULT_MASTER_KEY"];
  if (!hex) throw new Error("VAULT_MASTER_KEY is not set");
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== KEY_LEN) {
    throw new Error("VAULT_MASTER_KEY must be 32 bytes (64 hex chars)");
  }
  return buf;
}

// ── Low-level AES-256-GCM helpers ─────────────────────────────────────────────

function gcmEncrypt(key: Buffer, plaintext: Buffer): GcmBlob {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: ciphertext.toString("base64"),
  };
}

function gcmDecrypt(key: Buffer, blob: GcmBlob): Buffer {
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(blob.iv, "base64"),
    { authTagLength: 16 },
  );
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(blob.data, "base64")),
    decipher.final(),
  ]);
}

// ── Public vault API ───────────────────────────────────────────────────────────

/**
 * Encrypt a credential object into a serialized envelope string safe for
 * storage at rest. Plaintext credential is never logged.
 */
export function encryptCredential(plaintext: Record<string, unknown>): string {
  const masterKey = getMasterKey();
  const dek = randomBytes(KEY_LEN);
  const plaintextBuf = Buffer.from(JSON.stringify(plaintext), "utf8");
  const payload = gcmEncrypt(dek, plaintextBuf);
  const wrappedDek = gcmEncrypt(masterKey, dek);
  const envelope: EncryptedEnvelope = {
    version: 1,
    keyRef: KEY_REF_V1,
    wrappedDek,
    payload,
  };
  return JSON.stringify(envelope);
}

/**
 * Decrypt a credential envelope. Returns the original object.
 * Throws on tampered, malformed, or version-unknown envelopes.
 * Decrypted value stays in memory only — callers must not log or serialize it.
 */
export function decryptCredential(ciphertext: string): Record<string, unknown> {
  const masterKey = getMasterKey();
  const envelope = JSON.parse(ciphertext) as EncryptedEnvelope;
  if (envelope.version !== 1) {
    throw new Error(`Unsupported vault envelope version: ${envelope.version}`);
  }
  const dek = gcmDecrypt(masterKey, envelope.wrappedDek);
  const plaintext = gcmDecrypt(dek, envelope.payload);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
}

// ── Per-(tenant, role, dataSource) credential storage ─────────────────────────
// Used by the Query Proxy (T4.2+) — not directly exposed via HTTP.

interface CredVaultRow {
  id: string;
  data_source_id: string;
  role_id: string;
  encrypted_cred: string;
  key_ref: string;
}

/**
 * Write (upsert) an encrypted per-role credential for a data source.
 * Must be called inside a withTenantTx transaction.
 */
export async function setCredential(
  dataSourceId: string,
  roleId: string,
  credential: Record<string, unknown>,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const id = crypto.randomUUID();
  const encryptedCred = encryptCredential(credential);
  await tx.$executeRawUnsafe(
    `INSERT INTO cred_vault_refs (id, data_source_id, role_id, encrypted_cred, key_ref, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (data_source_id, role_id) DO UPDATE
       SET encrypted_cred = EXCLUDED.encrypted_cred,
           key_ref        = EXCLUDED.key_ref,
           updated_at     = NOW()`,
    id,
    dataSourceId,
    roleId,
    encryptedCred,
    KEY_REF_V1,
  );
}

/**
 * Retrieve and decrypt a per-role credential. Returns null when not found.
 * Must be called inside a withTenantTx transaction.
 * Decrypted value stays in memory — callers must not log it.
 */
export async function getCredential(
  dataSourceId: string,
  roleId: string,
  tx: Prisma.TransactionClient,
): Promise<Record<string, unknown> | null> {
  const rows = await tx.$queryRawUnsafe<CredVaultRow[]>(
    `SELECT id, data_source_id, role_id, encrypted_cred, key_ref
     FROM cred_vault_refs
     WHERE data_source_id = $1 AND role_id = $2`,
    dataSourceId,
    roleId,
  );
  if (!rows.length) return null;
  return decryptCredential(rows[0].encrypted_cred);
}

/**
 * Delete the per-role credential for a data source (e.g. when role is removed).
 * Must be called inside a withTenantTx transaction.
 */
export async function deleteCredential(
  dataSourceId: string,
  roleId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRawUnsafe(
    `DELETE FROM cred_vault_refs WHERE data_source_id = $1 AND role_id = $2`,
    dataSourceId,
    roleId,
  );
}
