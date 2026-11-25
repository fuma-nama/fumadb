---
packages:
  npm:fumadb: minor
---

## Aggregation

- `aggregate()` counts rows and computes the `sum`, `avg`, `min` and `max` of columns in the database, on every adapter.
- `groupBy` aggregates each group of rows, a null is a group of its own.
- Nulls are skipped. When a column has no value, its `sum` is `0` and the other aggregates are `null`.
- Custom `ORMAdapter` implementations must implement `aggregate`.
