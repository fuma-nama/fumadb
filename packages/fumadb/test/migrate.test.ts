import { table, createMigrator, column, idColumn, schema } from "../src/schema";
import { expect, test } from "vitest";
import { LibraryConfig } from "../src/shared/config";
import { kyselyTests, resetDB } from "./shared";

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

const v2 = () => {
  const users = table("users", {
    id: idColumn("id", "varchar(255)", { default: "auto" }),
    name: column("name", "varchar(255)"),
    email: column("email", "varchar(255)"),
    image: column("image", "varchar(200)", {
      nullable: true,
      default: { value: "another-avatar" },
    }),
  });

  const accounts = table("accounts", {
    id: idColumn("secret_id", "varchar(255)"),
    email: column("email", "varchar(255)"),
  });

  return schema({
    version: "2.0.0",
    tables: {
      users,
      accounts,
    },
    relations: {
      users: (b) => ({
        account: b.one(accounts, ["email", "id"]).foreignKey({
          onDelete: "CASCADE",
        }),
      }),
      accounts: (b) => ({
        user: b.one(users),
      }),
    },
  });
};

const v3 = () => {
  const users = table("users", {
    id: idColumn("id", "varchar(255)", { default: "auto" }),
    name: column("name", "varchar(255)"),
    email: column("email", "varchar(255)"),
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

for (const item of kyselyTests) {
  test(`generate migration: ${item.provider}`, async () => {
    await resetDB(item.provider);

    const instance = await createMigrator(libConfig, item.db, item.provider);
    const generated: string[] = [];
    const file = `snapshots/migration/kysely.${item.provider}.sql`;

    while (await instance.hasNext()) {
      const { execute, getSQL } = await instance.up({
        unsafe: true,
      });
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
