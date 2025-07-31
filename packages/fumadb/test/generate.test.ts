import { table, column, idColumn, schema, type AnySchema } from "../src/schema";
import { expect, test } from "vitest";
import * as Prisma from "../src/adapters/prisma/generate";
import * as Drizzle from "../src/adapters/drizzle/generate";
import * as TypeORM from "../src/adapters/typeorm/generate";

const tests = [
  { type: "prisma", provider: "postgresql" },
  { type: "prisma", provider: "cockroachdb" },
  { type: "prisma", provider: "sqlite" },
  { type: "prisma", provider: "mongodb" },
  {
    type: "drizzle-orm",
    provider: "postgresql",
  },
  {
    type: "drizzle-orm",
    provider: "mysql",
  },
  {
    type: "drizzle-orm",
    provider: "sqlite",
  },
  {
    type: "typeorm",
    provider: "postgresql",
  },
] as const;

const testSchema = schema({
  version: "1.0.0",
  tables: {
    users: table("users", {
      id: idColumn("id", "varchar(255)", {
        default: "auto",
      }),
      name: column("name", "varchar(255)"),
      email: column("email", "varchar(255)"),
      image: column("image", "varchar(200)", {
        nullable: true,
        default: { value: "my-avatar" },
      }),
    }),
    accounts: table("accounts", {
      id: idColumn("id", "varchar(255)"),
    }),
    posts: table("posts", {
      id: idColumn("id", "varchar(255)", { default: "auto" }),
      authorId: column("author_id", "varchar(255)"),
      content: column("content", "string"),
      image: column("image", "binary", {
        nullable: true,
      }),
    }),
  },
  relations: {
    users: ({ one, many }) => ({
      account: one("accounts", ["id", "id"]).foreignKey(),
      posts: many("posts"),
    }),
    accounts: ({ one }) => ({
      user: one("users"),
    }),
    posts: ({ one }) => ({
      author: one("users", ["authorId", "id"]).foreignKey(),
    }),
  },
});

function generateSchema(
  schema: AnySchema,
  config: (typeof tests)[number]
): string {
  if (config.type === "prisma") {
    return Prisma.generateSchema(schema, config.provider);
  }

  if (config.type === "drizzle-orm") {
    return Drizzle.generateSchema(schema, config.provider);
  }

  if (config.type === "typeorm") {
    return TypeORM.generateSchema(schema, config.provider);
  }

  throw new Error(`Unsupported ORM: ${(config as any).type}`);
}

for (const item of tests) {
  test(`generate schema: ${item.type}`, async () => {
    let generated = generateSchema(testSchema, item);
    let file: string;

    if (item.type === "prisma") {
      file = `snapshots/generate/${item.type}.${item.provider}/schema.prisma`;
      generated += `\ndatasource db {
  provider = "${item.provider}"
  url      = env("DATABASE_URL")
}`;
    } else {
      file = `snapshots/generate/${item.type}.${item.provider}.ts`;
    }

    await expect(generated).toMatchFileSnapshot(file);
  });
}
