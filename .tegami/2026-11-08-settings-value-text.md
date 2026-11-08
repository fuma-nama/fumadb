---
packages:
  npm:fumadb: patch
---

## Settings Table on Drizzle & Prisma

- The `value` column of the settings table is `text` in generated Drizzle and Prisma schemas, the same as the Kysely migrator.
- Generated Prisma schemas for MySQL use the expression form for defaults of `string` columns, which MySQL requires for `text` columns.
