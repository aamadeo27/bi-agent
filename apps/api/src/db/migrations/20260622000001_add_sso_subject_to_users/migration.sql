-- AddColumn: nullable SSO subject for OIDC identity binding (invite-first model).
-- The subject is bound on first successful SSO login and used for all subsequent lookups.
ALTER TABLE "platform"."users" ADD COLUMN "sso_subject" TEXT;

-- Partial unique index: allows multiple NULLs (unbound users) but enforces
-- uniqueness once a subject is bound.
CREATE UNIQUE INDEX "users_sso_subject_key" ON "platform"."users"("sso_subject")
    WHERE "sso_subject" IS NOT NULL;
