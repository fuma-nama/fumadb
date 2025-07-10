import {
  generateSchema,
  GenerateConfig,
  Schema,
  table,
  column,
  idColumn,
  schema,
} from "../src/schema";
import { expect, test } from "vitest";

const config: GenerateConfig[] = [
  { type: "prisma", provider: "postgresql" },
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
];

const createSchema = () => {
  const users = table("users", {
    id: idColumn("id", "varchar(255)", {
      default: "auto",
    }),
    name: column("name", "varchar(255)"),
    email: column("email", "varchar(255)"),
    image: column("image", "varchar(200)", {
      nullable: true,
      default: { value: "my-avatar" },
    }),
  });

  const accounts = table("accounts", {
    id: idColumn("id", "varchar(255)"),
  });

  const posts = table("posts", {
    id: idColumn("id", "varchar(255)", { default: "auto" }),
    authorId: column("author_id", "varchar(255)"),
    content: column("content", "string"),
    image: column("image", "binary", {
      nullable: true,
    }),
  });

  return schema({
    version: "1.0.0",
    tables: {
      users,
      accounts,
      posts,
    },
    relations: {
      users: ({ one, many }) => ({
        account: one(accounts, ["id", "id"]).foreignKey(),
        posts: many(posts),
      }),
      accounts: ({ one }) => ({
        user: one(users),
      }),
      posts: ({ one }) => ({
        author: one(users, ["authorId", "id"]).foreignKey(),
      }),
    },
  });
};

for (const item of config) {
  test(`generate schema: ${item.type}`, async () => {
    let generated = generateSchema(createSchema(), item);
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
