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

test.each(kyselyTests)("query ksely ($provider)", async (item) => {
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
  await orm.createMany(tables.users, [
    {
      name: "fuma",
    },
  ]);

  const userList = await orm.findMany(tables.users, {
    select: true,
  });

  expect(userList).toMatchSnapshot();
});

test("query mongodb", async () => {
  await mongodb.connect();
  const db = mongodb.db("test");
  await db.dropCollection("users");
  const instance = myDB.configure({
    type: "mongodb",
    client: db,
  });

  const { tables, ...orm } = instance.abstract;
  const result = [
    await orm.create(tables.users, {
      name: "fuma",
      id: "generated",
    }),
    await orm.createMany(tables.users, [
      {
        name: "alfon",
      },
    ]),
  ];

  expect(result[0]).toMatchInlineSnapshot(`
    {
      "id": "generated",
      "name": "fuma",
    }
  `);

  const userList = await orm.findMany(tables.users, {
    select: true,
    where: (b) => b(tables.users.name, "=", "fuma"),
  });

  expect(userList).toMatchInlineSnapshot(`
    [
      {
        "id": "generated",
        "name": "fuma",
      },
    ]
  `);
  await mongodb.close();
});
