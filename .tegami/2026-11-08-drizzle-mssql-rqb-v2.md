---
packages:
  npm:fumadb: patch
---

## Support drizzle-orm 1.0.0-rc.5 on MSSQL

- The Drizzle adapter detects relations v2 (`defineRelations()`) from the drizzle instance, so MSSQL works with `drizzle({ connection, relations })` on drizzle-orm 1.0.0-rc.5.
- MSSQL instances on earlier 1.x releases keep using relations v1.
