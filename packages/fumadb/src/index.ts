import { abstractQuery } from "./query";
import { createMigrator } from "./schema";
import { LibraryConfig, UserConfig } from "./shared/config";

export * from "./shared/config";
export * from "./shared/providers";

export function fumadb<LibConfig extends LibraryConfig>(config: LibConfig) {
  const schemas = config.schemas;

  return {
    /**
     * Configure consumer-side integration
     */
    configure<
      C extends UserConfig & {
        targetVersion: LibConfig["schemas"][number]["version"];
      }
    >(userConfig: C) {
      const query = abstractQuery(schemas.at(-1)!);

      return {
        config: userConfig,

        async createMigrator() {
          return createMigrator(config, userConfig);
        },

        get abstract() {
          return query;
        },
      };
    },
  };
}
