---
packages:
  npm:fumadb: patch
---

## Atomic Increment

- `increment(step)` from `fumadb/query` updates an `integer`, `bigint` or `decimal` column relative to its current value, in `updateMany` and in the `update` of `upsert`: `set: { viewCount: increment(1) }`.
- It runs in the same statement, so concurrent increments are never lost. A negative step decrements, and a null stays null.
- On Prisma, `updateMany` maps column names to Prisma field names, like the other queries.
