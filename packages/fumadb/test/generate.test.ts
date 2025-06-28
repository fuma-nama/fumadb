import { generateSchema, GenerateConfig, Schema, table } from "../src/schema";
import { expect, test } from "vitest";
import { Provider } from "../src/shared/providers";

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
    id: {
      name: "id",
      type: "varchar(255)",
      default: "auto",
      id: true,
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
      name: "id",
      type: "varchar(255)",
      id: true,
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
