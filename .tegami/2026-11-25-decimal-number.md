---
packages:
  npm:fumadb: patch
---

## Decimal Columns

- `decimal` columns are returned as numbers on every adapter. Kysely and Drizzle returned strings on PostgreSQL, CockroachDB, MySQL and MSSQL, and Prisma returned `Decimal` objects.
