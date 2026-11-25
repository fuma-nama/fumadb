---
packages:
  npm:fumadb: minor
---

## Aggregation

- `aggregate()` counts rows and computes the `sum`, `avg`, `min` and `max` of columns in the database, on every adapter.
- `groupBy` aggregates each group of rows, a null is a group of its own.
- `orderBy`, `limit` and `offset` sort and page the groups, e.g. `orderBy: ["sum.size", "desc"]`.
- Nulls are skipped. When a column has no value, like SQL, its aggregates are `null`.
- Custom `ORMAdapter` implementations must implement `aggregate`.
