---
packages:
  npm:fumadb: patch
---

## Unique Constraint Errors

- `create`, `createMany`, `updateMany` and `upsert` throw a `UniqueConstraintError` (exported from `fumadb`) when a write violates a unique constraint or the primary key, on every adapter.
- `constraint` is the name of the violated unique constraint in the schema.
- The error from the database driver is now `cause`, so check driver error codes on `cause` instead of the thrown error.
