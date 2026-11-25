import { expect, test } from "vitest";
import { fumadb, generateSchema as generateLibraries } from "../src";
import type { FumaDBAdapter } from "../src/adapters";
import { drizzleAdapter } from "../src/adapters/drizzle";
import { prismaAdapter } from "../src/adapters/prisma";
import { typeormAdapter } from "../src/adapters/typeorm";
import * as Drizzle from "../src/adapters/drizzle/generate";
import * as Prisma from "../src/adapters/prisma/generate";
import * as TypeORM from "../src/adapters/typeorm/generate";
import { type AnySchema, column, idColumn, schema, table } from "../src/schema";

const tests = [
  { type: "prisma", provider: "postgresql" },
  { type: "prisma", provider: "cockroachdb" },
  { type: "prisma", provider: "sqlite" },
  { type: "prisma", provider: "mongodb" },
  { type: "prisma", provider: "mysql" },
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
    // drizzle-orm MSSQL before 1.0.0-rc.5
    type: "drizzle-orm",
    provider: "mssql",
  },
  {
    type: "drizzle-orm-v2",
    provider: "mssql",
  },
  {
    type: "drizzle-orm-v2",
    provider: "postgresql",
  },
  {
    type: "drizzle-orm-v2",
    provider: "mysql",
  },
  {
    type: "drizzle-orm-v2",
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
      id: idColumn("id", "varchar(255)").defaultTo$("auto"),
      name: column("name", "varchar(255)"),
      email: column("email", "varchar(255)"),
      image: column("image", "varchar(200)").nullable().defaultTo("my-avatar"),
    }),
    accounts: table("accounts", {
      id: idColumn("id", "varchar(255)"),
    }),
    posts: table("posts", {
      id: idColumn("id", "varchar(255)").defaultTo$("auto"),
      authorId: column("author_id", "varchar(255)"),
      content: column("content", "string"),
      image: column("image", "binary").nullable(),
    }),
    files: table("files", {
      id: idColumn("id", "varchar(255)").defaultTo$("auto"),
      bucket: column("bucket", "varchar(255)"),
      key: column("key", "varchar(1024)").collate({ mysql: "utf8mb4_bin" }),
      name: column("name", "string"),
      size: column("size", "bigint"),
      metadata: column("metadata", "json").nullable(),
      checksum: column("checksum", "varchar(255)").unique(),
      createdAt: column("created_at", "timestamp").defaultTo$("now"),
    })
      .unique("files_bucket_key_uk", ["bucket", "key"], { length: { key: 512 } })
      .index("files_bucket_created_idx", ["bucket", "createdAt"])
      .index("files_name_idx", ["name"], { length: { name: 255 } }),
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

function generateSchema(schema: AnySchema, config: (typeof tests)[number]): string {
  if (config.type === "prisma") {
    return Prisma.generateSchema(schema, config.provider);
  }

  if (config.type === "drizzle-orm") {
    return Drizzle.generateSchema(schema, config.provider, 1);
  }

  if (config.type === "drizzle-orm-v2") {
    return Drizzle.generateSchema(schema, config.provider, 2);
  }

  if (config.type === "typeorm") {
    return TypeORM.generateSchema(schema, config.provider);
  }

  throw new Error(`Unsupported ORM: ${(config as any).type}`);
}

// UUID test schema
const uuidSchema = schema({
  version: "1.0.0",
  tables: {
    users: table("users", {
      id: idColumn("id", "uuid"),
      email: column("email", "varchar(255)"),
      sessionToken: column("session_token", "uuid").nullable(),
    }),
  },
});

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

  test(`generate schema with UUID: ${item.type} (${item.provider})`, async () => {
    let generated = generateSchema(uuidSchema, item);
    let file: string;

    if (item.type === "prisma") {
      file = `snapshots/generate-uuid/${item.type}.${item.provider}/schema.prisma`;
      generated += `\ndatasource db {
  provider = "${item.provider}"
  url      = env("DATABASE_URL")
}`;
    } else {
      file = `snapshots/generate-uuid/${item.type}.${item.provider}.ts`;
    }

    await expect(generated).toMatchFileSnapshot(file);
  });
}

