import { type MigrationOperation } from "./shared";
import type { LibraryConfig, RelationMode } from "../shared/config";
import type { Provider } from "../shared/providers";
import { type AnySchema, schema } from "../schema/create";
import { generateMigrationFromSchema as defaultGenerateMigrationFromSchema } from "./auto-from-schema";

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

export interface MigrationResult {
  operations: MigrationOperation[];
  getSQL?: () => string;
  execute: () => Promise<void>;
}

export interface Migrator {
  /**
   * Get current version
   */
  getVersion: () => Promise<string>;
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

export interface MigrationEngineOptions {
  libConfig: LibraryConfig;
  userConfig: {
    provider: Provider;
    relationMode?: RelationMode;
  };

  executor: (operations: MigrationOperation[]) => Promise<void>;

  generateMigrationFromSchema?: typeof defaultGenerateMigrationFromSchema;

  generateMigrationFromDatabase?: (options: {
    target: AnySchema;
    dropUnusedColumns: boolean;
  }) => Awaitable<MigrationOperation[]>;

  settings: {
    getVersion: () => Promise<string | undefined>;

    updateVersionInMigration: (
      version: string
    ) => Awaitable<MigrationOperation[]>;
  };

  sql?: {
    toSql: (operations: MigrationOperation[]) => string;
  };
}

export function createMigrator({
  settings,
  generateMigrationFromDatabase,
  generateMigrationFromSchema = defaultGenerateMigrationFromSchema,
  libConfig: { schemas, initialVersion = "0.0.0" },
  userConfig,
  executor,
  sql: sqlConfig,
}: MigrationEngineOptions): Migrator {
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
    async getVersion() {
      return (await settings.getVersion()) ?? initialVersion;
    },
    async hasNext() {
      const version = await settings.getVersion();
      if (!version) return true;
      const index = schemas.indexOf(getSchemaByVersion(version));

      return index + 1 < schemas.length;
    },
    async hasPrevious() {
      const version = await settings.getVersion();
      if (!version) return false;
      const index = schemas.indexOf(getSchemaByVersion(version));

      return index > 0;
    },
    async up(options = {}) {
      const version = (await settings.getVersion()) ?? initialVersion;

      const index =
        schemas.findIndex((schema) => schema.version === version) + 1;
      if (index >= schemas.length) throw new Error("Already up to date.");

      return this.migrateTo(schemas[index]?.version, options);
    },
    async down(options = {}) {
      const version = (await settings.getVersion()) ?? initialVersion;
      const index = schemas.indexOf(getSchemaByVersion(version)) - 1;

      if (index < 0) throw new Error("No previous schema to migrate to.");

      return this.migrateTo(schemas[index]?.version, options);
    },
    async migrateTo(version, options = {}) {
      const {
        updateVersion = true,
        unsafe = false,
        mode = "from-schema",
      } = options;
      const targetSchema = getSchemaByVersion(version);
      const targetSchemaIdx = schemas.indexOf(targetSchema);

      const currentVersion = (await settings.getVersion()) ?? initialVersion;
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
              ...userConfig,
              dropUnusedColumns: unsafe,
              dropUnusedTables: unsafe,
            });
          }

          if (!generateMigrationFromDatabase)
            throw new Error(`${mode} is not supported for this adapter.`);

          return generateMigrationFromDatabase({
            target: targetSchema,
            dropUnusedColumns: unsafe,
          });
        },
      };

      const operations = await run(context);

      if (updateVersion) {
        operations.push(...(await settings.updateVersionInMigration(version)));
      }

      return {
        operations,
        getSQL: sqlConfig ? () => sqlConfig.toSql(operations) : undefined,
        execute: () => executor(operations),
      };
    },
    async migrateToLatest(options) {
      return this.migrateTo(schemas.at(-1)!.version, options);
    },
  };

  return instance;
}
