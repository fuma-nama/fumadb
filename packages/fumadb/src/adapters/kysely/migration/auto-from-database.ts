import { type AnySchema } from "../../../schema/create";
import type { MigrationOperation } from "../../../migration-engine/shared";
import { dbToSchemaType } from "../../../schema/serialize";
import { generateMigrationFromSchema } from "../../../migration-engine/auto-from-schema";
import { introspectSchema } from "./introspect";
import type { KyselyConfig } from "../../../shared/config";
import {
  applyNameVariants,
  type NameVariantsConfig,
} from "../../../schema/override";

export async function generateMigration(
  schema: AnySchema,
  config: KyselyConfig,
  options: {
    nameVariants?: NameVariantsConfig;
    dropUnusedColumns?: boolean;
    internalTables: string[];
  }
): Promise<MigrationOperation[]> {
  const { db, provider } = config;
  const { dropUnusedColumns = false, internalTables, nameVariants } = options;
  const schemaWithVariant = nameVariants
    ? applyNameVariants(schema, nameVariants)
    : schema;

  const tables = Object.values(schemaWithVariant.tables);
  const tableNameMapping = new Map<string, string>();
  for (const t of tables) {
    tableNameMapping.set(t.names.sql, t.ormName);
  }

  const introspected = await introspectSchema({
    db,
    provider,
    columnNameMapping(tableName, columnName) {
      const name = tableNameMapping.get(tableName);
      if (!name) return columnName;

      const col = schemaWithVariant.tables[name].getColumnByName(columnName);
      if (!col) return columnName;

      return col.ormName;
    },
    columnTypeMapping(dataType, options) {
      const predicted = dbToSchemaType(dataType, provider);
      function fallback() {
        if (options.isPrimaryKey && predicted.includes("varchar(n)"))
          return "varchar(255)";

        for (let item of predicted) {
          if (item === "varchar(n)") item = "varchar(255)";

          if (!options.isPrimaryKey) return item;

          if (item.startsWith("varchar")) return item;
        }

        throw new Error("failed to predict");
      }

      const col = schemaWithVariant.tables[
        tableNameMapping.get(options.tableMetadata.name) ??
          options.tableMetadata.name
      ]?.getColumnByName(options.metadata.name);

      if (!col) return fallback();

      function isStringLike(type: string) {
        return type.startsWith("varchar") || type === "string";
      }
      for (const item of predicted) {
        if (item === col.type) return item;

        if (isStringLike(item) && isStringLike(col.type)) {
          return col.type;
        }
      }

      return fallback();
    },
    tableNameMapping(tableName) {
      return tableNameMapping.get(tableName) ?? tableName;
    },
    internalTables,
  });

  return generateMigrationFromSchema(introspected.schema, schema, {
    ...config,
    dropUnusedColumns,
    dropUnusedTables: false,
  });
}
