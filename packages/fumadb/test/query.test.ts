import { afterEach, expect, test, vi } from "vitest";
import { column, idColumn, schema, table } from "../src/schema";
import {
  kyselyTests,
  mongodb,
  drizzleTests,
  sqlite,
  prismaTests,
  resetDB,
} from "./shared";
import { fumadb } from "../src";
import fs from "fs";
import path from "path";
import { generateSchema } from "../src/schema/generate";
import { AbstractQuery } from "../src/query";
import * as DrizzleKit from "drizzle-kit/api";

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
      author: one(users, ["user", "id"]).foreignKey(),
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

async function testMongoDatabase(orm: AbstractQuery<typeof v1>) {
  const { messages, users } = orm.tables;

  expect(
    await orm.create(users, {
      id: "generated-cuid",
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

  // For MongoDB, we test basic operations without joins since Prisma adapter doesn't support them yet
  expect(
    await orm.findMany(users, {
      orderBy: [users.name, "asc"],
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
}

async function testSqlDatabase(orm: AbstractQuery<typeof v1>) {
  const { messages, users } = orm.tables;
  expect(
    await orm.create(users, {
      id: "generated-cuid",
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
    await resetDB(item.provider);
    const instance = myDB.configure({
      type: "kysely",
      db: item.db,
      provider: item.provider,
    });

    const migrator = await instance.createMigrator();
    await migrator.migrateToLatest().then((res) => res.execute());

    const orm = instance.abstract;
    await testSqlDatabase(orm);
  });
}

test("query mongodb", async () => {
  await mongodb.connect();
  await resetDB("mongodb");

  const db = mongodb.db("test");
  const instance = myDB.configure({
    type: "mongodb",
    client: db,
  });

  const orm = instance.abstract;
  await testMongoDatabase(orm);

  await mongodb.close();
});

for (const item of drizzleTests) {
  test(`query drizzle (${item.provider})`, async () => {
    if (item.provider === "mysql") {
      // for some reason, drizzle kit push doesn't work for mysql, we can only delete previous data
      for (const kysely of kyselyTests) {
        if (kysely.provider !== item.provider) continue;

        await kysely.db.deleteFrom("users" as any).execute();
        await kysely.db.deleteFrom("messages" as any).execute();
      }
    } else {
      await resetDB(item.provider);
    }

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

    if (item.provider === "postgresql") {
      const { apply } = await DrizzleKit.pushSchema(schema, db as any);
      await apply();
    } else if (item.provider === "mysql") {
      const { apply } = await DrizzleKit.pushMySQLSchema(
        schema,
        db as any,
        "test"
      );
      await apply();
    } else {
      const { drizzle } = await import("drizzle-orm/libsql");
      const { createClient } = await import("@libsql/client");

      const libsqlClient = createClient({
        url: "file:" + sqlite,
      });

      const db = drizzle(libsqlClient);

      // they need libsql
      const { apply } = await DrizzleKit.pushSQLiteSchema(schema, db);
      await apply();
    }

    const instance = myDB.configure({
      type: "drizzle-orm",
      db,
      provider: item.provider,
    });

    await testSqlDatabase(instance.abstract);

    fs.rmSync(schemaPath);
  });
}

for (const item of prismaTests) {
  test(`query prisma (${item.provider})`, { timeout: Infinity }, async () => {
    const prismaClient = await item.db(v1);

    const instance = myDB.configure({
      type: "prisma",
      prisma: prismaClient,
      provider: item.provider,
    });

    const orm = instance.abstract;

    if (item.provider === "mongodb") {
      await testMongoDatabase(orm);
    } else {
      await testSqlDatabase(orm);
    }

    await prismaClient.$disconnect();
  });
}
