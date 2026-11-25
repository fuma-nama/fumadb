import { expect, test } from "vitest";
import { fumadb } from "../../src";
import { kyselyAdapter } from "../../src/adapters/kysely";
import { mongoAdapter } from "../../src/adapters/mongodb";
import type { AbstractQuery } from "../../src/query";
import { column, idColumn, schema, table } from "../../src/schema";
import {
  databases,
  drizzleTests,
  initDrizzleClient,
  kyselyTests,
  resetDB,
  resetMongoDB,
} from "../shared";

const v1 = schema({
  version: "1.0.0",
  tables: {
    items: table("items", {
      id: idColumn("id", "varchar(255)"),
      name: column("name", "string"),
    }),
  },
});

const myDB = fumadb({
  namespace: "like",
  schemas: [v1],
});

const names = [
  "user_1",
  "userX1",
  "Price 50%",
  "Price 500",
  "wow!",
  "a[b]c",
  "a-b-c",
  "back\\slash",
];

/**
 * `%`, `_` and other special characters of patterns should be matched literally.
 */
async function run(orm: AbstractQuery<typeof v1>) {
  await orm.createMany(
    "items",
    names.map((name, i) => ({ id: `item-${i}`, name })),
  );

  async function query(
    op:
      | "contains"
      | "starts with"
      | "ends with"
      | `not ${"contains" | "starts with" | "ends with"}`,
    value: string,
  ) {
    const result = await orm.findMany("items", {
      where: (b) => b("name", op, value),
      orderBy: ["id", "asc"],
    });

    return result.map((item) => item.name);
  }

  const without = (...excluded: string[]) => names.filter((name) => !excluded.includes(name));

  expect(await query("starts with", "user_")).toEqual(["user_1"]);
  expect(await query("not starts with", "user_")).toEqual(without("user_1"));
  expect(await query("starts with", "a[b]")).toEqual(["a[b]c"]);

  expect(await query("contains", "50%")).toEqual(["Price 50%"]);
  expect(await query("contains", "%")).toEqual(["Price 50%"]);
  expect(await query("contains", "_")).toEqual(["user_1"]);
  expect(await query("contains", "!")).toEqual(["wow!"]);
  expect(await query("contains", "[b]")).toEqual(["a[b]c"]);
  expect(await query("contains", "\\")).toEqual(["back\\slash"]);
  expect(await query("not contains", "_")).toEqual(without("user_1"));
  expect(await query("not contains", "50%")).toEqual(without("Price 50%"));

  expect(await query("ends with", "%")).toEqual(["Price 50%"]);
  expect(await query("ends with", "_1")).toEqual(["user_1"]);
  expect(await query("ends with", "!")).toEqual(["wow!"]);
  expect(await query("not ends with", "0%")).toEqual(without("Price 50%"));

  expect(await orm.count("items", { where: (b) => b("name", "contains", "%") })).toBe(1);
  expect(await orm.count("items", { where: (b) => b.not(b("name", "contains", "%")) })).toBe(
    names.length - 1,
  );
}

test.each(kyselyTests)(
  "literal patterns kysely ($provider)",
  { timeout: Infinity },
  async (item) => {
    await resetDB(item.provider);
    const client = myDB.client(
      kyselyAdapter({
        db: item.db,
        provider: item.provider,
      }),
    );

    const migrator = await client.createMigrator();
    await migrator.migrateToLatest().then((res) => res.execute());

    await run(client.orm("1.0.0"));
  },
);

test.each(drizzleTests)("literal patterns drizzle ($provider)", async (item) => {
  await resetDB(item.provider);
  const client = await initDrizzleClient(myDB, "1.0.0", item.provider);

  await run(client.orm("1.0.0"));
});

test("literal patterns mongodb", { timeout: Infinity }, async () => {
  const mongodb = databases.find((db) => db.provider === "mongodb")!.create();
  await mongodb.connect();
  await resetMongoDB(mongodb);

  const instance = myDB.client(
    mongoAdapter({
      client: mongodb,
    }),
  );
  await (await instance.createMigrator().migrateToLatest()).execute();

  await run(instance.orm("1.0.0"));
  await mongodb.close();
});
