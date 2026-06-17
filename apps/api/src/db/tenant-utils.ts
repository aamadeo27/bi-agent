const TENANT_ID_RE = /^[a-zA-Z0-9]+$/;

export function validateTenantId(tenantId: string): void {
  if (!TENANT_ID_RE.test(tenantId)) {
    throw new Error(
      `Invalid tenantId: must be alphanumeric, got "${tenantId}"`
    );
  }
}

export function tenantSchema(tenantId: string): string {
  return `tenant_${tenantId.toLowerCase()}`;
}
