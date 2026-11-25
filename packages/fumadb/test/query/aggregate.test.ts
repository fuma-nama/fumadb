import { expect, expectTypeOf, test } from "vitest";
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
    files: table("files", {
      id: idColumn("id", "varchar(255)"),
      folder: column("folder", "varchar(255)").nullable(),
      name: column("name", "string"),
      size: column("size", "bigint").nullable(),
      views: column("views", "integer"),
      score: column("score", "decimal").nullable(),
      createdAt: column("created_at", "timestamp"),
    }),
  },
});

const myDB = fumadb({
  namespace: "aggregate",
  schemas: [v1],
});

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

async function run(orm: AbstractQuery<typeof v1>) {
  await orm.createMany("files", [
    { id: "a", folder: "f1", name: "b", size: 10n, views: 1, score: 1.5, createdAt: day(2) },
    { id: "b", folder: "f1", name: "a", size: 20n, views: 3, score: null, createdAt: day(1) },
    { id: "c", folder: "f2", name: "c", size: null, views: 5, score: 2.5, createdAt: day(3) },
    { id: "d", folder: null, name: "d", size: 5n, views: 2, score: 3.5, createdAt: day(4) },
    { id: "e", folder: null, name: "e", size: null, views: 4, score: null, createdAt: day(5) },
  ]);

  const all = await orm.aggregate("files", {
    count: true,
    sum: ["size", "views", "score"],
    avg: ["views", "score"],
    min: ["name", "createdAt", "size"],
    max: ["name", "createdAt", "views", "score"],
  });
  expectTypeOf(all.sum.size).toEqualTypeOf<bigint>();
  expectTypeOf(all.avg.views).toEqualTypeOf<number | null>();
  expectTypeOf(all.min.createdAt).toEqualTypeOf<Date | null>();
  expect(all).toEqual({
    count: 5,
    sum: { size: 35n, views: 15, score: 7.5 },
    avg: { views: 3, score: 2.5 },
    min: { name: "a", createdAt: day(1), size: 5n },
    max: { name: "e", createdAt: day(5), views: 5, score: 3.5 },
  });

  expect(
    await orm.aggregate("files", {
      where: (b) => b("folder", "=", "f1"),
      count: true,
      sum: ["size"],
    }),
  ).toEqual({ count: 2, sum: { size: 30n } });

  // nothing matches
  expect(
    await orm.aggregate("files", {
      where: (b) => b("id", "=", "none"),
      count: true,
      sum: ["size", "views"],
      avg: ["views"],
      min: ["name"],
    }),
  ).toEqual({ count: 0, sum: { size: 0n, views: 0 }, avg: { views: null }, min: { name: null } });
  expect(await orm.aggregate("files", { where: () => false, max: ["views"] })).toEqual({
    max: { views: null },
  });

  // a null is a group of its own
  const byFolder = await orm.aggregate("files", {
    groupBy: ["folder"],
    count: true,
    sum: ["size"],
    max: ["createdAt"],
  });
  expectTypeOf(byFolder[0]!.group.folder).toEqualTypeOf<string | null>();
  expect(
    byFolder.sort((a, b) => String(a.group.folder).localeCompare(String(b.group.folder))),
  ).toEqual([
    { group: { folder: "f1" }, count: 2, sum: { size: 30n }, max: { createdAt: day(2) } },
    { group: { folder: "f2" }, count: 1, sum: { size: 0n }, max: { createdAt: day(3) } },
    { group: { folder: null }, count: 2, sum: { size: 5n }, max: { createdAt: day(5) } },
  ]);

  const byFolderAndViews = await orm.aggregate("files", {
    where: (b) => b("folder", "=", "f1"),
    groupBy: ["folder", "views"],
    min: ["size"],
  });
  expect(byFolderAndViews.sort((a, b) => a.group.views - b.group.views)).toEqual([
    { group: { folder: "f1", views: 1 }, min: { size: 10n } },
    { group: { folder: "f1", views: 3 }, min: { size: 20n } },
  ]);

  const byScore = await orm.aggregate("files", {
    where: (b) => b.isNotNull("score"),
    groupBy: ["score"],
    count: true,
  });
  expect(byScore.sort((a, b) => a.group.score! - b.group.score!)).toEqual([
    { group: { score: 1.5 }, count: 1 },
    { group: { score: 2.5 }, count: 1 },
    { group: { score: 3.5 }, count: 1 },
  ]);

  expect(
    await orm.aggregate("files", { where: (b) => b("id", "=", "none"), groupBy: ["folder"] }),
  ).toEqual([]);
  expect(await orm.aggregate("files", { where: (b) => b("id", "=", "none"), groupBy: [] })).toEqual(
    [],
  );

  expect(await orm.transaction((tx) => tx.aggregate("files", { count: true }))).toEqual({
    count: 5,
  });

  await expect(orm.aggregate("files", { sum: ["name" as never] })).rejects.toThrowError(
    "`sum` doesn't accept the string column",
  );
}

// only checked by the type checker
export function typeErrors(orm: AbstractQuery<typeof v1>) {
  // @ts-expect-error not a numeric column
  void orm.aggregate("files", { sum: ["name"] });
  // @ts-expect-error unknown column
  void orm.aggregate("files", { min: ["unknown"] });
  // @ts-expect-error `count` is not selected
  void orm.aggregate("files", { sum: ["size"] }).then((result) => result.count);
}

test.each(kyselyTests)("aggregate kysely ($provider)", { timeout: Infinity }, async (item) => {
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

test.each(drizzleTests)("aggregate drizzle ($provider)", async (item) => {
  await resetDB(item.provider);
  const client = await initDrizzleClient(myDB, "1.0.0", item.provider);

  await run(client.orm("1.0.0"));
});

test.each(prismaTests)("aggregate prisma ($provider)", { timeout: Infinity }, async (item) => {
  const client = await initPrismaClient(myDB, "1.0.0", item.provider);

  await run(client.orm("1.0.0"));
});

test("aggregate mongodb", { timeout: Infinity }, async () => {
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
