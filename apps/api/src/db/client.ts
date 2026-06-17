import { PrismaClient } from "@prisma/client";

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  // When an explicit URL is given (integration tests, etc.) pass it directly.
  // Otherwise let Prisma read DATABASE_URL from the environment; throwing at
  // connection time rather than construction time keeps the module side-effect
  // free for unit-test environments where no DB is present.
  if (databaseUrl !== undefined) {
    return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }
  return new PrismaClient();
}

// Lazily initialised singleton — not constructed until first call.
let _prisma: PrismaClient | undefined;
export function getPrisma(): PrismaClient {
  _prisma ??= createPrismaClient();
  return _prisma;
}
