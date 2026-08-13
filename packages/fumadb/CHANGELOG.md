## fumadb@0.6.0

### Fix Convex adapter sending SQL table names, and make `upsert()` atomic

The Convex adapter addressed two of its operations by the table's SQL name while the mutation
handler looks tables up by their ORM name. Any table declared with a database name that differs
from its ORM key — `table("db_users", { ... })` — made every `deleteMany()` fail with
`Unknown table: db_users`. `upsert()` had the same defect, but could never surface it: the soft
transaction polyfill defines its own `upsert` and shadowed the adapter's, so Convex upserts always
took the polyfill's `findFirst` + `create`/`updateMany` path.

The adapter's `upsert()` now runs, and runs as a single Convex mutation. Convex executes each
mutation in its own transaction, so the row is looked up and written atomically instead of racing
between two round trips, and `forceReturning()` gets the row back from the same call rather than
issuing a follow-up query. The polyfill is still used inside `transaction()`, where the intermediate
writes have to be recorded so they can be rolled back.

Operations performed outside of `transaction()` no longer record undo entries that nothing could
ever roll back, which previously grew unboundedly for the lifetime of the process.

Convex functions must be pushed again after upgrading: the client now sends an upsert action, which
it never did before.

### Fix Kysely adapter failing to import on Kysely 0.29

Kysely 0.29 moved the migration API out of its root entry, so `DEFAULT_MIGRATION_TABLE` and
`DEFAULT_MIGRATION_LOCK_TABLE` no longer exist there at runtime — only as deprecated type-level
tombstones. Importing `fumadb/adapters/kysely` threw `SyntaxError: The requested module 'kysely'
does not provide an export named 'DEFAULT_MIGRATION_LOCK_TABLE'`. These constants are now imported
from `kysely/migration`.

Under bundlers such as Vite, the missing exports resolved to `undefined` instead of throwing. That
made the CockroachDB introspector filter on `relname != NULL`, which matches no rows — so
introspection reported every database as empty, and `from-database` migration generation emitted
`CREATE TABLE` for tables that already existed instead of altering them.

### Fix unresolvable peer dependency on npm

`npm install fumadb` failed outright with `ERESOLVE` unless `--legacy-peer-deps` was passed:
fumadb declares an optional peer of `typeorm: ^1`, but depended on `kysely-typeorm@^0.3.0`, whose
own peer is `typeorm: ">= 0.3.0 < 0.4.0"` — the two ranges are mutually unsatisfiable, and no
published version of kysely-typeorm supports TypeORM 1.x.

The TypeORM Kysely dialect is now vendored into the TypeORM adapter (a verbatim port of
kysely-typeorm v0.3.0, MIT, retyped against TypeORM 1.x) and the dependency has been dropped, so
fumadb installs cleanly on npm without any flags.

### Add `forceReturning()` to `upsert()`

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

## fumadb@0.5.1

### Update legacy usages of Kysely Introspector API

# fumadb

## 0.5.0

### Minor Changes

- 394ac42: Support Drizzle ORM v1, including MSSQL.

## 0.4.0

### Minor Changes

- 8c6d331: Update TypeORM optional peer dep to 1.0.0

### Patch Changes

- 8c6d331: Improve performance for migration engine

## 0.3.0

### Minor Changes

- d87478f: Support Prisma 7

## 0.2.2

### Patch Changes

- a262b62: fix: properly serialize JSON fields on insert

## 0.2.1

### Patch Changes

- bbd0ac4: fix: prismaAdapter to handle unique constraint violations gracefully

## 0.2.0

### Minor Changes

- 03ec630: feat: supports uuid column

## 0.1.2

### Patch Changes

- 51bd4a2: adapter expose name field

## 0.1.1

### Patch Changes

- f35742b: Simplify semver imports

## 0.1.0

### Minor Changes

- 155c48b: [breaking] Change syntax for column builder to simplify types

  ```ts
  import { table, column, idColumn } from "fumadb/schema";

  const users = table("users", {
    // `defaultTo# fumadb for generated default value
    id: idColumn("id", "varchar(255)").defaultTo$("auto"),
    timestamp: column("timestamp", "date").defaultTo$("now"),
    name: column("name", "string").defaultTo$(() => myFn()),

    // or database-level default value
    image: column("image", "string").defaultTo("haha"),

    // nullable
    email: column("email", "string").nullable(),
  });
  ```

### Patch Changes

- a681f98: Support composite unique constraints
- d8acc31: Improve `from-database` migration to introspect varchar length

## 0.0.9

### Patch Changes

- a1dc58c: disallow disabling tables to avoid breaking relations
- 94a6168: Support internal version control on all adapters
- 009d838: Support backward compatible `orm()` API, deprecate `abstract`
- 65d9e96: Migrate SQLite specific transformations to dedicated transformer
- a0b2a88: Default to drop unused tables to avoid conflicts with custom `up`/`down`
- 8525880: Support name variants migration on consumer-side without history.
- 6158b45: Fix condition builder types
- 65d9e96: Support migration transformer API

## 0.0.8

### Patch Changes

- e681b1a: Fix default value auto migration
- 5c702a1: [breaking] Require string table name instead of table object in relation builder
- 41336be: Improve CLI experience
- b217b3c: Introduce schema variants

## 0.0.7

### Patch Changes

- 691e0f9: Remove parameters from output migration SQL
- 849273e: MongoDB [breaking]: Use the missing field instead of using NULL
- 849273e: Drop SQL only `<>` operator
- 51f6494: Implement MongoDB migration engine
- 142cb38: Support `createAdapter()` API
- 51f6494: Make `createMigrator` sync

## 0.0.6

### Patch Changes

- a19ff3c: [Breaking] Remove abstract table/column API, use string instead
- 736c28c: Breaking: Redesign API to support adapters with `fumadb().client()` function, drop the old `configure()`
- aaf30ae: Support name variants API
- 5e675ee: Implement application-level foreign key layer for MongoDB

## 0.0.5

### Patch Changes

- cfbe836: Implement soft transaction + return ids on `createMany`
- 9c86db9: support duplicated null values for MongoDB
- 9c86db9: Support relation disambiguation

## 0.0.4

### Patch Changes

- 3eadb6d: Implement Binary type
- 115fe92: Use new migration strategy that compares with schema

## 0.0.3

### Patch Changes

- 537670c: reduce unnecessary size

## 0.0.2

### Patch Changes

- ca9bb6f: fix release

## 0.0.1

### Patch Changes

- 2f492a9: Initial release (Not ready for production use yet).
