import { afterEach, expect, test, vi } from "vitest";
import {
  kyselyTests,
  mongodb,
  drizzleTests,
  prismaTests,
  resetDB,
} from "./shared";
import { fumadb } from "../src";
import fs from "fs";
import path from "path";
import { generateSchema } from "../src/schema/generate";
import { AbstractQuery } from "../src/query";
import * as DrizzleKit from "drizzle-kit/api";
import { v1 } from "./query/schema-1";

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
      mentionId: "1",
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
      join: (b) =>
        b.messages({
          join: (b) =>
            b.mentionedBy({
              join: (b) => b.author(),
            }),
        }),
    })
  ).toMatchInlineSnapshot(`
    [
      {
        "id": "alfon",
        "messages": [
          {
            "content": "Hello World 1 by alfon",
            "id": "1",
            "image": null,
            "mentionId": null,
            "mentionedBy": {
              "author": {
                "id": "alfon",
                "name": "alfon",
              },
              "content": "Hello World 2 by alfon",
              "id": "2",
              "image": null,
              "mentionId": "1",
              "parent": null,
              "user": "alfon",
            },
            "parent": null,
            "user": "alfon",
          },
          {
            "content": "Hello World 2 by alfon",
            "id": "2",
            "image": null,
            "mentionId": "1",
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

  expect(await orm.count(users)).toMatchInlineSnapshot(`2`);

  const getBob = () =>
    orm.findFirst(users, { where: (b) => b(users.id, "=", "bob") });
  const upsertBob = (v: string) =>
    orm.upsert(users, {
      where: (b) => b(users.id, "=", "bob"),
      create: { id: "bob", name: v },
      update: { name: v },
    });

  await upsertBob("Bob is sad");
  expect(await getBob()).toMatchInlineSnapshot(`
    {
      "id": "bob",
      "name": "Bob is sad",
    }
  `);

  await upsertBob("Bob is happy");
  expect(await getBob()).toMatchInlineSnapshot(`
    {
      "id": "bob",
      "name": "Bob is happy",
    }
  `);

  expect(
    await orm.create(messages, {
      id: "image-test",
      user: "alfon",
      content: "test",
      image: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    })
  ).toMatchInlineSnapshot(`
    {
      "content": "test",
      "id": "image-test",
      "image": Uint8Array [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
      ],
      "mentionId": null,
      "parent": null,
      "user": "alfon",
    }
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
      mentionId: "1",
    },
  ]);
  expect(
    await orm.findMany(users, {
      orderBy: [users.name, "asc"],
      join: (b) =>
        b.messages({
          join: (b) =>
            b.mentionedBy({
              join: (b) => b.author(),
            }),
        }),
    })
  ).toMatchInlineSnapshot(`
    [
      {
        "id": "alfon",
        "messages": [
          {
            "content": "Hello World 1 by alfon",
            "id": "1",
            "image": null,
            "mentionId": null,
            "mentionedBy": {
              "author": {
                "id": "alfon",
                "name": "alfon",
              },
              "content": "Hello World 2 by alfon",
              "id": "2",
              "image": null,
              "mentionId": "1",
              "parent": null,
              "user": "alfon",
            },
            "parent": null,
            "user": "alfon",
          },
          {
            "content": "Hello World 2 by alfon",
            "id": "2",
            "image": null,
            "mentionId": "1",
            "mentionedBy": null,
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

  expect(await orm.count(users)).toMatchInlineSnapshot(`2`);

  const getBob = () =>
    orm.findFirst(users, { where: (b) => b(users.id, "=", "bob") });
  const upsertBob = (v: string) =>
    orm.upsert(users, {
      where: (b) => b(users.id, "=", "bob"),
      create: { id: "bob", name: v },
      update: { name: v },
    });

  await upsertBob("Bob is sad");
  expect(await getBob()).toMatchInlineSnapshot(`
    {
      "id": "bob",
      "name": "Bob is sad",
    }
  `);

  await upsertBob("Bob is happy");
  expect(await getBob()).toMatchInlineSnapshot(`
    {
      "id": "bob",
      "name": "Bob is happy",
    }
  `);

  expect(
    await orm.create(messages, {
      id: "image-test",
      user: "alfon",
      content: "test",
      image: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    })
  ).toMatchInlineSnapshot(`
    {
      "content": "test",
      "id": "image-test",
      "image": Uint8Array [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
      ],
      "mentionId": null,
      "parent": null,
      "user": "alfon",
    }
  `);

  const results = await Promise.all([
    orm
      .transaction(async (tx) => {
        await tx.createMany(messages, [
          {
            id: "transaction-1",
            user: "alfon",
            content: "test message",
          },
          {
            id: "transaction-2",
            user: "bob",
            content: "haha",
          },
        ]);

        await tx.deleteMany(messages, {
          where: (b) => b(messages.user, "=", "alfon"),
        });

        expect(
          await tx.findMany(messages, {
            where: (b) => b(messages.user, "=", "bob"),
          })
        ).toMatchInlineSnapshot(`
          [
            {
              "content": "haha",
              "id": "transaction-2",
              "image": null,
              "mentionId": null,
              "parent": null,
              "user": "bob",
            },
          ]
        `);

        throw new Error("Rollback!");
      })
      .catch(() => null),
    orm.findMany(messages, { where: (b) => b(messages.user, "=", "alfon") }),
  ]);

  // transaction should not affect concurrent operations
  expect(results[1]).toMatchInlineSnapshot(`
    [
      {
        "content": "Hello World 1 by alfon",
        "id": "1",
        "image": null,
        "mentionId": null,
        "parent": null,
        "user": "alfon",
      },
      {
        "content": "Hello World 2 by alfon",
        "id": "2",
        "image": null,
        "mentionId": "1",
        "parent": null,
        "user": "alfon",
      },
      {
        "content": "test",
        "id": "image-test",
        "image": Uint8Array [
          1,
          2,
          3,
          4,
          5,
          6,
          7,
          8,
        ],
        "mentionId": null,
        "parent": null,
        "user": "alfon",
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

  const instance = myDB.configure({
    type: "mongodb",
    client: mongodb,
  });

  const orm = instance.abstract;
  await testMongoDatabase(orm);

  await mongodb.close();
});

for (const item of drizzleTests) {
  test(`query drizzle (${item.provider})`, async () => {
    await resetDB(item.provider);

    const schemaPath = path.join(
      import.meta.dirname,
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
      const { sql } = await import("drizzle-orm");
      const prev = await DrizzleKit.generateMySQLDrizzleJson({});
      const cur = await DrizzleKit.generateMySQLDrizzleJson(schema);
      const statements = await DrizzleKit.generateMySQLMigration(prev, cur);

      for (const statement of statements) {
        await (db as any).execute(sql.raw(statement));
      }
    } else {
      // they need libsql
      const { apply } = await DrizzleKit.pushSQLiteSchema(schema, db as any);
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