// the Kysely migrator stores the name variants of every table and column in `value`, it must be `text`
test("settings value is text on Drizzle & Prisma", () => {
  const lib = fumadb({ namespace: "test", schemas: [schema({ version: "1.0.0", tables: {} })] });
  const valueColumn = (adapter: FumaDBAdapter) =>
    lib
      .client(adapter)
      .generateSchema("1.0.0")
      .code.split("\n")
      .find((line) => line.includes("value"));

  expect(valueColumn(drizzleAdapter({ db: undefined, provider: "mysql" }))).toMatchInlineSnapshot(
    `"  version: text("value").notNull().default("1.0.0")"`,
  );
  expect(valueColumn(prismaAdapter({ prisma: {}, provider: "mysql" }))).toMatchInlineSnapshot(
    `"  value String @db.Text @default(dbgenerated("('1.0.0')"))"`,
  );
  expect(valueColumn(prismaAdapter({ prisma: {}, provider: "postgresql" }))).toMatchInlineSnapshot(
    `"  value String @default("1.0.0")"`,
  );
});

const allTypesSchema = schema({
  version: "1.0.0",
  tables: {
    items: table("items", {
      id: idColumn("id", "varchar(255)"),
      string: column("string", "string"),
      bigint: column("bigint", "bigint"),
      integer: column("integer", "integer"),
      decimal: column("decimal", "decimal"),
      bool: column("bool", "bool"),
      json: column("json", "json"),
      binary: column("binary", "binary"),
      date: column("date", "date"),
      timestamp: column("timestamp", "timestamp"),
      uuid: column("uuid", "uuid"),
    }),
  },
});

// a column type the dialect doesn't export only fails when the generated schema is imported
test.each(["postgresql", "mysql", "sqlite", "mssql"] as const)(
  "generated Drizzle schema only imports column types of its dialect (%s)",
  async (provider) => {
    const source = `drizzle-orm/${provider === "postgresql" ? "pg" : provider}-core`;
    const code = Drizzle.generateSchema(allTypesSchema, provider, 2);
    const imported = code
      .match(new RegExp(`import \\{ (.+) \\} from "${source}"`))?.[1]
      .split(", ");
    const dialect: Record<string, unknown> = await import(source);

    expect(imported).toBeDefined();
    for (const name of imported!) {
      expect(typeof dialect[name], `\`${name}\` from ${source}`).toBe("function");
    }
  },
);

// two libraries in the same PostgreSQL schema
const storageLibrary = (namespace: string, tableName: string) =>
  fumadb({
    namespace,
    schemas: [
      schema({
        version: "1.0.0",
        tables: {
          item: table(tableName, {
            id: idColumn("id", "varchar(255)"),
            name: column("name", "varchar(255)"),
          }),
        },
      }),
    ],
  })
    .names({ item: { drizzle: tableName, prisma: tableName } })
    .names.schema("storage");

test("generate several libraries into one Drizzle schema", () => {
  const adapter = drizzleAdapter({ db: undefined, provider: "postgresql" });
  const { code, path } = generateLibraries([
    storageLibrary("files", "file").client(adapter),
    storageLibrary("links", "link").client(adapter),
  ]);

  expect(path).toBe("./db/fumadb.ts");
  // drizzle-kit refuses a schema declared twice
  expect(code.match(/pgSchema\("storage"\)/g)).toHaveLength(1);
  expect(code).toContain("export const file = storageSchema.table(");
  expect(code).toContain("export const link = storageSchema.table(");
  expect(code).toContain('export const private_files_settings = pgTable("private_files_settings"');
  expect(code).toContain('export const private_links_settings = pgTable("private_links_settings"');
});

test("generate several libraries into one Prisma & TypeORM schema", () => {
  const prisma = prismaAdapter({ prisma: {}, provider: "postgresql" });
  const prismaCode = generateLibraries([
    storageLibrary("files", "file").client(prisma),
    storageLibrary("links", "link").client(prisma),
  ]).code;

  for (const model of ["file", "link", "private_files_settings", "private_links_settings"]) {
    expect(prismaCode).toContain(`model ${model} {`);
  }

  const typeorm = typeormAdapter({
    source: { options: { type: "postgres" } } as never,
    provider: "postgresql",
  });
  const typeormCode = generateLibraries([
    storageLibrary("files", "file").client(typeorm),
    storageLibrary("links", "link").client(typeorm),
  ]).code;

  expect(typeormCode.match(/import /g)).toHaveLength(1);
  expect(typeormCode).toContain("export class File {");
  expect(typeormCode).toContain("export class Link {");
});

test("generate several libraries: names must be unique", () => {
  const adapter = drizzleAdapter({ db: undefined, provider: "postgresql" });

  expect(() =>
    generateLibraries([
      storageLibrary("files", "item").client(adapter),
      storageLibrary("links", "item").client(adapter),
    ]),
  ).toThrowError("is defined by more than one library");
  expect(() =>
    generateLibraries([
      storageLibrary("files", "file").client(adapter),
      storageLibrary("links", "link").client(prismaAdapter({ prisma: {}, provider: "postgresql" })),
    ]),
  ).toThrowError("must use the same adapter");
});
