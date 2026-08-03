import { column, idColumn, table } from "../../schema";
import type { Provider } from "../../shared/providers";
import type { FumaDBAdapter } from "../";
import { generateSchema } from "./generate";
import { fromDrizzle } from "./query";
import { parseDrizzle, resolveRelationsVersion } from "./shared";

export interface DrizzleConfig {
  /**
   * Drizzle instance with query mode configured:
   * - 0.x: `drizzle({ client, schema })`
   * - 1.x: `drizzle({ client, relations })` from `defineRelations()`
   * 
   * See Docs:
   * - https://orm.drizzle.team/docs/rqb
   * - https://orm.drizzle.team/docs/relations-v1-v2
   */
  db: unknown;
  provider: Exclude<Provider, "cockroachdb" | "mongodb" | "mssql" | "convex">;
}

export function drizzleAdapter(options: DrizzleConfig): FumaDBAdapter {
  const settingsTableName = (namespace: string) => `private_${namespace}_settings`;

  return {
    name: "drizzle",
    createORM(schema) {
      return fromDrizzle(schema, options.db, options.provider);
    },
    // assume the database is sync with Drizzle schema
    async getSchemaVersion() {
      const [_db, tables] = parseDrizzle(options.db);
      const table = tables[settingsTableName(this.namespace)];
      if (!table) return;
      const col = table["version"];
      if (!col) return;

      return col.default as string;
    },
    generateSchema(schema, schemaName) {
      const settings = settingsTableName(this.namespace);

      const internalTable = table(settings, {
        id: idColumn("id", "varchar(255)"),
        // use default value to save schema version
        version: column("version", "varchar(255)").defaultTo(schema.version),
      });
      internalTable.ormName = settings;

      return {
        code: generateSchema(
          {
            ...schema,
            tables: {
              ...schema.tables,
              [settings]: internalTable,
            },
          },
          options.provider,
          resolveRelationsVersion(options.db),
        ),
        path: `./db/${schemaName}.ts`,
      };
    },
  };
}
