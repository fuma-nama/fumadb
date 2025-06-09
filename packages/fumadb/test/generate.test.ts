import {
  Provider,
  generateSchema,
  GenerateConfig,
  Schema,
  table,
} from "../src/schema";
import { expect, test } from "vitest";

const config: GenerateConfig[] = [
  { type: "prisma", provider: "postgresql" },
  { type: "prisma", provider: "sqlite" },
  { type: "prisma", provider: "mongodb" },
];

const createSchema = (provider: Provider) => {
  const users = table("users", {
    id:
      provider === "mongodb"
        ? {
            name: "_id",
            type: "string",
            default: "mongodb_auto",
            primarykey: true,
          }
        : {
            name: "id",
            type: "integer",
            default: "autoincrement",
            primarykey: true,
          },
    name: {
      name: "name",
      type: "varchar(255)",
    },
    email: {
      name: "email",
      type: "varchar(255)",
    },
    image: {
      name: "image",
      type: "varchar(200)",
      nullable: true,
      default: {
        value: "my-avatar",
      },
    },
  });

  const accounts = table("accounts", {
    id: {
      name: provider === "mongodb" ? "_id" : "id",
      type: "varchar(255)",
      primarykey: true,
    },
  });

  return {
    version: "1.0.0",
    tables: {
      users,
      accounts,
    },
  } satisfies Schema;
};

for (const item of config) {
  test(`generate schema: ${item.type}`, async () => {
    let generated = generateSchema(createSchema(item.provider), item);
    let file = `snapshots/generate/${item.type}`;
    if (item.type === "prisma") {
      file += "." + item.provider + "/schema.prisma";
      generated += `\ndatasource db {
  provider = "${item.provider}"
  url      = env("DATABASE_URL")
}`;
    }

    await expect(generated).toMatchFileSnapshot(file);
  });
}
