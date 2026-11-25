---
packages:
  npm:fumadb: patch
---

## Consistent Numbers & Nested Transactions

- Kysely returns `integer` columns as numbers on CockroachDB, and MongoDB returns `bigint` columns as `bigint`.
- A `transaction()` called inside a transaction joins it, on every adapter. MSSQL used to throw when an `updateMany` on a referenced table ran in a transaction.
