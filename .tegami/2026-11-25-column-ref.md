---
packages:
  npm:fumadb: patch
---

## Compare Columns

- `b.ref()` references another column of the same table, as the right-hand side of `=`, `!=`, `>`, `>=`, `<` and `<=`: `b("downloadCount", "<", b.ref("maxDownloads"))`.
- Both columns must have the same value type. A null on either side never matches, on every adapter.
- The Prisma adapter uses Prisma field references, MongoDB uses `$expr`.
