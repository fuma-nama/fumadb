---
packages:
  npm:fumadb: minor
---

## Add `forceReturning()` to `upsert()`

`orm.upsert()` now returns a query that can produce the created/updated row:

```ts
const user = await orm
  .upsert("users", {
    where: (b) => b("id", "=", "bob"),
    create: { id: "bob", name: "Bob" },
    update: { name: "Bob" },
  })
  .forceReturning();
```

Databases with a returning clause (PostgreSQL, CockroachDB, SQLite and MS SQL Server on Kysely/Drizzle,
and every provider on Prisma) obtain the row from the write itself, saving a round trip. The others run
one extra query, so the method is available regardless of the database being used.

Awaiting `upsert()` without `forceReturning()` behaves as before and still returns `void`, but note the
query is now lazy: it is executed when the returned value is awaited.
