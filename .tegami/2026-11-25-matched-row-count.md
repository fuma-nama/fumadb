---
packages:
  npm:fumadb: minor
---

## Matched Row Count

- `updateMany` and `deleteMany` resolve to `{ count }`, the number of rows matched by `where`, on every adapter.
- `updateMany` counts the rows it matched, also when the new values equal the current ones.
- Rows changed by cascading foreign keys are not counted.
- Custom `ORMAdapter` implementations must return `{ count }` from `updateMany` and `deleteMany`.
