---
packages:
  npm:fumadb: patch
---

## Fix Convex adapter sending SQL table names, and make `upsert()` atomic

The Convex adapter addressed two of its operations by the table's SQL name while the mutation
handler looks tables up by their ORM name. Any table declared with a database name that differs
from its ORM key — `table("db_users", { ... })` — made every `deleteMany()` fail with
`Unknown table: db_users`. `upsert()` had the same defect, but could never surface it: the soft
transaction polyfill defines its own `upsert` and shadowed the adapter's, so Convex upserts always
took the polyfill's `findFirst` + `create`/`updateMany` path.

The adapter's `upsert()` now runs, and runs as a single Convex mutation. Convex executes each
mutation in its own transaction, so the row is looked up and written atomically instead of racing
between two round trips, and `forceReturning()` gets the row back from the same call rather than
issuing a follow-up query. The polyfill is still used inside `transaction()`, where the intermediate
writes have to be recorded so they can be rolled back.

Operations performed outside of `transaction()` no longer record undo entries that nothing could
ever roll back, which previously grew unboundedly for the lifetime of the process.

Convex functions must be pushed again after upgrading: the client now sends an upsert action, which
it never did before.
