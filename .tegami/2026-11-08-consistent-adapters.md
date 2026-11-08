---
packages:
  npm:fumadb: minor
---

## Consistent migrations and generated schemas across adapters

- `migrateTo()` and `migrateToLatest()` run the custom `up` (or `down`) of every schema between the current and target version, including the first schema on a fresh database.
- The settings table has the same `key`/`value` shape on Kysely, Drizzle and Prisma. Drizzle and Prisma read the version from the default value of `value` in the generated schema.
- Generated Drizzle schemas no longer import `fumadb/cuid`. The Drizzle adapter generates runtime default values like other adapters.
- Generated Drizzle schemas declare `bigint` columns with `{ mode: "bigint" }` on PostgreSQL and MySQL.
- SQLite stores `bigint` as `integer`, `json` as `text` and `timestamp` as epoch milliseconds on every adapter. The `now` default writes epoch milliseconds too. Existing `blob` bigints and `CURRENT_TIMESTAMP` strings are still readable.
- MySQL uses `datetime(3)` for `timestamp` on Kysely and Drizzle, and Prisma uses `@db.Text` for `string`.
- Generated Prisma and Drizzle schemas keep the names of unique constraints.
- `bigint` columns are read as `bigint` on every database.
- Fixed Drizzle `findMany()` and `findFirst()` without `where` on drizzle-orm 1.x.
