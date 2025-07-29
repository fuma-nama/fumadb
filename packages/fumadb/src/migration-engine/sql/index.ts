import { Kysely } from "kysely";
import { KyselyConfig, LibraryConfig } from "../../shared/config";
import { SQLProvider } from "../../shared/providers";
import { getInternalTables } from "../../migration-engine/shared";
import { VersionManager } from "../create";
import { execute } from "./execute";
import { createMigrator, Migrator } from "../create";

export function createSQLMigrator(
  lib: LibraryConfig,
  config: KyselyConfig
): Migrator {
  return createMigrator({
    ...lib,
    createVersionManager: () =>
      createVersionManager(lib, config.db, config.provider),
    async executor(operations) {
      await config.db.transaction().execute(async (tx) => {
        const txConfig: KyselyConfig = {
          ...config,
          db: tx,
        };
        const nodes = operations.flatMap((op) => execute(op, txConfig));

        for (const node of nodes) {
          try {
            await node.execute();
          } catch (e) {
            console.error("failed at", node.compile(), e);
            throw e;
          }
        }
      });
    },
    toSql(operations) {
      const compiled = operations
        .flatMap((op) => execute(op, config))
        // TODO: fill parameters
        .map((m) => m.compile().sql + ";");

      return compiled.join("\n\n");
    },
    provider: config.provider,
    kysely: config.db,
    relationMode: config.relationMode,
  });
}

function createVersionManager(
  lib: LibraryConfig,
  db: Kysely<any>,
  provider: SQLProvider
): VersionManager {
  const { initialVersion = "0.0.0" } = lib;
  const { versions } = getInternalTables(lib.namespace);
  const id = "default";

  async function init() {
    await db.schema
      .createTable(versions)
      .addColumn(
        "version",
        provider === "sqlite" ? "text" : "varchar(255)",
        (col) => col.notNull()
      )
      .addColumn("id", provider === "sqlite" ? "text" : "varchar(255)", (col) =>
        col.primaryKey()
      )
      // alternative for if not exists for mssql
      .execute()
      .catch(() => null);

    const result = await db
      .selectFrom(versions)
      .select(db.fn.count("id").as("count"))
      .executeTakeFirst();

    if (!result || Number(result.count) === 0) {
      await db
        .insertInto(versions)
        .values({
          id,
          version: initialVersion,
        })
        .execute();
    }
  }

  return {
    async get() {
      await init();

      const result = await db
        .selectFrom(versions)
        .where("id", "=", id)
        .select(["version"])
        .executeTakeFirstOrThrow();

      return result.version as string;
    },
    async set(version) {
      await init();

      await db
        .updateTable(versions)
        .set({
          id,
          version,
        })
        .where("id", "=", id)
        .execute();
    },
    setAsSQL(version: string, kysely = db) {
      return kysely
        .updateTable(versions)
        .set({
          id,
          version,
        })
        .where("id", "=", id)
        .compile().sql;
    },
  };
}
