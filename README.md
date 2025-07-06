> WIP

## FumaDB

A library for library to interact with databases.

### Why?

Full-stack web frameworks are getting more popular and there's a need for some libraries to interact with your database, such as Auth libraries BetterAuth/NextAuth, or my self-hostable comment service Fuma Comment.

There's a few problems with this:

- You cannot always trust the library to interact with your database, there could be bugs that introduces vulnerability to your database.
- Versioning database schemas is difficult, some changes may require shutting down the server, and the library author doesn't know if they should be marked as breaking changes.
- You might be using different ORMs and their built-in migration pipeline, the library needs to be integrated well into your system.
- Each ORM & database have many inconsistencies, library authors often need to skim through many docs and write code carefully, making sure the library works for all ORMs and databases.

FumaDB aims to solve them by:

- **Unified Querying Interface** for library author to query your database, it's Prisma-like and supports relations.
- **Unified Schema** for library author to design database schemas, without worrying the underlying ORM consumer uses.
- **Built-in SQL Migrator** for users without an existing migration pipeline or ORM, it's built on Kysely but only support widely-supported operations. (SQLite has many limitations for alter columns)

### Usage

FumaDB expects a schema for each version, create a `schemas/v1.ts` file:

```ts
import { column, idColumn, schema, table } from "fumadb/schema";

const users = table("users", {
  id: idColumn("id", "varchar(255)", { default: "auto" }),
  name: column("name", "string"),
});

const messages = table("messages", {
  id: idColumn("id", "varchar(255)", { default: "auto" }),
  user: column("user", "varchar(255)"),
  content: column("content", "string"),
});

export const v1 = schema({
  version: "1.0.0",
  tables: {
    users,
    messages,
  },
  relations: {
    users: ({ many }) => ({
      messages: many(messages),
    }),
    messages: ({ one }) => ({
      author: one(users, ["user", "id"]).foreignKey(),
    }),
  },
});
```

Create a `db.ts` file:

```ts
import { fumadb } from "fumadb";
import { v1 } from "@/schemas/v1";

const chatDb = fumadb({
  namespace: "fuma-chat",
  schemas: [v1],
});
```

Please be careful that:

- `namespace` must not be changed.
- Do not change your schema once your package is published. Instead, create a new schema with a newer version (such as `1.0.0` to `1.1.0`) and add it to `schemas`.

The consumer should call the `configure()` function:

```ts
export const configuredChatDb = chatDb.configure({
  provider: "mysql",
  type: "kysely",
  db: // kysely instance
});
```

Your library can receive the configured database instance and perform further actions:

```ts
myLibrary(configuredChatDb);
```
