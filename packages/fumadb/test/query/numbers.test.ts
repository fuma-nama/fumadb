import { expect, test } from "vitest";
import { fumadb } from "../../src";
import { kyselyAdapter } from "../../src/adapters/kysely";
import { mongoAdapter } from "../../src/adapters/mongodb";
import type { AbstractQuery } from "../../src/query";
import { column, idColumn, schema, table } from "../../src/schema";
import { databases, kyselyTests, resetDB, resetMongoDB } from "../shared";

const v1 = schema({
  version: "1.0.0",
  tables: {
    items: table("items", {
      id: idColumn("id", "varchar(255)"),
      integer: column("integer", "integer"),
      bigint: column("bigint", "bigint"),
    }),
  },
});

const myDB = fumadb({
  namespace: "numbers",
  schemas: [v1],
});

async function run(orm: AbstractQuery<typeof v1>) {
  await orm.create("items", { id: "a", integer: 1, bigint: 2n });

  expect(await orm.findMany("items")).toEqual([{ id: "a", integer: 1, bigint: 2n }]);
}

test.each(kyselyTests)("numbers kysely ($provider)", { timeout: Infinity }, async (item) => {
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
});

test("numbers mongodb", { timeout: Infinity }, async () => {
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
