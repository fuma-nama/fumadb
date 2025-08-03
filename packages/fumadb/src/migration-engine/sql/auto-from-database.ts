import type { AnySchema } from "../../schema/create";
import type { MigrationOperation } from "../shared";
import { dbToSchemaType } from "../../schema/serialize";
import { generateMigrationFromSchema } from "../auto-from-schema";
import { introspectSchema } from "./introspect";
import type { KyselyConfig } from "../../shared/config";

export async function generateMigration(
  schema: AnySchema,
  config: KyselyConfig,
  options: {
    dropUnusedColumns?: boolean;
    internalTables: string[];
  }
): Promise<MigrationOperation[]> {
  const { db, provider } = config;
  const { dropUnusedColumns = false, internalTables } = options;
  const tables = Object.values(schema.tables);
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
      const schemaTable = schema.tables[name]!;
      const schemaColumn = schemaTable.getColumnByName(columnName);
      if (!schemaColumn) return columnName;

      return schemaColumn.ormName;
    },
    columnTypeMapping(dataType, options) {
      const predicted = dbToSchemaType(dataType, provider);
      const fallback =
        predicted[0] === "varchar(n)" ? "varchar(255)" : predicted[0]!;

      const name = tableNameMapping.get(options.tableName);
      if (!name) return fallback;
      const schemaTable = schema.tables[name]!;
      const schemaColumn = schemaTable.getColumnByName(options.columnName);
      if (!schemaColumn) return fallback;

      function isStringLike(type: string) {
        return type.startsWith("varchar") || type === "string";
      }

      if (
        predicted.some((item) => {
          return (
            item === schemaColumn.type ||
            (isStringLike(item) && isStringLike(schemaColumn.type))
          );
        })
      )
        return schemaColumn.type;
      return fallback;
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
