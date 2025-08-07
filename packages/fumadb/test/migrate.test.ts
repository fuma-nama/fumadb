import { table, column, idColumn, schema } from "../src/schema";
import { expect, test } from "vitest";
import { databases, kyselyTests, resetDB, resetMongoDB } from "./shared";
import { fumadb } from "../src";
import { kyselyAdapter } from "../src/adapters/kysely";
import { mongoAdapter } from "../src/adapters/mongodb";

const v1 = schema({
  version: "1.0.0",
  tables: {
    users: table("users", {
      id: idColumn("id", "varchar(255)").defaultTo$("auto"),
      image: column("image", "varchar(200)").nullable().defaultTo("my-avatar"),
      data: column("data", "binary").nullable(),
    }),
    accounts: table("accounts", {
      id: idColumn("secret_id", "varchar(255)"),
    }),
  },
});

// add columns of different data types
// add father relations
const v2 = schema({
  version: "2.0.0",
  tables: {
    users: table("users", {
      id: idColumn("id", "varchar(255)").defaultTo$("auto"),
      name: column("name", "varchar(255)"),
      email: column("email", "varchar(255)").unique(),
      image: column("image", "string").nullable().defaultTo("another-avatar"),
      stringColumn: column("string", "string").nullable(),
      bigintColumn: column("bigint", "bigint").nullable(),
      integerColumn: column("integer", "integer").nullable(),
      decimalColumn: column("decimal", "decimal").nullable(),
      boolColumn: column("bool", "bool").nullable(),
      jsonColumn: column("json", "json").nullable(),
      binaryColumn: column("binary", "binary").nullable(),
      dateColumn: column("date", "date").nullable(),
      timestampColumn: column("timestamp", "timestamp").nullable(),
      fatherId: column("fatherId", "varchar(255)").nullable().unique(),
    }),
    accounts: table("accounts", {
      id: idColumn("secret_id", "varchar(255)"),
      email: column("email", "varchar(255)").unique().defaultTo("test"),
    }),
  },
  relations: {
    users: (b) => ({
      account: b
        .one("accounts", ["email", "id"])
        .foreignKey({
          onDelete: "CASCADE",
        })
        .imply("user"),

      father: b.one("users", ["fatherId", "id"]).foreignKey().imply("son"),
      son: b.one("users"),
    }),
    accounts: (b) => ({
      user: b.one("users"),
    }),
  },
});

// remove v2 new columns & relations
// remove unique from accounts, and add to users
const v3 = schema({
  version: "3.0.0",
  tables: {
    users: table("users", {
      id: idColumn("id", "varchar(255)").defaultTo$("auto"),
      name: column("name", "varchar(255)"),
      email: column("email", "varchar(255)"),
      image: column("image", "string").nullable(),
    }),
    accounts: table("accounts", {
      id: idColumn("secret_id", "varchar(255)"),
      email: column("email", "varchar(255)"),
    }).unique("id_email_uk", ["id", "email"]),
  },
});

const TestDB = fumadb({
  namespace: "test",
  schemas: [v1, v2, v3],
});

const testOptions = [
  {
    mode: "from-database",
    unsafe: true,
  },
  {
    mode: "from-schema",
    unsafe: true,
  },
] as const;

test.each(
  kyselyTests.flatMap((item) =>
    testOptions.map((options) => ({ ...item, ...options }))
  )
)(
  "generate migration: $provider using $mode",
  { timeout: Infinity },
  async (item) => {
    const file = `snapshots/migration/kysely.${item.provider}-${item.mode}.sql`;
    await resetDB(item.provider);
    const adapter = kyselyAdapter(item);

    const generated: string[] = [];

    for (let i = 0; i < 3; i++) {
      const client = TestDB.names.prefix(`prefix_${i}_`).client(adapter);
      const migrator = client.createMigrator();

      const { execute, getSQL } = await migrator.up(item);
      expect((await migrator.next()) != null).toBe(true);

      generated.push(getSQL!());
      await execute();

      if (i === 0) {
        const orm = client.orm("1.0.0");
        await orm.create("accounts", {
          id: "one",
        });
      }
    }

    await expect(
      generated.join(`
/* --- */
`)
    ).toMatchFileSnapshot(file);
  }
);

test.each([
  {
    mode: "from-schema",
    unsafe: true,
  },
] as const)("MongoDB migration using $mode", async (item) => {
  const mongodb = databases.find((db) => db.provider === "mongodb")!.create();
  await resetMongoDB(mongodb);

  const client = TestDB.client(
    mongoAdapter({
      client: mongodb,
    })
  );

  const migrator = client.createMigrator();
  const lines: string[] = [];

  for (let i = 0; i < 3; i++) {
    const { execute } = await migrator.up(item);
    expect((await migrator.next()) != null).toBe(true);

    await execute();

    if (i === 0) {
      const orm = client.orm("1.0.0");
      await orm.create("accounts", {
        id: "one",
      });
    }
  }

  await expect(lines.join("\n")).toMatchFileSnapshot(
    `snapshots/migration/mongodb.${item.mode}.txt`
  );
});
