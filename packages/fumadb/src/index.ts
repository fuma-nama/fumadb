import { Kysely } from "kysely";
import { abstractQuery } from "./query";
import {
  createMigrator,
  GenerateConfig,
  generateSchema,
  Migrator,
} from "./schema";
import { LibraryConfig } from "./shared/config";
import { NoSQLProvider, noSqlProviders, SQLProvider } from "./shared/providers";

export * from "./shared/config";
export * from "./shared/providers";

export type UserConfig = {
  type: "kysely";
  provider: SQLProvider;
  db: Kysely<any>;
};

export interface FumaDB<Lib extends LibraryConfig, User extends UserConfig> {
  options: User;

  readonly abstract: ReturnType<typeof abstractQuery<Lib["schemas"][number]>>;
  createMigrator: () => Promise<Migrator>;
  generateSchema: (
    version: Lib["schemas"][number]["version"] | "latest",
    options: GenerateConfig
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
      const query = abstractQuery(schemas.at(-1)!);

      return {
        options: userConfig,
        async generateSchema(version, options) {
          let schema;

          if (version === "latest") {
            schema = schemas.at(-1)!;
          } else {
            schema = schemas.find((schema) => schema.version === version);
            if (!schema) throw new Error("Invalid version: " + version);
          }

          return generateSchema(schema, options);
        },

        async createMigrator() {
          const provider = userConfig.provider;
          if (noSqlProviders.includes(provider as NoSQLProvider))
            throw new Error(
              `Your provider ${provider} is not a SQL database, which is not supported with createMigrator().`
            );

          return createMigrator(
            config,
            userConfig.db,
            userConfig.provider as SQLProvider
          );
        },

        get abstract() {
          return query;
        },
      };
    },
  };
}
