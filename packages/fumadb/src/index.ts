import { Kysely } from "kysely";
import { AnySchema, createMigrator, generateSchema, Migrator } from "./schema";
import { LibraryConfig } from "./shared/config";
import { PrismaClient } from "./shared/prisma";
import { Provider, SQLProvider } from "./shared/providers";
import { fromKysely } from "./query/orm/kysely";
import { toORM } from "./query/orm/base";
import { AbstractQuery } from "./query";
import { fromPrisma } from "./query/orm/prisma";
import { fromDrizzle } from "./query/orm/drizzle";
import type { DataSource } from "typeorm";
import { fromTypeORM } from "./query/orm/type-orm";
import { fromMongoDB, MongoDBClient } from "./query/orm/mongodb";

export * from "./shared/config";
export * from "./shared/providers";

export type DatabaseConfig =
  | {
      type: "drizzle-orm";
      /**
       * Drizzle instance, must have query mode configured: https://orm.drizzle.team/docs/rqb.
       */
      db: unknown;
      provider: Exclude<Provider, "cockroachdb" | "mongodb" | "mssql">;
    }
  | {
      type: "prisma";
      provider: Provider;
      prisma: unknown;
    }
  | {
      type: "kysely";
      db: Kysely<any>;
      provider: SQLProvider;
    }
  | {
      type: "typeorm";
      source: DataSource;
      provider: Exclude<SQLProvider, "cockroachdb">;
    }
  | {
      type: "mongodb";
      client: MongoDBClient;
    };

export type UserConfig = DatabaseConfig & {
  /**
   * The version of schema for querying, default to latest.
   */
  queryVersion?: string;
};

export interface FumaDB<
  Schemas extends AnySchema[] = AnySchema[],
  User extends UserConfig = UserConfig
> {
  schemas: Schemas;
  options: User;

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

export function fumadb<Schemas extends AnySchema[]>(
  config: LibraryConfig<Schemas>
) {
  const schemas = config.schemas;

  return {
    /**
     * a static type checker for schema versions
     */
    version(targetVersion: Schemas[number]["version"]) {
      return targetVersion;
    },
    /**
     * Configure consumer-side integration
     */
    configure(userConfig: UserConfig): FumaDB<Schemas, UserConfig> {
      const querySchema = schemas.at(-1)!;
      let query;
      if (userConfig.type === "kysely") {
        query = toORM(
          fromKysely(querySchema, userConfig.db, userConfig.provider)
        );
      } else if (userConfig.type === "prisma") {
        query = toORM(
          fromPrisma(querySchema, userConfig.prisma as PrismaClient)
        );
      } else if (userConfig.type === "drizzle-orm") {
        query = toORM(
          fromDrizzle(querySchema, userConfig.db, userConfig.provider)
        );
      } else if (userConfig.type === "typeorm") {
        query = toORM(
          fromTypeORM(querySchema, userConfig.source, userConfig.provider)
        );
      } else if (userConfig.type === "mongodb") {
        query = toORM(fromMongoDB(querySchema, userConfig.client));
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

          return createMigrator(config, userConfig.db, userConfig.provider);
        },

        get abstract() {
          return query;
        },
      };
    },
  };
}
