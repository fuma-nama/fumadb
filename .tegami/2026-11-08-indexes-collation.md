---
packages:
  npm:fumadb: minor
---

## Non-unique indexes, index prefix lengths and column collation

- `table.index(name, columns)` declares a non-unique index. It is created by the migrator, kept when SQLite recreates a table, and generated for Drizzle and Prisma.
- `unique()` and `index()` accept `{ length: { column: 512 } }` for MySQL index prefix lengths.
- `column.collate({ mysql: "utf8mb4_bin" })` sets the column collation per database. Prisma has no collation attribute, so Prisma schemas ignore it.
