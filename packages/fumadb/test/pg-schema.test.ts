import * as fs from "node:fs";
import * as path from "node:path";
import { type Kysely, sql } from "kysely";
import { expect, test } from "vitest";
import { type FumaDB, fumadb } from "../src";
import { drizzleAdapter } from "../src/adapters/drizzle";
import { kyselyAdapter } from "../src/adapters/kysely";
import { prismaAdapter } from "../src/adapters/prisma";
import { column, idColumn, schema, table } from "../src/schema";
import { drizzleTests, kyselyTests, resetDB } from "./shared";

const v1 = schema({
  version: "1.0.0",
  tables: {
    users: table("users", {
      id: idColumn("id", "varchar(255)"),
      name: column("name", "varchar(255)").unique(),
    }),
    files: table("files", {
      id: idColumn("id", "varchar(255)"),
      ownerId: column("owner_id", "varchar(255)"),
      key: column("key", "varchar(255)"),
    }).index("files_owner_idx", ["ownerId"]),
  },
  relations: {
    files: ({ one }) => ({
      owner: one("users", ["ownerId", "id"]).foreignKey(),
    }),
  },
});

const lib = fumadb({ namespace: "storage", schemas: [v1] });

async function tablesOf(db: Kysely<any>, schema: string) {
  const { rows } = await sql<{ table_name: string }>`
    select table_name from information_schema.tables where table_schema = ${schema} order by table_name`.execute(
    db,
  );

  return rows.map((row) => row.table_name);
}

async function expectData(client: FumaDB<[typeof v1]>) {
  expect(
    await client.orm("1.0.0").findMany("files", { join: (b) => b.owner({ select: ["name"] }) }),
  ).toEqual([{ id: "a", ownerId: "fuma", key: "a.txt", owner: { name: "Fuma" } }]);
}

test.each(kyselyTests.filter((item) => ["postgresql", "cockroachdb"].includes(item.provider)))(
  "place tables in a schema with kysely ($provider)",
  { timeout: Infinity },
  async ({ db, provider }) => {
    await resetDB(provider);
    await sql`drop schema if exists storage cascade`.execute(db);

    // installed in the search path
    const client = lib.client(kyselyAdapter({ db, provider }));
    await (await client.createMigrator().migrateToLatest()).execute();
    await client.orm("1.0.0").create("users", { id: "fuma", name: "Fuma" });
    await client.orm("1.0.0").create("files", { id: "a", ownerId: "fuma", key: "a.txt" });

    // move to the schema, the settings table stays in the search path
    const moved = lib.names.schema("storage").client(kyselyAdapter({ db, provider }));
    const migrator = moved.createMigrator();
    await (await migrator.migrateToLatest()).execute();

    expect(await tablesOf(db, "storage")).toEqual(["files", "users"]);
    expect(await tablesOf(db, "public")).toEqual(["private_storage_settings"]);
    expect(await moved.version()).toBe("1.0.0");
    await expectData(moved);

    // the database is in sync with the schema
    const result = await migrator.migrateToLatest({ mode: "from-database", updateSettings: false });
    expect(result.operations).toEqual([]);

    // move back
    await (await client.createMigrator().migrateToLatest()).execute();
    expect(await tablesOf(db, "storage")).toEqual([]);
    expect(await tablesOf(db, "public")).toEqual(["files", "private_storage_settings", "users"]);
    await expectData(client);
  },
);

test("create tables in a schema with drizzle (postgresql)", { timeout: Infinity }, async () => {
  const kysely = kyselyTests.find((item) => item.provider === "postgresql")!.db;
  const { db } = drizzleTests.find((item) => item.provider === "postgresql")!;
  await resetDB("postgresql");
  await sql`drop schema if exists storage cascade`.execute(kysely);

  const generated = lib.names
    .schema("storage")
    .client(drizzleAdapter({ db: db(), provider: "postgresql" }))
    .generateSchema("1.0.0");
  expect(generated.code).toContain(`export const storageSchema = pgSchema("storage")`);
  expect(generated.code).toContain(`storageSchema.table("users"`);

  const file = path.join(import.meta.dirname, "drizzle-schema.pg-schema.ts");
  fs.writeFileSync(file, generated.code);
  const mod = await import(`${file}?hash=${Date.now()}`);
  fs.rmSync(file);

  const { relations: _, ...tables } = mod;
  const { pushSchema } = await import("drizzle-kit/api-postgres");
  await (await pushSchema(tables, db() as never)).apply();

  expect(await tablesOf(kysely, "storage")).toEqual(["files", "users"]);
  const client = lib.names
    .schema("storage")
    .client(drizzleAdapter({ db: db(mod), provider: "postgresql" }));
  await client.orm("1.0.0").create("users", { id: "fuma", name: "Fuma" });
  await client.orm("1.0.0").create("files", { id: "a", ownerId: "fuma", key: "a.txt" });
  await expectData(client);
});

test("create tables in a schema with prisma", () => {
  const code = lib.names
    .schema("storage")
    .client(prismaAdapter({ prisma: {}, provider: "postgresql" }))
    .generateSchema("1.0.0").code;

  expect(code).toContain(`model users {`);
  expect(code.match(/@@schema\("storage"\)/g)).toHaveLength(2);
  // the settings table stays in the search path
  expect(code.match(/@@schema\("public"\)/g)).toHaveLength(1);
});

test("prefix applies to table name, not its schema", () => {
  const [prefixed] = lib.names
    .schema("storage")
    .names.prefix("s_")
    .client({} as never).schemas;
  expect(prefixed!.tables.files.names.sql).toBe("storage.s_files");
});
