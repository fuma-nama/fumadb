import { afterAll, expect, test, vi } from "vitest";
import { schema, table } from "../src/schema";
import { kyselyTests, mongodb } from "./shared";
import { fumadb } from "../src";

const myDB = fumadb({
  namespace: "test",
  schemas: [
    schema({
      version: "1.0.0",
      tables: {
        users: table("users", {
          id: {
            type: "varchar(255)",
            name: "id",
            id: true,
            default: "auto",
          },
          name: {
            type: "string",
            name: "name",
          },
        }),
      },
    }),
  ],
});

vi.mock("../src/cuid", () => ({
  createId: vi.fn(() => "generated-cuid"),
}));

afterAll(() => {
  vi.restoreAllMocks();
});

for (const item of kyselyTests) {
  test(`query ksely (${item.provider})`, async () => {
    const instance = myDB.configure({
      type: "kysely",
      db: item.db,
      provider: item.provider,
    });

    await item.db.schema.dropTable("users").ifExists().execute();

    const migrator = await instance.createMigrator();
    await migrator.versionManager.set_sql("0.0.0").execute();
    await migrator.migrateToLatest().then((res) => res.execute());

    const { tables, ...orm } = instance.abstract;
    expect(
      await orm.create(tables.users, {
        name: "fuma",
      })
    ).toMatchInlineSnapshot(`
      {
        "id": "generated-cuid",
        "name": "fuma",
      }
    `);

    await orm.createMany(tables.users, [
      {
        id: "alfon",
        name: "alfon",
      },
    ]);

    const userList = await orm.findMany(tables.users, {
      select: true,
      orderBy: [[tables.users.name, "asc"]],
    });

    expect(userList).toMatchInlineSnapshot(`
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
  });
}

test("query mongodb", async () => {
  await mongodb.connect();
  const db = mongodb.db("test");
  await db.dropCollection("users");
  const instance = myDB.configure({
    type: "mongodb",
    client: db,
  });

  const { tables, ...orm } = instance.abstract;

  await orm.createMany(tables.users, [
    {
      id: "alfon",
      name: "alfon",
    },
    {
      id: "bob",
      name: "Bob",
    },
  ]);

  const result = await orm.create(tables.users, {
    name: "fuma",
  });

  expect(result.id).toBeTypeOf("string");
  expect(result.name).toBe("fuma");

  expect(
    await orm.findFirst(tables.users, {
      select: true,
      where: (b) => b(tables.users.name, "=", "alfon"),
    })
  ).toMatchInlineSnapshot(`
    {
      "id": "alfon",
      "name": "alfon",
    }
  `);

  expect(
    await orm.findMany(tables.users, {
      select: true,
      where: (b) => b(tables.users.name, "!=", "fuma"),
      orderBy: [[tables.users.name, "asc"]],
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

  await mongodb.close();
});
