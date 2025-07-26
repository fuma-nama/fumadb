# fumadb

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
