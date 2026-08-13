---
packages:
  npm:fumadb: patch
---

## Fix unresolvable peer dependency on npm

`npm install fumadb` failed outright with `ERESOLVE` unless `--legacy-peer-deps` was passed:
fumadb declares an optional peer of `typeorm: ^1`, but depended on `kysely-typeorm@^0.3.0`, whose
own peer is `typeorm: ">= 0.3.0 < 0.4.0"` — the two ranges are mutually unsatisfiable, and no
published version of kysely-typeorm supports TypeORM 1.x.

The TypeORM Kysely dialect is now vendored into the TypeORM adapter (a verbatim port of
kysely-typeorm v0.3.0, MIT, retyped against TypeORM 1.x) and the dependency has been dropped, so
fumadb installs cleanly on npm without any flags.
