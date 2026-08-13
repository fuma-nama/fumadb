---
packages:
  npm:fumadb: patch
---

## Fix Kysely adapter failing to import on Kysely 0.29

Kysely 0.29 moved the migration API out of its root entry, so `DEFAULT_MIGRATION_TABLE` and
`DEFAULT_MIGRATION_LOCK_TABLE` no longer exist there at runtime — only as deprecated type-level
tombstones. Importing `fumadb/adapters/kysely` threw `SyntaxError: The requested module 'kysely'
does not provide an export named 'DEFAULT_MIGRATION_LOCK_TABLE'`. These constants are now imported
from `kysely/migration`.

Under bundlers such as Vite, the missing exports resolved to `undefined` instead of throwing. That
made the CockroachDB introspector filter on `relname != NULL`, which matches no rows — so
introspection reported every database as empty, and `from-database` migration generation emitted
`CREATE TABLE` for tables that already existed instead of altering them.
