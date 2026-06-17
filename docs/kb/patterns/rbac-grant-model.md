## rbac-grant-model

- Permissions are **additive grants** of read access at schema / table / column.
- A table grant implies all its columns unless specific columns are individually
  un-granted (tri-state UI in S5 maps to an explicit column grant set).
- The effective grant set for a request = the user's single role's grants.
- Capability flags (e.g. `canInspectQuery`) are role-level booleans, separate from
  resource grants.
