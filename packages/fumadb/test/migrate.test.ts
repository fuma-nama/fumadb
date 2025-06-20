import { Schema, table, createMigrator } from "../src/schema";
import { expect, test } from "vitest";
import { Kysely, MysqlDialect, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { createPool } from "mysql2";
import { LibraryConfig } from "../src/shared/config";

const config = [
  {
    db: new Kysely({
      dialect: new PostgresDialect({
        pool: new Pool({
          database: "postgresql",
          host: "localhost",
          user: "user",
          password: "password",
          port: 5434,
          max: 10,
        }),
      }),
    }),
    provider: "postgresql" as const,
  },
  {
    provider: "mysql" as const,
    db: new Kysely({
      dialect: new MysqlDialect({
        pool: createPool({
          database: "mysql",
          host: "localhost",
          user: "root",
          password: "password",
          port: 3308,
          connectionLimit: 10,
        }),
      }),
    }),
  },
];

const v1 = () => {
  const users = table("users", {
    id: {
      name: "id",
      type: "integer",
      default: "autoincrement",
      primarykey: true,
    },
    image: {
      name: "image",
      type: "varchar(200)",
      nullable: true,
      default: {
        value: "my-avatar",
      },
    },
  });

  const accounts = table("accounts", {
    id: {
      name: "secret_id",
      type: "varchar(255)",
      primarykey: true,
    },
  });

  const schema = {
    version: "1.0.0",
    tables: {
      users,
      accounts,
    },
    async up({ auto }) {
      return auto();
    },
  } satisfies Schema;

  return schema;
};

const v2 = () => {
  const users = table("users", {
    id: {
      name: "id",
      type: "integer",
      default: "autoincrement",
      primarykey: true,
    },
    name: {
      name: "name",
      type: "varchar(255)",
    },
    email: {
      name: "email",
      type: "varchar(255)",
    },
    image: {
      name: "image",
      type: "varchar(200)",
      nullable: true,
      default: {
        value: "my-avatar",
      },
    },
  });

  const accounts = table(
    "accounts",
    {
      id: {
        name: "secret_id",
        type: "varchar(255)",
      },
      email: {
        name: "email",
        type: "varchar(255)",
      },
    },
    {
      keys: ["id", "email"],
    }
  );

  return {
    version: "2.0.0",
    tables: {
      users,
      accounts,
    },
  } satisfies Schema;
};

const libConfig: LibraryConfig = {
  namespace: "test",
  schemas: [v1(), v2()],
};

for (const item of config) {
  test(`generate migration: ${item.provider}`, async () => {
    const instance = await createMigrator(libConfig, item.db, item.provider);
    await instance.migrateToLatest().then((op) => op.execute());

    while (await instance.hasPrevious()) {
      await instance.down().then((op) => op.execute());
    }

    const generated: string[] = [];
    const file = `snapshots/migration/kysely.${item.provider}.sql`;

    while (await instance.hasNext()) {
      const { execute, getSQL } = await instance.up();
      generated.push(getSQL());
      await execute();
    }

    await expect(
      generated.join(`
/* --- */
`)
    ).toMatchFileSnapshot(file);
  });
}
