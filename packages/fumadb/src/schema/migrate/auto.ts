import { AnyColumn, AnySchema } from "../create";
import { Provider, SQLProvider } from "../../shared/providers";
import { ColumnOperation, MigrationOperation, TableOperation } from "./shared";
import { Kysely } from "kysely";

/**
 * Get the possible column types that the raw DB type can map to.
 */
function dbToSchemaType(
  dbType: string,
  provider: Provider
): (AnyColumn["type"] | "varchar(n)")[] {
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
        return [dbType as AnyColumn["type"]];
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
        return [dbType as AnyColumn["type"]];
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
        return [dbType as AnyColumn["type"]];
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
        return [dbType as AnyColumn["type"]];
    }
  }

  throw new Error("unhandled database provider: " + provider);
}

export async function generateMigration(
  schema: AnySchema,
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

    /**
     * ignore compatibility with databases like SQLite which does not support modifying columns.
     */
    unsafe?: boolean;
  }
) {
  const {
    unsafe = false,
    dropUnusedColumns = false,
    detectUnusedTables = [],
  } = options ?? {};
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

    const ops: ColumnOperation[] = [];

    for (const col of Object.values(table.columns)) {
      const column = dbTable.columns.find((c) => c.name === col.name);

      if (!column) {
        ops.push({
          type: "create-column",
          value: col,
        });

        continue;
      }

      // do not update columns in safe mode/sqlite
      if (!unsafe || provider === "sqlite") continue;

      // TODO: improve primary key handling instead of ignoring them
      if ("id" in col && col.id) continue;

      const raw = dbTable.columns.find(({ name }) => name === col.name)!;

      const isChanged = dbToSchemaType(raw.dataType, provider).every((v) => {
        if (v === "varchar(n)" && col.type.startsWith("varchar")) return false;
        return v !== col.type;
      });

      if (isChanged) {
        ops.push({
          type: "update-column-type",
          name: col.name,
          value: col,
        });
      }

      const nullable = col.nullable ?? false;
      if (nullable !== raw.isNullable) {
        ops.push({
          type: "set-column-nullable",
          name: col.name,
          value: nullable,
        });
      }

      // there's no easy way to compare default values of columns, so we update it regardless of current value
      if (raw.hasDefaultValue && !col.default) {
        ops.push({
          type: "remove-column-default",
          name: col.name,
        });
      } else if (col.default && col.default !== "auto") {
        ops.push({
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
        ops.push({
          type: "drop-column",
          name: col.name,
        });
      }
    }

    if (ops.length === 0) continue;

    // not every database supports combining multiple alters in one statement
    if (provider === "mysql" || provider === "postgresql") {
      operations.push({
        type: "update-table",
        name: dbTable.name,
        value: ops,
      });
      continue;
    }

    for (const op of ops) {
      operations.push({
        type: "update-table",
        name: dbTable.name,
        value: [op],
      });
    }
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
