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
  initPrismaClient,
  kyselyTests,
  prismaTests,
  resetDB,
  resetMongoDB,
} from "../shared";

const v1 = schema({
  version: "1.0.0",
  tables: {
    items: table("items", {
      id: idColumn("id", "varchar(255)"),
      position: column("position", "integer"),
    }),
  },
});

const myDB = fumadb({
  namespace: "paging",
  schemas: [v1],
});

async function run(orm: AbstractQuery<typeof v1>) {
  // out of order, the rows must be sorted before paging
  await orm.createMany(
    "items",
    [3, 1, 4, 2].map((position) => ({ id: `item-${position}`, position })),
  );

  const positions = async (options: { limit?: number; offset?: number }) =>
    (await orm.findMany("items", { ...options, orderBy: ["position", "asc"] })).map(
      (item) => item.position,
    );

  expect(await positions({ limit: 2 })).toEqual([1, 2]);
  // MySQL & SQLite require `LIMIT` with `OFFSET`
  expect(await positions({ offset: 1 })).toEqual([2, 3, 4]);
  // MSSQL cannot use `TOP` with `OFFSET`
  expect(await positions({ offset: 1, limit: 2 })).toEqual([2, 3]);
}

test.each(kyselyTests)("paging kysely ($provider)", { timeout: Infinity }, async (item) => {
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

test.each(drizzleTests)("paging drizzle ($provider)", async (item) => {
  await resetDB(item.provider);
  const client = await initDrizzleClient(myDB, "1.0.0", item.provider);

  await run(client.orm("1.0.0"));
});

test.each(prismaTests)("paging prisma ($provider)", { timeout: Infinity }, async (item) => {
  const client = await initPrismaClient(myDB, "1.0.0", item.provider);

  await run(client.orm("1.0.0"));
});

test("paging mongodb", { timeout: Infinity }, async () => {
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
