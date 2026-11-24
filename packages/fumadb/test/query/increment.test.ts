import { expect, test } from "vitest";
import { fumadb } from "../../src";
import { kyselyAdapter } from "../../src/adapters/kysely";
import { mongoAdapter } from "../../src/adapters/mongodb";
import { type AbstractQuery, increment } from "../../src/query";
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
    counters: table("counters", {
      id: idColumn("id", "varchar(255)"),
      label: column("label", "varchar(255)"),
      views: column("views", "integer"),
      downloads: column("downloads", "bigint").nullable(),
    }),
  },
});

const myDB = fumadb({
  namespace: "increment",
  schemas: [v1],
});

/**
 * `increment()` updates a column relative to its current value, in the same statement.
 */
async function run(orm: AbstractQuery<typeof v1>) {
  await orm.createMany("counters", [
    { id: "a", label: "a", views: 0, downloads: 10n },
    { id: "b", label: "b", views: 5, downloads: null },
    { id: "c", label: "c", views: 1, downloads: 3n },
  ]);

  const get = (id: string) =>
    orm.findFirst("counters", { where: (b) => b("id", "=", id), select: ["views", "downloads"] });

  // concurrent increments are not lost
  await Promise.all(
    Array.from({ length: 10 }, () =>
      orm.updateMany("counters", {
        where: (b) => b("id", "=", "a"),
        set: { views: increment(1) },
      }),
    ),
  );
  expect(await get("a")).toEqual({ views: 10, downloads: 10n });

  // a negative step, a bigint column, and a plain value together
  await orm.updateMany("counters", {
    where: (b) => b("id", "=", "a"),
    set: { views: increment(-3), downloads: increment(5n), label: "x" },
  });
  expect(await get("a")).toEqual({ views: 7, downloads: 15n });

  // a null stays null
  await orm.updateMany("counters", {
    where: (b) => b("id", "=", "b"),
    set: { downloads: increment(1n) },
  });
  expect(await get("b")).toEqual({ views: 5, downloads: null });
  expect(await orm.count("counters", { where: (b) => b.isNull("downloads") })).toBe(1);

  // every row, relative to its own value
  await orm.updateMany("counters", { set: { views: increment(2) } });

  // upsert: update an existing row, create a missing one
  for (const id of ["c", "d"]) {
    await orm.upsert("counters", {
      where: (b) => b("id", "=", id),
      update: { views: increment(10) },
      create: { id, label: id, views: 1 },
    });
  }

  await orm.transaction((tx) =>
    tx.updateMany("counters", {
      where: (b) => b("id", "=", "a"),
      set: { views: increment(1) },
    }),
  );

  await expect(
    orm.updateMany("counters", { set: { label: increment(1) as never } }),
  ).rejects.toThrowError("only works on integer, bigint and decimal columns");
  await expect(orm.updateMany("counters", { set: { views: increment(1.5) } })).rejects.toThrowError(
    "its increment must be an integer",
  );

  expect(await orm.findMany("counters", { orderBy: ["id", "asc"] })).toEqual([
    { id: "a", label: "x", views: 10, downloads: 15n },
    { id: "b", label: "b", views: 7, downloads: null },
    { id: "c", label: "c", views: 13, downloads: 3n },
    { id: "d", label: "d", views: 1, downloads: null },
  ]);
}

test.each(kyselyTests)("increment kysely ($provider)", { timeout: Infinity }, async (item) => {
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

test.each(drizzleTests)("increment drizzle ($provider)", async (item) => {
  await resetDB(item.provider);
  const client = await initDrizzleClient(myDB, "1.0.0", item.provider);

  await run(client.orm("1.0.0"));
});

test.each(prismaTests)("increment prisma ($provider)", { timeout: Infinity }, async (item) => {
  const client = await initPrismaClient(myDB, "1.0.0", item.provider);

  await run(client.orm("1.0.0"));
});

test("increment mongodb", { timeout: Infinity }, async () => {
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
