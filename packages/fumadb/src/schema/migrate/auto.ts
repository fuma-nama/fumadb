import { Column, Schema } from "../create";
import { Provider, SQLProvider } from "../../shared/providers";
import { ColumnOperation, MigrationOperation, TableOperation } from "./shared";
import { Kysely } from "kysely";

/**
 * Get the possible column types that the raw DB type can map to.
 */
function dbToSchemaType(
  dbType: string,
  provider: Provider
): (Column["type"] | "varchar(n)")[] {
  dbType = dbType.toLowerCase();

  if (provider === "sqlite") {
    switch (dbType) {
      case "integer":
        return ["bool", "date", "timestamp", "bigint", "integer"];
      case "text":
        return ["json", "string", "bigint", "varchar(n)"];
      case "real":
      case "numeric":
        return ["decimal"];
      case "blob":
        return ["bigint"];
      default:
        return [dbType as Column["type"]];
    }
  }

  if (provider === "postgresql") {
    switch (dbType) {
      case "decimal":
      case "real":
      case "numeric":
      case "double precision":
        return ["decimal"];
      case "timestamp":
      case "timestamptz":
        return ["timestamp"];
      case "varchar":
      case "text":
        return ["string", "varchar(n)"];
      case "boolean":
      case "bool":
        return ["bool"];
      default:
        return [dbType as Column["type"]];
    }
  }

  if (provider === "mysql") {
    switch (dbType) {
      case "bool":
      case "boolean":
        return ["bool"];
      case "integer":
      case "int":
        return ["integer"];
      case "decimal":
      case "numeric":
      case "float":
      case "double":
        return ["decimal"];
      case "datetime":
        return ["timestamp"];
      case "varchar":
      case "text":
        return ["string", "varchar(n)"];
      default:
        return [dbType as Column["type"]];
    }
  }

  if (provider === "mssql") {
    switch (dbType) {
      case "int":
        return ["integer"];
      case "decimal":
      case "float":
      case "real":
      case "numeric":
        return ["decimal"];
      case "bit":
        return ["bool"];
      case "datetime":
      case "datetime2":
        return ["timestamp"];
      case "ntext":
      case "text":
      case "varchar(max)":
      case "nvarchar(max)":
      case "nvarchar":
      case "varchar":
        return ["string", "varchar(n)"];
      default:
        return [dbType as Column["type"]];
    }
  }

  throw new Error("unhandled database provider: " + provider);
}

export async function generateMigration(
  schema: Schema,
  db: Kysely<unknown>,
  provider: SQLProvider,
  options?: {
    /**
     * Table (names) to drop if no longer exist in latest schema.
     */
    detectUnusedTables?: string[];
    /**
     * Note: even by explicitly disabling it, it still drops unused columns that's required.
     */
    dropUnusedColumns?: boolean | ((tableName: string) => "drop" | "keep");
  }
) {
  const { dropUnusedColumns = false, detectUnusedTables = [] } = options ?? {};
  const dbTables = await db.introspection.getTables();
  const operations: MigrationOperation[] = [];
  const schemaTables = Object.values(schema.tables);

  for (const table of schemaTables) {
    const dbTable = dbTables.find((t) => t.name === table.name);

    if (!dbTable) {
      operations.push({
        type: "create-table",
        value: table,
      });

      continue;
    }

    const primaryKeys = table.keys?.map((v) => table.columns[v]!.name);
    const op = {
      type: "update-table",
      name: table.name,
      value: [] as ColumnOperation[],
    } satisfies TableOperation;

    for (const col of Object.values(table.columns)) {
      const column = dbTable.columns.find((c) => c.name === col.name);

      if (!column) {
        op.value.push({
          type: "create-column",
          value: col,
        });

        continue;
      }

      const isPrimaryKey = col.primarykey || primaryKeys?.includes(col.name);

      // ignore primary keys
      if (isPrimaryKey) continue;

      const raw = dbTable.columns.find(({ name }) => name === col.name)!;

      const isChanged = dbToSchemaType(raw.dataType, provider).every((v) => {
        if (v === "varchar(n)" && col.type.startsWith("varchar")) return false;
        return v !== col.type;
      });

      if (isChanged) {
        op.value.push({
          type: "update-column-type",
          name: col.name,
          value: col,
        });
      }

      const nullable = col.nullable ?? false;
      if (nullable !== raw.isNullable) {
        op.value.push({
          type: "set-column-nullable",
          name: col.name,
          value: nullable,
        });
      }

      // there's no easy way to compare default values of columns, so we update it regardless of current value
      if (raw.hasDefaultValue && !col.default) {
        op.value.push({
          type: "remove-column-default",
          name: col.name,
        });
      } else if (col.default) {
        op.value.push({
          type: "update-column-default",
          name: col.name,
          value: col.default,
        });
      }
    }

    for (const col of dbTable.columns) {
      const isDeleted = !Object.values(table.columns).some(
        (item) => item.name === col.name
      );

      // for non-nullable columns that's deleted:
      // the library may no longer pass them when creating new rows,
      // we need to drop them to ensure no error happen due to missing values of unused columns.
      if (isDeleted && (!col.isNullable || dropUnusedColumns)) {
        op.value.push({
          type: "drop-column",
          name: col.name,
        });
      }
    }

    if (op.value.length > 0) operations.push(op);
  }

  for (const tableName of detectUnusedTables) {
    const unused = !schemaTables.some((table) => table.name === tableName);

    if (unused) {
      operations.push({
        type: "drop-table",
        name: tableName,
      });
    }
  }

  return operations;
}
