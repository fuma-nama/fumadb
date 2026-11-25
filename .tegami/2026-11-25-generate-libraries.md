---
packages:
  npm:fumadb: minor
---

## Generate Several Libraries

- `generateSchema()` from `fumadb` generates the Prisma, Drizzle or TypeORM schema of several libraries into one file: `generateSchema([chatClient, authClient])`.
- Shared code like `pgSchema()` and Drizzle `relations` is declared once, so libraries in the same PostgreSQL schema work with drizzle-kit.
- The `generateSchema` of a custom adapter receives the list of libraries to generate.
