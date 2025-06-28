import { Kysely } from "kysely";
import { createMigrator, generateSchema, Migrator } from "./schema";
import { LibraryConfig, PrismaClient } from "./shared/config";
import { Provider, SQLProvider } from "./shared/providers";
import { fromKysely } from "./query/orm/kysely";
import { toORM } from "./query/orm/base";
import { AbstractQuery } from "./query";
import * as Drizzle from "drizzle-orm";
import { fromPrisma } from "./query/orm/prisma";
import { DrizzleDatabase, fromDrizzle } from "./query/orm/drizzle";
import type { DataSource } from "typeorm";
import { fromTypeORM } from "./query/orm/type-orm";
import { fromMongoDB, MongoDBClient } from "./query/orm/mongodb";

export * from "./shared/config";
export * from "./shared/providers";

export type DatabaseConfig =
  | {
      type: "drizzle-orm";
      db: unknown;
      /**
       * All tables in the generated schema (key: import name, value: table object).
       */
      tables: Record<string, Drizzle.Table>;
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
      provider: "mongodb";
    };

export type UserConfig = DatabaseConfig & {
  /**
   * The version of schema for querying, default to latest.
   */
  queryVersion?: string;
};

export interface FumaDB<Lib extends LibraryConfig, User extends UserConfig> {
  options: User;

  readonly abstract: AbstractQuery<Lib["schemas"][number]>;
  /**
   * Kysely only
   */
  createMigrator: () => Promise<Migrator>;

  /**
   * ORM only
   */
  generateSchema: (
    version: Lib["schemas"][number]["version"] | "latest"
  ) => Promise<string>;
}

export function fumadb<Lib extends LibraryConfig>(config: Lib) {
  const schemas = config.schemas;

  return {
    /**
     * a static type checker for schema versions
     */
    version(targetVersion: Lib["schemas"][number]["version"]) {
      return targetVersion;
    },
    /**
     * Configure consumer-side integration
     */
    configure(userConfig: UserConfig): FumaDB<Lib, UserConfig> {
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
          fromDrizzle(
            querySchema,
            userConfig.db as DrizzleDatabase,
            userConfig.tables,
            userConfig.provider
          )
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
