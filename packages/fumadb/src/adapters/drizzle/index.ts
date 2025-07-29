import { FumaDBAdapter } from "../";
import { fromDrizzle } from "./query";
import { generateSchema } from "./generate";
import type { Provider } from "../../shared/providers";

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
      return fromDrizzle(schema, options.db, options.provider);
    },
    generateSchema(schema, schemaName) {
      return {
        code: generateSchema(schema, options.provider),
        path: `./db/${schemaName}.ts`,
      };
    },
  };
}
