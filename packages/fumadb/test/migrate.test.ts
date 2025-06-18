import {
  Schema,
  table,
  MigrationConfig,
  createMigrator,
  Table,
} from "../src/schema";
import { expect, test } from "vitest";
import { Kysely, MysqlDialect, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { createPool } from "mysql2";

const config: MigrationConfig[] = [
  {
    type: "kysely",
    version: "0.0.0",
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
    provider: "postgresql",
  },
  {
    type: "kysely",
    provider: "mysql",
    version: "0.0.0",
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

for (const item of config) {
  test(`generate migration: ${item.type} ${item.provider}`, async () => {
    const schemas = [v1(), v2()];
    const instance = createMigrator(schemas, item);

    for (const schema of schemas) {
      for (const table of Object.values(schema.tables) as Table[]) {
        await item.db.schema.dropTable(table.name).ifExists().execute();
      }
    }

    const generated: string[] = [];
    const file = `snapshots/migration/${item.type}.${item.provider}.sql`;

    while (instance.version !== schemas.at(-1)!.version) {
      const { updateVersion, runMigrations, getSQL } = await instance.up();
      generated.push(getSQL());
      await runMigrations();

      updateVersion();
    }

    await expect(
      generated.join(`
/* --- */
`)
    ).toMatchFileSnapshot(file);
  });
}
