import { afterAll, afterEach, expect, test, vi } from "vitest";
import { column, idColumn, schema, table } from "../src/schema";
import { kyselyTests, mongodb, drizzleTests, sqlite } from "./shared";
import { fumadb } from "../src";
import fs from "fs";
import path from "path";
import { generateSchema } from "../src/schema/generate";
import { AbstractQuery } from "../src/query";
import { pushSchema, pushMySQLSchema, pushSQLiteSchema } from "drizzle-kit/api";

const users = table("users", {
  id: idColumn("id", "varchar(255)", { default: "auto" }),
  name: column("name", "string"),
});

const messages = table("messages", {
  id: idColumn("id", "varchar(255)", { default: "auto" }),
  user: column("user", "varchar(255)"),
  content: column("content", "string"),
  parent: column("parent", "varchar(255)", { nullable: true }),
});

const v1 = schema({
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
      author: one(users, ["user", "id"]),
    }),
  },
});

const myDB = fumadb({
  namespace: "test",
  schemas: [v1],
});

vi.mock("../src/cuid", () => ({
  createId: vi.fn(() => "generated-cuid"),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  fs.rmSync(sqlite);
});

async function testSqlDatabase(orm: AbstractQuery<typeof v1>) {
  const { messages, users } = orm.tables;
  expect(
    await orm.create(users, {
      name: "fuma",
    })
  ).toMatchInlineSnapshot(`
      {
        "id": "generated-cuid",
        "name": "fuma",
      }
    `);
  await orm.createMany(users, [
    {
      id: "alfon",
      name: "alfon",
    },
  ]);
  expect(
    await orm.findMany(users, {
      select: true,
      orderBy: [[users.name, "asc"]],
    })
  ).toMatchInlineSnapshot(`
      [
        {
          "id": "alfon",
          "name": "alfon",
        },
        {
          "id": "generated-cuid",
          "name": "fuma",
        },
      ]
    `);
  await orm.createMany(messages, [
    {
      user: "alfon",
      content: "Hello World 1 by alfon",
      id: "1",
    },
    {
      user: "alfon",
      content: "Hello World 2 by alfon",
      id: "2",
    },
    {
      user: "bob",
      content: "Sad by bob",
      id: "3",
    },
  ]);
  expect(
    await orm.findMany(users, {
      orderBy: [users.name, "asc"],
      join: (b) => b.messages(),
    })
  ).toMatchInlineSnapshot(`
      [
        {
          "id": "alfon",
          "messages": [
            {
              "content": "Hello World 1 by alfon",
              "id": "1",
              "parent": null,
              "user": "alfon",
            },
            {
              "content": "Hello World 2 by alfon",
              "id": "2",
              "parent": null,
              "user": "alfon",
            },
          ],
          "name": "alfon",
        },
        {
          "id": "generated-cuid",
          "messages": [],
          "name": "fuma",
        },
      ]
    `);
  expect(
    await orm.findMany(users, {
      orderBy: [users.name, "asc"],
      join: (b) =>
        b.messages({
          select: ["content"],
          limit: 1,
          where: (b) => b(messages.content, "contains", "alfon"),
          join: (b) => b.author(),
        }),
    })
  ).toMatchInlineSnapshot(`
      [
        {
          "id": "alfon",
          "messages": [
            {
              "author": {
                "id": "alfon",
                "name": "alfon",
              },
              "content": "Hello World 1 by alfon",
            },
          ],
          "name": "alfon",
        },
        {
          "id": "generated-cuid",
          "messages": [],
          "name": "fuma",
        },
      ]
    `);
}

for (const item of kyselyTests) {
  test(`query ksely (${item.provider})`, async () => {
    const instance = myDB.configure({
      type: "kysely",
      db: item.db,
      provider: item.provider,
    });

    await item.db.schema.dropTable("users").ifExists().execute();
    await item.db.schema.dropTable("messages").ifExists().execute();

    const migrator = await instance.createMigrator();
    await migrator.versionManager.set_sql("0.0.0").execute();
    await migrator.migrateToLatest().then((res) => res.execute());

    const orm = instance.abstract;
    await testSqlDatabase(orm);
  });
}

test("query mongodb", async () => {
  await mongodb.connect();
  const db = mongodb.db("test");
  await db.dropCollection("users");
  await db.dropCollection("messages");
  const instance = myDB.configure({
    type: "mongodb",
    client: db,
  });

  const orm = instance.abstract;
  const { messages, users } = orm.tables;

  await orm.createMany(users, [
    {
      id: "alfon",
      name: "alfon",
    },
    {
      id: "bob",
      name: "Bob",
    },
  ]);

  const result = await orm.create(users, {
    name: "fuma",
  });

  expect(result.id).toBeTypeOf("string");
  expect(result.name).toBe("fuma");

  expect(
    await orm.findFirst(users, {
      select: true,
      where: (b) => b(users.name, "=", "alfon"),
    })
  ).toMatchInlineSnapshot(`
    {
      "id": "alfon",
      "name": "alfon",
    }
  `);

  expect(
    await orm.findMany(users, {
      select: true,
      where: (b) => b(users.name, "!=", "fuma"),
      orderBy: [users.name, "asc"],
    })
  ).toMatchInlineSnapshot(`
    [
      {
        "id": "bob",
        "name": "Bob",
      },
      {
        "id": "alfon",
        "name": "alfon",
      },
    ]
  `);

  await orm.deleteMany(users, {
    where: (b) => b(users.name, "=", "fuma"),
  });
  await orm.createMany(messages, [
    {
      user: "alfon",
      content: "Hello World 1 by alfon",
      id: "1",
    },
    {
      user: "alfon",
      content: "Hello World 2 by alfon",
      id: "2",
    },
    {
      user: "bob",
      content: "Sad by bob",
      id: "3",
    },
  ]);

  expect(
    await orm.findMany(users, {
      join: (b) => b.messages(),
    })
  ).toMatchInlineSnapshot(`
    [
      {
        "id": "alfon",
        "messages": [
          {
            "content": "Hello World 1 by alfon",
            "id": "1",
            "user": "alfon",
          },
          {
            "content": "Hello World 2 by alfon",
            "id": "2",
            "user": "alfon",
          },
        ],
        "name": "alfon",
      },
      {
        "id": "bob",
        "messages": [
          {
            "content": "Sad by bob",
            "id": "3",
            "user": "bob",
          },
        ],
        "name": "Bob",
      },
    ]
  `);

  expect(
    await orm.findMany(users, {
      join: (b) =>
        b.messages({
          select: ["content"],
          limit: 1,
          where: (b) => b(messages.content, "contains", "alfon"),
          join: (b) =>
            b.author({
              select: ["name"],
            }),
        }),
    })
  ).toMatchInlineSnapshot(`
    [
      {
        "id": "alfon",
        "messages": [
          {
            "author": {
              "name": "alfon",
            },
            "content": "Hello World 1 by alfon",
          },
        ],
        "name": "alfon",
      },
      {
        "id": "bob",
        "messages": [],
        "name": "Bob",
      },
    ]
  `);

  await mongodb.close();
});

for (const item of drizzleTests) {
  test(`query drizzle (${item.provider})`, async () => {
    for (const kysely of kyselyTests) {
      if (kysely.provider !== item.provider) continue;

      await kysely.db.deleteFrom("users" as any).execute();
      await kysely.db.deleteFrom("messages" as any).execute();
    }

    // 1. Generate schema file
    const schemaPath = path.join(
      __dirname,
      `drizzle-schema.${item.provider}.ts`
    );
    const schemaCode = generateSchema(v1, {
      type: "drizzle-orm",
      provider: item.provider,
    });
    fs.writeFileSync(schemaPath, schemaCode);

    const schema = await import(schemaPath);
    const db = item.db(schema);

    // 3. Run drizzle-kit push/migrate
    if (item.provider === "postgresql") {
      const { apply } = await pushSchema(schema, db as any);
      await apply();
    } else if (item.provider === "mysql") {
      const { apply } = await pushMySQLSchema(schema, db as any, "test");
      await apply();
    } else {
      const { drizzle } = await import("drizzle-orm/libsql");
      const { createClient } = await import("@libsql/client");

      const libsqlClient = createClient({
        url: "file:" + sqlite,
      });

      const db = drizzle(libsqlClient);

      // they need libsql
      const { apply } = await pushSQLiteSchema(schema, db);
      await apply();
    }

    // 4. Run the same query tests as Kysely
    const instance = myDB.configure({
      type: "drizzle-orm",
      db,
      provider: item.provider,
    });

    await testSqlDatabase(instance.abstract);

    fs.rmSync(schemaPath);
  });
}
