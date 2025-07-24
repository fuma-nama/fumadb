import { Kysely } from "kysely";
import { AnySchema, createMigrator, generateSchema, Migrator } from "./schema";
import { DatabaseConfig, LibraryConfig, PrismaConfig } from "./shared/config";
import { SQLProvider } from "./shared/providers";
import { fromKysely } from "./query/orm/kysely";
import { AbstractQuery } from "./query";
import { fromPrisma } from "./query/orm/prisma";
import { fromDrizzle } from "./query/orm/drizzle";
import { fromTypeORM } from "./query/orm/type-orm";
import { fromMongoDB } from "./query/orm/mongodb";

export * from "./shared/config";
export * from "./shared/providers";

export interface KyselyConfig {
  type: "kysely";
  db: Kysely<any>;
  provider: SQLProvider;

  /**
   * Define how foreign keys are handled.
   *
   * - `database`: rely on database's
   */
  foreignKey?: "database" | "virtual";
}

export type UserConfig = DatabaseConfig & {
  /**
   * The version of schema for querying, default to latest.
   */
  queryVersion?: string;
};

export interface FumaDB<Schemas extends AnySchema[] = AnySchema[]> {
  schemas: Schemas;
  options: UserConfig;

  readonly abstract: AbstractQuery<Schemas[number]>;
  /**
   * Kysely only
   */
  createMigrator: () => Promise<Migrator>;

  /**
   * ORM only
   */
  generateSchema: (
    version: Schemas[number]["version"] | "latest"
  ) => Promise<string>;
}

export interface FumaDBFactory<Schemas extends AnySchema[]> {
  version: <T extends Schemas[number]["version"]>(target: T) => T;
  configure: (userConfig: UserConfig) => FumaDB<Schemas>;
}

export type InferFumaDB<Factory extends FumaDBFactory<any>> =
  Factory extends FumaDBFactory<infer Schemas> ? FumaDB<Schemas> : never;

export function fumadb<Schemas extends AnySchema[]>(
  config: LibraryConfig<Schemas>
): FumaDBFactory<Schemas> {
  const schemas = config.schemas;

  return {
    /**
     * a static type checker for schema versions
     */
    version(targetVersion) {
      return targetVersion;
    },
    /**
     * Configure consumer-side integration
     */
    configure(userConfig) {
      const querySchema = schemas.at(-1)!;
      let query;
      if (userConfig.type === "kysely") {
        query = fromKysely(querySchema, userConfig);
      } else if (userConfig.type === "prisma") {
        query = fromPrisma(querySchema, userConfig as PrismaConfig);
      } else if (userConfig.type === "drizzle-orm") {
        query = fromDrizzle(querySchema, userConfig.db, userConfig.provider);
      } else if (userConfig.type === "typeorm") {
        query = fromTypeORM(
          querySchema,
          userConfig.source,
          userConfig.provider
        );
      } else if (userConfig.type === "mongodb") {
        query = fromMongoDB(querySchema, userConfig.client);
      }

      if (!query) throw new Error(`Invalid type: ${userConfig.type}`);

      return {
        options: userConfig,
        schemas,
        async generateSchema(version) {
          if (userConfig.type === "kysely")
            throw new Error("Kysely doesn't support schema API.");
          if (userConfig.type === "mongodb")
            throw new Error("MongoDB doesn't support schema API.");
          let schema;

          if (version === "latest") {
            schema = schemas.at(-1)!;
          } else {
            schema = schemas.find((schema) => schema.version === version);
            if (!schema) throw new Error("Invalid version: " + version);
          }

          return generateSchema(schema, userConfig);
        },

        async createMigrator() {
          if (userConfig.type !== "kysely")
            throw new Error("Only Kysely support migrator API.");

          return createMigrator(config, userConfig);
        },

        get abstract() {
          return query;
        },
      };
    },
  };
}
