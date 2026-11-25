import { expect, test } from "vitest";
import { fumadb } from "../../src";
import { kyselyAdapter } from "../../src/adapters/kysely";
import { mongoAdapter } from "../../src/adapters/mongodb";
import type { AbstractQuery } from "../../src/query";
import type { Condition, ConditionBuilder } from "../../src/query/condition-builder";
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
    links: table("links", {
      id: idColumn("id", "varchar(255)"),
      // `integer` would be enough, but the Drizzle schema generator emits an invalid `integer()` for MySQL
      downloads: column("downloads", "bigint").nullable(),
      maxDownloads: column("max_downloads", "bigint").nullable(),
      owner: column("owner", "varchar(255)"),
      editor: column("editor", "varchar(255)").nullable(),
    }),
  },
});

const myDB = fumadb({
  namespace: "ref",
  schemas: [v1],
});

type Where = (
  b: ConditionBuilder<(typeof v1)["tables"]["links"]["columns"]>,
) => Condition | boolean;

/**
 * Comparing a column against another column of the same table, a null on either side never matches.
 */
async function run(orm: AbstractQuery<typeof v1>) {
  await orm.createMany("links", [
    { id: "a", downloads: 0n, maxDownloads: 5n, owner: "x", editor: "x" },
    { id: "b", downloads: 5n, maxDownloads: 5n, owner: "x", editor: "y" },
    { id: "c", downloads: 7n, maxDownloads: 5n, owner: "y", editor: null },
    { id: "d", downloads: 3n, maxDownloads: null, owner: "y", editor: "y" },
    { id: "e", downloads: null, maxDownloads: 2n, owner: "z", editor: "z" },
    { id: "f", downloads: null, maxDownloads: null, owner: "z", editor: null },
  ]);

  async function ids(where: Where, db: AbstractQuery<typeof v1> = orm) {
    const result = await db.findMany("links", { where, orderBy: ["id", "asc"], select: ["id"] });
    return result.map((item) => item.id);
  }

  expect(await ids((b) => b("downloads", "<", b.ref("maxDownloads")))).toEqual(["a"]);
  expect(await ids((b) => b("downloads", "<=", b.ref("maxDownloads")))).toEqual(["a", "b"]);
  expect(await ids((b) => b("downloads", "=", b.ref("maxDownloads")))).toEqual(["b"]);
  expect(await ids((b) => b("downloads", "!=", b.ref("maxDownloads")))).toEqual(["a", "c"]);
  expect(await ids((b) => b("downloads", ">", b.ref("maxDownloads")))).toEqual(["c"]);
  expect(await ids((b) => b("downloads", ">=", b.ref("maxDownloads")))).toEqual(["b", "c"]);

  expect(await ids((b) => b("owner", "=", b.ref("editor")))).toEqual(["a", "d", "e"]);
  expect(await ids((b) => b("owner", "!=", b.ref("editor")))).toEqual(["b"]);

  // links that still open: no limit, or below it
  const isOpen: Where = (b) =>
    b.or(b.isNull("maxDownloads"), b("downloads", "<", b.ref("maxDownloads")));
  expect(await ids(isOpen)).toEqual(["a", "d", "f"]);
  expect(await orm.count("links", { where: isOpen })).toBe(3);

  expect(
    await orm.transaction((tx) => ids((b) => b("downloads", "<", b.ref("maxDownloads")), tx)),
  ).toEqual(["a"]);

  await expect(
    orm.findMany("links", { where: (b) => b("owner", "contains", b.ref("editor") as never) }),
  ).rejects.toThrowError("doesn't accept a column reference");

  await orm.updateMany("links", {
    where: (b) => b("downloads", "<", b.ref("maxDownloads")),
    set: { downloads: 1n },
  });
  expect(await ids((b) => b("downloads", "=", 1n))).toEqual(["a"]);

  await orm.deleteMany("links", { where: (b) => b("downloads", ">", b.ref("maxDownloads")) });
  expect(await ids(() => true)).toEqual(["a", "b", "d", "e", "f"]);
}

test.each(kyselyTests)(
  "column reference kysely ($provider)",
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

test.each(drizzleTests)("column reference drizzle ($provider)", async (item) => {
  await resetDB(item.provider);
  const client = await initDrizzleClient(myDB, "1.0.0", item.provider);

  await run(client.orm("1.0.0"));
});

test.each(prismaTests)(
  "column reference prisma ($provider)",
  { timeout: Infinity },
  async (item) => {
    const client = await initPrismaClient(myDB, "1.0.0", item.provider);

    await run(client.orm("1.0.0"));
  },
);

test("column reference mongodb", { timeout: Infinity }, async () => {
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
