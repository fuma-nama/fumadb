import type { FumaDBAdapter } from "../";
import { fromKysely } from "./query";
import type { KyselyConfig, LibraryConfig } from "../../shared/config";
import { sql, type Kysely } from "kysely";
import type { SQLProvider } from "../../shared/providers";
import { createMigrator, Migrator } from "../../migration-engine/create";
import { generateMigration } from "../../migration-engine/sql/auto-from-database";
import { execute } from "../../migration-engine/sql/execute";
import type { CustomOperation } from "../../migration-engine/shared";

interface ModelNames {
  settings: string;
}

export function kyselyAdapter(config: KyselyConfig): FumaDBAdapter {
  return {
    createORM(schema) {
      return fromKysely(schema, config);
    },
    getSchemaVersion() {
      const manager = createSettingsManager(config.db, config.provider, {
        settings: `private_${this.namespace}_settings`,
      });

      return manager.getSchemaVersion();
    },
    createMigrationEngine() {
      return createSQLMigrator(this, config, {
        settings: `private_${this.namespace}_settings`,
      });
    },
  };
}

function createSQLMigrator(
  lib: LibraryConfig,
  config: KyselyConfig,
  modelNames: ModelNames
): Migrator {
  const manager = createSettingsManager(config.db, config.provider, modelNames);
  function onCustomNode(node: CustomOperation, db: Kysely<any>) {
    const statement = sql.raw(node.sql as string);

    return {
      compile() {
        return statement.compile(db);
      },
      execute() {
        return statement.execute(db);
      },
    };
  }

  return createMigrator({
    libConfig: lib,
    userConfig: config,
    generateMigrationFromDatabase(options) {
      return generateMigration(options.target, config, {
        internalTables: Object.values(modelNames),
        dropUnusedColumns: options.dropUnusedColumns,
      });
    },
    async executor(operations) {
      await config.db.transaction().execute(async (tx) => {
        const txConfig: KyselyConfig = {
          ...config,
          db: tx,
        };

        const nodes = operations.flatMap((op) =>
          execute(op, txConfig, (node) => onCustomNode(node, tx))
        );

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
    settings: {
      getVersion: () => manager.getSchemaVersion(),
      async updateVersionInMigration(version) {
        const statements = await manager.setVersionAsSQL(version);

        return statements.map((statement) => ({
          type: "custom",
          sql: statement,
        }));
      },
    },
    sql: {
      toSql(operations) {
        const compiled = operations
          .flatMap((op) =>
            execute(op, config, (node) => onCustomNode(node, config.db))
          )
          .map((m) => `${m.compile().sql};`);

        return compiled.join("\n\n");
      },
    },
  });
}

function createSettingsManager(
  db: Kysely<any>,
  provider: SQLProvider,
  modelNames: ModelNames
) {
  const { settings } = modelNames;

  function initTable() {
    return db.schema
      .createTable(settings)
      .addColumn(
        "key",
        provider === "sqlite" ? "text" : "varchar(255)",
        (col) => col.primaryKey()
      )
      .addColumn(
        "value",
        provider === "sqlite" ? "text" : "varchar(255)",
        (col) => col.notNull()
      );
  }

  return {
    async getSchemaVersion(): Promise<string | undefined> {
      try {
        const result = await db
          .selectFrom(settings)
          .where("key", "=", "version")
          .select(["value"])
          .executeTakeFirstOrThrow();
        return result.value as string;
      } catch {
        return;
      }
    },
    async setVersionAsSQL(version: string) {
      const lines: string[] = [];
      const tables = await db.introspection.getTables();

      if (tables.some((table) => table.name === settings)) {
        lines.push(
          db
            .updateTable(settings)
            .set({
              value: sql.lit(version),
            })
            .where("key", "=", sql.lit("version"))
            .compile().sql
        );

        return lines;
      }

      lines.push(initTable().compile().sql);
      lines.push(
        db
          .insertInto(settings)
          .values({
            key: sql.lit("version"),
            value: sql.lit(version),
          })
          .compile().sql
      );

      return lines;
    },
  };
}
