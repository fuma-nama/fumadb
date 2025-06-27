import { execute, schemaToDBType } from "./execute";
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
        .addColumn("version", schemaToDBType("varchar(255)", provider), (col) =>
          col.notNull()
        )
        .addColumn("id", schemaToDBType("varchar(255)", provider), (col) =>
          col.primaryKey()
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
  const run = async () => {
    for (const op of operations) {
      await execute(op, { db, provider }).execute();
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
  const compiled = operations.map(
    (m) => execute(m, { db, provider }).compile().sql
  );
  return compiled.join(";\n\n") + ";";
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
      const { updateVersion = true } = options;
      const version = await versionManager.get();

      const index =
        schemas.findIndex((schema) => schema.version === version) + 1;
      if (index === schemas.length) throw new Error("Already up to date.");
      const schema = schemas[index]!;
      const context: MigrationContext = {
        auto() {
          return generateMigration(schema, db, provider);
        },
      };

      const run = schema.up ?? (({ auto }) => auto());
      const operations = await run(context);
      if (updateVersion) {
        operations.push({
          type: "kysely-builder",
          value: versionManager.set_sql(schema.version),
        });
      }

      return {
        operations,
        getSQL: () => getSQL(operations, db, provider),
        async execute() {
          await executeOperations(operations, db, provider);
        },
      };
    },
    async down(options = {}) {
      const { updateVersion = true } = options;
      const version = await versionManager.get();
      if (version === initialVersion) throw new Error("Not initialized.");

      const index = schemas.findIndex((schema) => schema.version === version);
      const schema = schemas[index]!;
      const previousSchema = schemas[index - 1] ?? {
        version: initialVersion,
        tables: {},
      };
      const run = schema.down ?? (({ auto }) => auto());

      const context: MigrationContext = {
        async auto() {
          return generateMigration(previousSchema, db, provider, {
            dropUnusedColumns: true,
            detectUnusedTables: Object.values(schema.tables).map(
              ({ name }) => name
            ),
          });
        },
      };

      const operations = await run(context);

      if (updateVersion) {
        operations.push({
          type: "kysely-builder",
          value: versionManager.set_sql(previousSchema.version),
        });
      }

      return {
        operations,
        getSQL: () => getSQL(operations, db, provider),
        execute: () => executeOperations(operations, db, provider),
      };
    },
    async migrateTo(version, options = {}) {
      const { updateVersion = true } = options;
      const targetIdx = schemas.findIndex(
        (schema) => schema.version === version
      );

      if (targetIdx === -1)
        throw new Error(
          `Invalid version: ${version}, supported: ${schemas
            .map((schema) => schema.version)
            .join(", ")}.`
        );

      const currentVersion = await versionManager.get();
      let operations: MigrationOperation[] = [];

      if (currentVersion === initialVersion) {
        operations = await generateMigration(schemas[targetIdx]!, db, provider);
      } else {
        let index = schemas.findIndex(
          (schema) => schema.version === currentVersion
        );

        while (targetIdx > index) {
          operations.push(...(await this.up({ updateVersion })).operations);
          index++;
        }

        while (targetIdx < index) {
          operations.push(...(await this.down({ updateVersion })).operations);
          index--;
        }
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
