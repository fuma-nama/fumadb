---
packages:
  npm:fumadb: patch
---

## Chaining Name Variants

- `names.schema()` and `names.prefix()` keep the names set by an earlier `names()` call. `names.schema()` used to reset the Drizzle and Prisma names of tables.
- Generated TypeORM relations refer to the entity class of the related table when its SQL name is overridden.
