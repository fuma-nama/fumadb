import {
  AnySchema,
  table,
  createMigrator,
  column,
  idColumn,
} from "../src/schema";
import { expect, test } from "vitest";
import { LibraryConfig } from "../src/shared/config";
import { kyselyTests } from "./shared";

const v1 = () => {
  const users = table("users", {
    id: idColumn("id", "varchar(255)", {
      default: "auto",
    }),
    image: column("image", "varchar(200)", {
      nullable: true,
      default: { value: "my-avatar" },
    }),
  });

  const accounts = table("accounts", {
    id: idColumn("secret_id", "varchar(255)"),
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
  } satisfies AnySchema;

  return schema;
};

const v2 = () => {
  const users = table("users", {
    id: idColumn("id", "varchar(255)", { default: "auto" }),
    name: column("name", "varchar(255)"),
    email: column("email", "varchar(255)"),
    image: column("image", "varchar(200)", {
      nullable: true,
      default: { value: "my-avatar" },
    }),
  });

  const accounts = table("accounts", {
    id: idColumn("secret_id", "varchar(255)"),
    email: column("email", "varchar(255)"),
  });

  return {
    version: "2.0.0",
    tables: {
      users,
      accounts,
    },
  } satisfies AnySchema;
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
