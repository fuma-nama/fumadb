import { execute } from "./execute";
import { generateMigration } from "./auto";
import { MigrationOperation } from "./shared";
import { LibraryConfig } from "../../shared/config";
import { Kysely } from "kysely";
import { SQLProvider } from "../../shared/providers";

export type Awaitable<T> = T | Promise<T>;

export interface MigrationContext {
  auto: () => Promise<MigrationOperation[]>;
}

export interface MigrateOptions {
  updateVersion?: boolean;
}

export type VersionManager = ReturnType<typeof createVersionManager>;

function createVersionManager(
  lib: LibraryConfig,
  db: Kysely<any>,
  provider: SQLProvider
) {
  const { initialVersion = "0.0.0" } = lib;
  const name = `private_${lib.namespace}_version`;
  const id = "default";

  return {
    async init() {
      await db.schema
        .createTable(name)
        .ifNotExists()
        .addColumn(
          "version",
          provider === "sqlite" ? "text" : "varchar(255)",
          (col) => col.notNull()
        )
        .addColumn(
          "id",
          provider === "sqlite" ? "text" : "varchar(255)",
          (col) => col.primaryKey()
        )
        .execute();

      const result = await db
        .selectFrom(name)
        .select(db.fn.count("id").as("count"))
        .executeTakeFirst();

      if (!result || Number(result.count) === 0) {
        await db
          .insertInto(name)
          .values({
            id,
            version: initialVersion,
          })
          .execute();
      }
    },
    async get() {
      await this.init();

      const result = await db
        .selectFrom(name)
        .where("id", "=", id)
        .select(["version"])
        .limit(1)
        .executeTakeFirstOrThrow();

      return result.version as string;
    },
    set_sql(version: string) {
      return db
        .updateTable(name)
        .set({
          id,
          version,
        })
        .where("id", "=", id);
    },
  };
}

async function executeOperations(
  operations: MigrationOperation[],
  db: Kysely<unknown>,
  provider: SQLProvider
) {
  const executeNodes = operations.flatMap((op) =>
    execute(op, { db, provider })
  );

  const run = async () => {
    for (const node of executeNodes) {
      await node.execute();
    }
  };

  if (provider === "mysql" || provider === "postgresql") {
    await db.transaction().execute(run);
  } else {
    await run();
  }
}

function getSQL(
  operations: MigrationOperation[],
  db: Kysely<unknown>,
  provider: SQLProvider
) {
  const compiled = operations
    .flatMap((op) => execute(op, { db, provider }))
    .map((m) => m.compile().sql + ";");

  return compiled.join("\n\n");
}

export interface MigrationResult {
  operations: MigrationOperation[];
  getSQL: () => string;
  execute: () => Promise<void>;
}

export interface Migrator {
  /**
   * @internal
   */
  readonly versionManager: VersionManager;

  hasNext: () => Promise<boolean>;
  hasPrevious: () => Promise<boolean>;
  up: (options?: MigrateOptions) => Promise<MigrationResult>;
  down: (options?: MigrateOptions) => Promise<MigrationResult>;
  migrateTo: (
    version: string,
    options?: MigrateOptions
  ) => Promise<MigrationResult>;
  migrateToLatest: (options?: MigrateOptions) => Promise<MigrationResult>;
}

export async function createMigrator(
  lib: LibraryConfig,
  db: Kysely<unknown>,
  provider: SQLProvider
): Promise<Migrator> {
  const { schemas, initialVersion = "0.0.0" } = lib;
  const versionManager = createVersionManager(lib, db, provider);
  await versionManager.init();

  function getSchema(index: number) {
    return index === -1
      ? {
          version: initialVersion,
          tables: {},
        }
      : schemas[index]!;
  }

  const instance: Migrator = {
    get versionManager() {
      return versionManager;
    },
    async hasNext() {
      const version = await versionManager.get();
      const index = schemas.findIndex((schema) => schema.version === version);

      return index + 1 < schemas.length;
    },
    async hasPrevious() {
      const version = await versionManager.get();
      const index = schemas.findIndex((schema) => schema.version === version);

      return index >= 0;
    },
    async up(options = {}) {
      const version = await versionManager.get();

      const index =
        schemas.findIndex((schema) => schema.version === version) + 1;
      if (index >= schemas.length) throw new Error("Already up to date.");

      return this.migrateTo(schemas[index]!.version, options);
    },
    async down(options = {}) {
      const version = await versionManager.get();
      const index =
        schemas.findIndex((schema) => schema.version === version) - 1;
      if (index < 0) throw new Error("No previous schema to migrate to.");

      return this.migrateTo(schemas[index]!.version, options);
    },
    async migrateTo(version, options = {}) {
      const { updateVersion = true } = options;
      const targetSchemaIdx = schemas.findIndex(
        (schema) => schema.version === version
      );
      if (targetSchemaIdx === -1)
        throw new Error("Cannot find the target schema version.");
      const targetSchema = schemas[targetSchemaIdx]!;

      const currentVersion = await versionManager.get();
      let currentSchemaIdx = -1;

      if (currentVersion !== initialVersion) {
        currentSchemaIdx = schemas.findIndex(
          (schema) => schema.version === currentVersion
        );

        if (currentSchemaIdx === -1)
          throw new Error(
            `Cannot find the current schema version ${currentVersion}.`
          );
      }

      const currentSchema = getSchema(currentSchemaIdx);
      let run:
        | ((context: MigrationContext) => Awaitable<MigrationOperation[]>)
        | undefined;

      if (currentSchemaIdx - targetSchemaIdx === -1) {
        run = targetSchema.up;
      } else if (currentSchemaIdx - targetSchemaIdx === 1) {
        run = targetSchema.down;
      }

      run ??= (context) => context.auto();

      const context: MigrationContext = {
        async auto() {
          return generateMigration(targetSchema, db, provider, {
            // avoid data loss
            dropUnusedColumns: false,
            detectUnusedTables: Object.values(currentSchema.tables).map(
              ({ name }) => name
            ),
          });
        },
      };

      const operations = await run(context);

      if (updateVersion) {
        operations.push({
          type: "kysely-builder",
          value: versionManager.set_sql(targetSchema.version),
        });
      }

      return {
        operations,
        getSQL: () => getSQL(operations, db, provider),
        execute: () => executeOperations(operations, db, provider),
      };
    },
    async migrateToLatest(options) {
      return this.migrateTo(schemas.at(-1)!.version, options);
    },
  };

  return instance;
}
