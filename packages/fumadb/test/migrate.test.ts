import { Schema, table, createMigrator } from "../src/schema";
import { expect, test } from "vitest";
import { LibraryConfig } from "../src/shared/config";
import { kyselyTests } from "./shared";

const v1 = () => {
  const users = table("users", {
    id: {
      name: "id",
      type: "varchar(255)",
      default: "auto",
      id: true,
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
      type: "varchar(255)",
      default: "auto",
      id: true,
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

for (const item of kyselyTests) {
  test(`generate migration: ${item.provider}`, async () => {
    await item.db.schema.dropTable("users").ifExists().execute();
    await item.db.schema.dropTable("accounts").ifExists().execute();

    const instance = await createMigrator(libConfig, item.db, item.provider);
    await instance.versionManager.set_sql("0.0.0").execute();
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
