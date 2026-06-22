-- CreateTable
CREATE TABLE "platform"."tenant_sso_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "issuer" VARCHAR(512) NOT NULL,
    "client_id" VARCHAR(256) NOT NULL,
    "client_secret" TEXT NOT NULL,
    "callback_url" VARCHAR(512) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_sso_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_sso_configs_tenant_id_key" ON "platform"."tenant_sso_configs"("tenant_id");

-- AddForeignKey
ALTER TABLE "platform"."tenant_sso_configs" ADD CONSTRAINT "tenant_sso_configs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
