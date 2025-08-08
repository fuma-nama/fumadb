# fumadb

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
