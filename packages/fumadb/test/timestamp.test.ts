import { sql } from "kysely";
import { afterAll, beforeAll, expect, test } from "vitest";
import { fumadb } from "../src";
import { kyselyAdapter } from "../src/adapters/kysely";
import { column, idColumn, schema, table } from "../src/schema";
import { kyselyTests, resetDB } from "./shared";

const lib = fumadb({
  namespace: "test",
  schemas: [
    schema({
      version: "1.0.0",
      tables: {
        events: table("events", {
          id: idColumn("id", "varchar(255)"),
          at: column("at", "timestamp"),
        }),
      },
    }),
  ],
});

const tz = process.env.TZ;
beforeAll(() => {
  // UTC+03:30
  process.env.TZ = "Asia/Tehran";
});
afterAll(() => {
  process.env.TZ = tz;
});

// `timestamp` has no time zone, it must hold the UTC time like Drizzle & Prisma, whatever the process time zone is
test.each(
  kyselyTests.filter((item) => ["postgresql", "cockroachdb", "mysql"].includes(item.provider)),
)("timestamp holds UTC time on kysely ($provider)", async (item) => {
  expect(new Date("2026-11-08T10:00:00Z").getTimezoneOffset()).toBe(-210);
  await resetDB(item.provider);
  const client = lib.client(kyselyAdapter({ db: item.db, provider: item.provider }));
  await (await client.createMigrator().migrateToLatest()).execute();
  const orm = client.orm("1.0.0");
  const at = new Date("2026-11-08T10:00:00.123Z");

  await orm.create("events", { id: "kysely", at });
  // written by Drizzle or Prisma
  await sql`insert into events (id, at) values ('other', '2026-11-08 10:00:00.123')`.execute(
    item.db,
  );

  const stored = await sql<{
    at: string;
  }>`select cast(at as ${sql.raw(item.provider === "mysql" ? "char" : "text")}) as at from events where id = 'kysely'`.execute(
    item.db,
  );
  expect(stored.rows[0]!.at).toBe("2026-11-08 10:00:00.123");
  expect(await orm.findMany("events", { orderBy: ["id", "asc"] })).toEqual([
    { id: "kysely", at },
    { id: "other", at },
  ]);
  expect(await orm.count("events", { where: (b) => b("at", "=", at) })).toBe(2);
});
