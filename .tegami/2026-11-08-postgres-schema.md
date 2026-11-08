---
packages:
  npm:fumadb: patch
---

## PostgreSQL Schema

- Place tables in a PostgreSQL schema by setting their SQL name to `schema.table`, or with `names.schema()` for all tables.
- The migrator creates the schema and moves existing tables into it. Generated Drizzle, Prisma and TypeORM schemas declare it.
- `from-database` migrations on PostgreSQL only introspect the current schema and the schemas of your tables.
