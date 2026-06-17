import type { PrismaClient, Prisma } from "@prisma/client";
import { getPrisma } from "./client.js";
import { validateTenantId, tenantSchema } from "./tenant-utils.js";

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  client?: PrismaClient
): Promise<T> {
  validateTenantId(tenantId);
  const schema = tenantSchema(tenantId);
  const db = client ?? getPrisma();

  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL search_path TO "${schema}", platform`
    );
    return fn(tx);
  });
}
