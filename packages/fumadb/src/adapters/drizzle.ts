import { FumaDBAdapter } from ".";
import { AbstractQuery } from "../query";
import { fromDrizzle } from "../query/orm/drizzle";
import { generateSchema } from "../schema/generate/drizzle";
import type { Provider } from "../shared/providers";

export interface DrizzleConfig {
  /**
   * Drizzle instance, must have query mode configured: https://orm.drizzle.team/docs/rqb.
   */
  db: unknown;
  provider: Exclude<Provider, "cockroachdb" | "mongodb" | "mssql" | "convex">;
}

export function drizzleAdapter(options: DrizzleConfig): FumaDBAdapter {
  return {
    createORM(schema) {
      return fromDrizzle(
        schema,
        options.db,
        options.provider
      ) as AbstractQuery<any>;
    },
    generateSchema(schema, schemaName) {
      return {
        code: generateSchema(schema, options.provider),
        path: `./db/${schemaName}.ts`,
      };
    },
  };
}
