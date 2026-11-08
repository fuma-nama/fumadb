import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { expect, test } from "vitest";
import { type AnySchema, fumadb } from "../src";
import { drizzleAdapter } from "../src/adapters/drizzle";
import { kyselyAdapter } from "../src/adapters/kysely";
import { column, idColumn, schema, table } from "../src/schema";

function openKysely(schemas: AnySchema[]) {
  const database = new Database(":memory:");
  const client = fumadb({ namespace: "demo", schemas }).client(
    kyselyAdapter({
      db: new Kysely({ dialect: new SqliteDialect({ database }) }),
      provider: "sqlite",
    }),
  );

  const indexes = (tableName: string) =>
    database
      .prepare(
        `SELECT "name" FROM "sqlite_master" WHERE "type" = 'index' AND "tbl_name" = ? AND "name" NOT LIKE 'sqlite_%' ORDER BY "name"`,
      )
      .all(tableName)
      .map((row) => (row as { name: string }).name);

  return { database, client, indexes };
}

const itemV1 = schema({
  version: "1.0.0",
  tables: {
    item: table("item", {
      id: idColumn("id", "varchar(255)").defaultTo$("auto"),
      name: column("name", "string"),
    }),
  },
  async up({ auto }) {
    return [
      ...(await auto()),
      { type: "custom", sql: `CREATE INDEX "item_name_idx" ON "item" ("name")` },
    ];
  },
});

test("custom `up` runs on a fresh database", async () => {
  // single schema
  const only = openKysely([itemV1]);
  await (await only.client.createMigrator().migrateToLatest()).execute();
  expect(only.indexes("item")).toEqual(["item_name_idx"]);

  // jump over an empty predecessor
  const jumped = openKysely([schema({ version: "0.0.1", tables: {} }), itemV1]);
  await (await jumped.client.createMigrator().migrateToLatest()).execute();
  expect(jumped.indexes("item")).toEqual(["item_name_idx"]);
  expect(await jumped.client.version()).toBe("1.0.0");
});

test("non-adjacent migrations run the `up` of every step", async () => {
  const v2 = schema({
    version: "2.0.0",
    tables: itemV1.tables,
    up: () => [{ type: "custom", sql: `CREATE INDEX "item_v2_idx" ON "item" ("name")` }],
  });

  const { client, indexes } = openKysely([itemV1, v2]);
  const migrator = client.createMigrator();
  await (await migrator.migrateToLatest()).execute();

  expect(indexes("item")).toEqual(["item_name_idx", "item_v2_idx"]);
  expect(await migrator.getVersion()).toBe("2.0.0");
});

const indexed = (nullableName: boolean, version: string) =>
  schema({
    version,
    tables: {
      item: table("item", {
        id: idColumn("id", "varchar(255)").defaultTo$("auto"),
        scope: column("scope", "string"),
        name: nullableName ? column("name", "string").nullable() : column("name", "string"),
      })
        .index("item_scope_idx", ["scope"])
        .unique("item_scope_name_uk", ["scope", "name"]),
    },
  });

test("indexes survive SQLite table recreation", async () => {
  const { client, indexes } = openKysely([indexed(false, "1.0.0"), indexed(true, "1.1.0")]);
  const migrator = client.createMigrator();

  await (await migrator.up()).execute();
  expect(indexes("item")).toEqual(["item_scope_idx", "item_scope_name_uk"]);

  // `name` becomes nullable, the table is recreated
  await (await migrator.up()).execute();
  expect(indexes("item")).toEqual(["item_scope_idx", "item_scope_name_uk"]);

  // in sync with database
  const result = await migrator.migrateTo("1.1.0", {
    mode: "from-database",
    updateSettings: false,
  });
  expect(result.operations).toEqual([]);
});

const valuesSchema = schema({
  version: "1.0.0",
  tables: {
    item: table("item", {
      id: idColumn("id", "varchar(255)").defaultTo$("auto"),
      size: column("size", "bigint").nullable(),
      meta: column("meta", "json").nullable(),
      createdAt: column("created_at", "timestamp").defaultTo$("now"),
    }),
  },
});

test("Kysely & generated Drizzle schema share the same SQLite columns", async () => {
  const { database, client: viaKysely } = openKysely([valuesSchema]);
  await (await viaKysely.createMigrator().migrateToLatest()).execute();

  // load the generated Drizzle schema
  const factory = fumadb({ namespace: "demo", schemas: [valuesSchema] });
  const generated = factory
    .client(drizzleAdapter({ db: drizzle({ client: database }), provider: "sqlite" }))
    .generateSchema("1.0.0");
  const file = path.join(import.meta.dirname, "drizzle-schema.consistency.ts");
  fs.writeFileSync(file, generated.code);
  const mod = await import(`${file}?hash=${Date.now()}`);
  fs.rmSync(file);

  const viaDrizzle = factory.client(
    drizzleAdapter({
      db: drizzle({ client: database, relations: mod.relations }),
      provider: "sqlite",
    }),
  );

  // the version is the default value of `value` in the generated schema
  expect(await viaDrizzle.version()).toBe(await viaKysely.version());

  const at = new Date("2030-01-01T00:00:00.000Z");
  for (const [id, size] of [
    ["a", 5497558138880n],
    ["b", -1n],
    ["c", 0n],
  ] as const) {
    const orm = id === "b" ? viaDrizzle : viaKysely;
    await orm.orm("1.0.0").create("item", { id, size, meta: { a: 1 }, createdAt: at });
  }
  // database default
  database.prepare(`INSERT INTO "item" ("id") VALUES ('sql-default')`).run();

  const stored = database
    .prepare(
      `SELECT "id", typeof("size") as "size", typeof("meta") as "meta", typeof("created_at") as "created_at" FROM "item" WHERE "id" != 'sql-default'`,
    )
    .all();
  for (const row of stored) {
    expect(row).toMatchObject({ size: "integer", meta: "text", created_at: "integer" });
  }

  for (const orm of [viaKysely, viaDrizzle]) {
    const rows = await orm.orm("1.0.0").findMany("item", {
      where: (b) => b.isNotNull("size"),
      orderBy: ["size", "asc"],
    });

    expect(rows.map((row) => [row.id, row.size, row.meta, row.createdAt])).toEqual([
      ["b", -1n, { a: 1 }, at],
      ["c", 0n, { a: 1 }, at],
      ["a", 5497558138880n, { a: 1 }, at],
    ]);

    const defaulted = await orm.orm("1.0.0").findFirst("item", {
      where: (b) => b("id", "=", "sql-default"),
    });
    expect(Math.abs(defaulted!.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
  }

  // without `where` (relational queries v2)
  expect(await viaDrizzle.orm("1.0.0").findMany("item", {})).toHaveLength(4);
  expect(await viaDrizzle.orm("1.0.0").findFirst("item", {})).not.toBeNull();
});
