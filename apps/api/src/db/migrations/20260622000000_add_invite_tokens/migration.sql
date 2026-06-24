-- Allow invited users to have no password yet (set on invite accept).
ALTER TABLE "platform"."users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateTable: invite tokens — opaque random bytes, stored as SHA-256 hash.
CREATE TABLE "platform"."invite_tokens" (
    "id"         TEXT NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "user_id"    TEXT NOT NULL,
    "tenant_id"  TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at"    TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invite_tokens_token_hash_key" ON "platform"."invite_tokens"("token_hash");

-- AddForeignKey
ALTER TABLE "platform"."invite_tokens" ADD CONSTRAINT "invite_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
