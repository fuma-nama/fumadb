import { AnySchema } from "../create";
import type { SQLProvider } from "../../shared/providers";
import { MigrationOperation } from "./shared";
import { Kysely } from "kysely";
import { dbToSchemaType } from "../serialize";
import { generateMigrationFromSchema } from "./auto-from-schema";
import { introspectSchema } from "../introspect";

export async function generateMigration(
  schema: AnySchema,
  db: Kysely<unknown>,
  provider: SQLProvider,
  options: {
    unsafe?: boolean;
    internalTables: string[];
  }
): Promise<MigrationOperation[]> {
  const { unsafe = false, internalTables } = options;
  const tables = Object.values(schema.tables);
  const tableNameMapping = new Map<string, string>();
  for (const t of tables) {
    tableNameMapping.set(t.name, t.ormName);
  }

  const introspected = await introspectSchema({
    db,
    provider,
    columnNameMapping(tableName, columnName) {
      const name = tableNameMapping.get(tableName);
      if (!name) return columnName;
      const schemaTable = schema.tables[name]!;
      const schemaColumn = schemaTable.getColumnByDBName(columnName);
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
      const schemaColumn = schemaTable.getColumnByDBName(options.columnName);
      if (!schemaColumn) return fallback;

      function isStringLike(type: string) {
        return type.startsWith("varchar") || type === "string";
      }

      if (
        predicted.some((item) => {
          if (item === schemaColumn.type) return true;
          return isStringLike(item) && isStringLike(schemaColumn.type);
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

  return await generateMigrationFromSchema(introspected.schema, schema, {
    db,
    dropUnusedColumns: unsafe,
    dropUnusedTables: unsafe,
    provider,
  });
}
