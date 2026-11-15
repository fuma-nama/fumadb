---
packages:
  npm:fumadb: patch
---

## Literal Matching in String Operators

- On the Kysely and Drizzle adapters, `contains`, `starts with`, `ends with` and their `not` variants match `%` and `_` as literal characters instead of wildcards.
- On the MongoDB adapter, the same operators match regular expression characters like `.` and `[` as literal characters.
- Fix `b.not()` on the Prisma and MongoDB adapters.
