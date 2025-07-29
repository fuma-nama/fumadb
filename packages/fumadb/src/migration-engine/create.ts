import { generateMigration } from "./sql/auto-from-database";
import { getInternalTables, MigrationOperation } from "./shared";
import type { LibraryConfig, RelationMode } from "../shared/config";
import type { Kysely } from "kysely";
import type { Provider } from "../shared/providers";
import { AnySchema, schema } from "../schema/create";
import { generateMigrationFromSchema } from "./auto-from-schema";

type Awaitable<T> = T | Promise<T>;

interface MigrationContext {
  auto: () => Promise<MigrationOperation[]>;
}

export type CustomMigrationFn = (
  context: MigrationContext
) => Awaitable<MigrationOperation[]>;

export interface MigrateOptions {
  /**
   * Manage how migrations are generated.
   *
   * - `from-schema` (default): compare fumadb schemas
   * - `from-database`: introspect & compare the database with schema
   */
  mode?: "from-schema" | "from-database";
  updateVersion?: boolean;

  /**
   * Enable unsafe operations when auto-generating migration.
   */
  unsafe?: boolean;
}

export interface VersionManager {
  get(): Promise<string>;
  set(version: string): Promise<void>;
  setAsSQL?: (version: string, kysely?: Kysely<any>) => string;
}

export interface MigrationResult {
  operations: MigrationOperation[];
  getSQL?: () => string;
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

export interface MigrationEngineOptions extends LibraryConfig {
  provider: Provider;
  createVersionManager: () => VersionManager;
  executor: (operations: MigrationOperation[]) => Promise<void>;
  toSql?: (operations: MigrationOperation[]) => string;

  kysely?: Kysely<any>;
  relationMode?: RelationMode;
}

export function createMigrator({
  createVersionManager,
  schemas,
  initialVersion = "0.0.0",
  namespace,
  provider,
  kysely,
  relationMode,
  executor,
  toSql,
}: MigrationEngineOptions): Migrator {
  const internalTables = getInternalTables(namespace);
  const versionManager = createVersionManager();
  const indexedSchemas = new Map<string, AnySchema>();

  indexedSchemas.set(
    initialVersion,
    schema({
      version: initialVersion,
      tables: {},
    })
  );

  for (const schema of schemas) {
    if (indexedSchemas.has(schema.version))
      throw new Error(`Duplicated version: ${schema.version}`);

    indexedSchemas.set(schema.version, schema);
  }

  function getSchemaByVersion(version: string) {
    const schema = indexedSchemas.get(version);
    if (!schema) throw new Error(`Invalid version ${version}`);
    return schema;
  }

  const instance: Migrator = {
    get versionManager() {
      return versionManager;
    },
    async hasNext() {
      const version = await versionManager.get();
      const index = schemas.indexOf(getSchemaByVersion(version));

      return index + 1 < schemas.length;
    },
    async hasPrevious() {
      const version = await versionManager.get();
      const index = schemas.indexOf(getSchemaByVersion(version));

      return index > 0;
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
      const index = schemas.indexOf(getSchemaByVersion(version)) - 1;

      if (index < 0) throw new Error("No previous schema to migrate to.");

      return this.migrateTo(schemas[index]!.version, options);
    },
    async migrateTo(version, options = {}) {
      const {
        updateVersion = true,
        unsafe = false,
        mode = "from-schema",
      } = options;
      const targetSchema = getSchemaByVersion(version);
      const targetSchemaIdx = schemas.indexOf(targetSchema);

      const currentVersion = await versionManager.get();
      const currentSchema = getSchemaByVersion(currentVersion);
      const currentSchemaIdx = schemas.indexOf(currentSchema);

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
          if (mode === "from-schema") {
            return generateMigrationFromSchema(currentSchema, targetSchema, {
              provider,
              db: kysely,
              relationMode,
              dropUnusedColumns: unsafe,
              dropUnusedTables: unsafe,
            });
          }

          if (!kysely || provider === "mongodb")
            throw new Error(`${mode} is not supported for MongoDB yet.`);

          return generateMigration(
            targetSchema,
            {
              db: kysely,
              provider,
              relationMode,
            },
            {
              internalTables: Object.values(internalTables),
              unsafe,
            }
          );
        },
      };

      const operations = await run(context);

      return {
        operations,
        getSQL: toSql
          ? () => {
              const sql = toSql(operations);

              if (updateVersion && versionManager.setAsSQL)
                return `${sql}\n\n${versionManager.setAsSQL(targetSchema.version)};`;

              return sql;
            }
          : undefined,
        async execute() {
          await executor(operations);
          if (updateVersion) await versionManager.set(targetSchema.version);
        },
      };
    },
    async migrateToLatest(options) {
      return this.migrateTo(schemas.at(-1)!.version, options);
    },
  };

  return instance;
}
