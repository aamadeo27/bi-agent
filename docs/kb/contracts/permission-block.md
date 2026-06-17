## permission-block

Returned on `event: block` when the gate denies (GAP-12 block+explain). No data.
```ts
interface PermissionBlock {
  messageId: string;
  roleName: string;
  missing: Array<{
    kind: "schema" | "table" | "column";
    identifier: string;        // "sales.orders" or "sales.orders.revenue"
    accessNeeded: "read";      // only read in v1
  }>;
}
```
