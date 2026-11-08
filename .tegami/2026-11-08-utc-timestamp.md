---
packages:
  npm:fumadb: patch
---

## UTC Timestamps on Kysely

- On PostgreSQL and MySQL, the Kysely adapter stores and reads `timestamp` columns in UTC, the same as Drizzle and Prisma, whatever the time zone of the process is.
- Rows written by earlier versions in a process outside UTC keep their local time.
