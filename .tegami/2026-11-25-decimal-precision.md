---
packages:
  npm:fumadb: minor
---

## Decimal Precision

- `decimal(p, s)` sets the precision and scale of a decimal column, e.g. `column("price", "decimal(10, 2)")`. Changing it in a new schema version migrates the column.
- A plain `decimal` is `decimal(38, 16)` on every SQL database. MySQL and MSSQL used to create `decimal(10, 0)` and `decimal(18, 0)`, which dropped the fractional part.
- Generated Drizzle, Prisma and TypeORM schemas use the same precision. TypeORM used to create an integer column, and Prisma on MongoDB now uses `Float`.
- On MySQL and MSSQL, the next migration in `from-database` mode alters existing `decimal` columns to `decimal(38, 16)`. With `from-schema`, they keep their type until you alter them.
