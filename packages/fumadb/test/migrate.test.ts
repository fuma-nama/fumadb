import { table, column, idColumn, schema } from "../src/schema";
import { expect, test } from "vitest";
import { LibraryConfig } from "../src/shared/config";
import { kyselyTests, resetDB } from "./shared";
import { createMigrator, MigrateOptions } from "../src/schema/migrate";

const v1 = () => {
  const users = table("users", {
    id: idColumn("id", "varchar(255)", {
      default: "auto",
    }),
    image: column("image", "varchar(200)", {
      nullable: true,
      default: { value: "my-avatar" },
    }),
    data: column("data", "binary", {
      nullable: true,
    }),
  });

  const accounts = table("accounts", {
    id: idColumn("secret_id", "varchar(255)"),
  });

  return schema({
    version: "1.0.0",
    tables: {
      users,
      accounts,
    },
  });
};

// add columns of different data types
// add father relations
const v2 = () => {
  const users = table("users", {
    id: idColumn("id", "varchar(255)", { default: "auto" }),
    name: column("name", "varchar(255)"),
    email: column("email", "varchar(255)"),
    image: column("image", "string", {
      nullable: true,
      default: { value: "another-avatar" },
    }),
    stringColumn: column("string", "string", { nullable: true }),
    bigintColumn: column("bigint", "bigint", { nullable: true }),
    integerColumn: column("integer", "integer", { nullable: true }),
    decimalColumn: column("decimal", "decimal", { nullable: true }),
    boolColumn: column("bool", "bool", { nullable: true }),
    jsonColumn: column("json", "json", { nullable: true }),
    binaryColumn: column("binary", "binary", { nullable: true }),
    dateColumn: column("date", "date", { nullable: true }),
    timestampColumn: column("timestamp", "timestamp", { nullable: true }),

    fatherId: column("fatherId", "varchar(255)", {
      nullable: true,
      unique: true,
    }),
  });

  const accounts = table("accounts", {
    id: idColumn("secret_id", "varchar(255)"),
    email: column("email", "varchar(255)", {
      unique: true,
    }),
  });

  return schema({
    version: "2.0.0",
    tables: {
      users,
      accounts,
    },
    relations: {
      users: (b) => ({
        account: b
          .one(accounts, ["email", "id"])
          .foreignKey({
            onDelete: "CASCADE",
          })
          .imply("user"),
        father: b.one(users, ["fatherId", "id"]).foreignKey().imply("son"),
        son: b.one(users),
      }),
      accounts: (b) => ({
        user: b.one(users),
      }),
    },
  });
};

// remove v2 new columns & relations
// remove unique from accounts, and add to users
const v3 = () => {
  const users = table("users", {
    id: idColumn("id", "varchar(255)", { default: "auto" }),
    name: column("name", "varchar(255)"),
    email: column("email", "varchar(255)", {
      unique: true,
    }),
    image: column("image", "string", {
      nullable: true,
    }),
  });

  const accounts = table("accounts", {
    id: idColumn("secret_id", "varchar(255)"),
    email: column("email", "varchar(255)"),
  });

  return schema({
    version: "3.0.0",
    tables: {
      users,
      accounts,
    },
    relations: {
      users: (b) => ({
        account: b.one(accounts, ["email", "id"]).foreignKey(),
      }),
      accounts: (b) => ({
        user: b.one(users),
      }),
    },
  });
};

const libConfig: LibraryConfig = {
  namespace: "test",
  schemas: [v1(), v2(), v3()],
};

const testOptions: MigrateOptions[] = [
  {
    mode: "from-database",
    unsafe: true,
  },
  {
    mode: "from-schema",
    unsafe: true,
  },
];

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
    const instance = await createMigrator(libConfig, item);
    const generated: string[] = [];

    while (await instance.hasNext()) {
      const { execute, getSQL } = await instance.up(item);
      generated.push(getSQL());
      await execute();
    }

    await expect(
      generated.join(`
/* --- */
`)
    ).toMatchFileSnapshot(file);
  }
);
