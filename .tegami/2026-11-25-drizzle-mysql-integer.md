---
packages:
  npm:fumadb: patch
---

## Integer Columns on Drizzle MySQL

- Generated Drizzle schemas for MySQL declare `integer` columns with `int()`. They used to call `integer()`, which `drizzle-orm/mysql-core` doesn't export, so importing the schema failed.
