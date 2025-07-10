import { AnySchema, DefaultValue, IdColumn, TypeMap } from "../create";
import type { SQLProvider } from "../../shared/providers";
import { ColumnOperation, MigrationOperation } from "./shared";
import { Kysely, sql, TableMetadata } from "kysely";
import { dbToSchemaType } from "../serialize";

const errors = {
  UpdateDataType:
    "[Safe Mode] Column types should not be updated between different versions, because: 1) updating columns often requires stopping the consumer's server. 2) converting data types is often risky.",
  UpdatePrimaryKey:
    "Updating ID columns (primary key) is not supported by FumaDB.",
};

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
  const dbTables = await getUserTables(db);
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

      const op: ColumnOperation = {
        type: "update-column",
        name: col.name,
        value: col,
        updateDataType: false,
        updateDefault: false,
        updateNullable: false,
      };

      const isPrimaryKey = col instanceof IdColumn;

      const raw = dbTable.columns.find(({ name }) => name === col.name)!;
      op.updateDataType = dbToSchemaType(raw.dataType, provider).every((v) => {
        const bothString =
          (col.type === "string" || col.type.startsWith("varchar")) &&
          (v === "varchar(n)" || v === "string");

        return !bothString && v !== col.type;
      });

      const nullable = col.nullable ?? false;
      op.updateNullable = nullable !== raw.isNullable;

      if (col.default === "auto") {
        // handle by fumadb in runtime
        op.updateDefault = false;
      } else if (raw.hasDefaultValue && !col.default) {
        // remove default
        op.updateDefault = true;
      } else if (col.default) {
        const currentDefault = normalizeColumnDefault(
          await getColumnDefaultValue(db, provider, table.name, col.name),
          col.type
        );

        op.updateDefault =
          !currentDefault ||
          isColumnDefaultChanged(currentDefault, col.default);
      }

      if (op.updateDataType || op.updateDefault || op.updateNullable) {
        if (!unsafe && op.updateDataType)
          throw new Error(errors.UpdateDataType);
        if (isPrimaryKey) throw new Error(errors.UpdatePrimaryKey);
        ops.push(op);
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

async function getUserTables(db: Kysely<any>): Promise<TableMetadata[]> {
  const allTables = await db.introspection.getTables();

  // MySQL, PostgreSQL, SQLite, etc.
  const excludedSchemas = [
    "mysql",
    "information_schema",
    "performance_schema",
    "sys",
    "pg_catalog",
    "pg_toast",
    "sqlite_master",
    "sqlite_temp_master",
  ];

  // Filter out tables that belong to internal schemas or are views
  const userTables = allTables.filter(
    (table) =>
      !table.isView &&
      (!table.schema || !excludedSchemas.includes(table.schema)) &&
      table.name !== null
  );

  return userTables;
}

function isColumnDefaultChanged(
  currentDefault: DefaultValue,
  future: DefaultValue
) {
  if (typeof currentDefault !== typeof future) return true;

  if (typeof currentDefault === "object" && typeof future === "object") {
    if ("sql" in future && "sql" in currentDefault) {
      return currentDefault.sql !== future.sql;
    }

    if ("value" in future && "value" in currentDefault) {
      return currentDefault.value !== future.value;
    }
  }

  return false;
}

/**
 * Normalize a raw default value from the database into a comparable value with schema's default.
 * Handles provider-specific quirks, such as type casts in PostgreSQL, quotes, and function defaults.
 */
function normalizeColumnDefault(
  raw: unknown | null,
  type: keyof TypeMap
): DefaultValue | undefined {
  if (raw == null) return { value: null };
  let str = String(raw).trim();

  if (
    /^(CURRENT_TIMESTAMP|now\(\)|datetime\('now'\)|getdate\(\))/i.test(str) &&
    (type === "date" || type === "timestamp")
  ) {
    return { value: "now" };
  }

  // Remove type casts and quotes
  str = str.replace(/::[\w\s\[\]\."]+$/, "");
  if (str.startsWith("E'") || str.startsWith("N'")) {
    str = str.slice(2, -1);
  } else if (
    (str.startsWith("'") && str.endsWith("'")) ||
    (str.startsWith('"') && str.endsWith('"'))
  ) {
    str = str.slice(1, -1);
  }

  if (type === "bool") {
    if (str === "true" || str === "1") return { value: true };
    if (str === "false" || str === "0") return { value: false };
  }

  if ((type === "integer" || type === "decimal") && str.length > 0) {
    const parsed = Number(str);
    if (Number.isNaN(parsed))
      throw new Error(
        "Failed to parse number from database default column value: " + str
      );

    return { value: parsed };
  }

  if (type === "json") {
    return { value: JSON.parse(str) };
  }

  if (type === "bigint" && str.length > 0) {
    return { value: BigInt(str) };
  }

  if (type === "timestamp" || type === "date") {
    return { value: new Date(type) };
  }

  if (str.toLowerCase() === "null") return { value: null };

  if (type === "string" || type.startsWith("varchar")) return { value: str };

  // Fallback: treat as sql statement
  return { sql: raw as string };
}

/**
 * get the current default value of a column from the database
 *
 * the result varies depending on the database
 */
async function getColumnDefaultValue(
  db: Kysely<any>,
  provider: SQLProvider,
  tableName: string,
  columnName: string
): Promise<unknown | null> {
  switch (provider) {
    // CockroachDB is Postgres-compatible for information_schema
    case "cockroachdb":
    case "postgresql":
      return await db
        .selectFrom("information_schema.columns")
        .select("column_default")
        .where("table_name", "=", tableName)
        .where("column_name", "=", columnName)
        .executeTakeFirst()
        .then((result) => result?.column_default ?? null);
    case "mysql": {
      const result = await db
        .selectFrom("information_schema.columns")
        .select("COLUMN_DEFAULT as column_default")
        .where("table_name", "=", tableName)
        .where("column_name", "=", columnName)
        .executeTakeFirst();
      return result?.column_default ?? null;
    }
    case "sqlite": {
      const pragmaRows = await sql
        .raw(`PRAGMA table_info(${tableName})`)
        .execute(db);

      const row = Array.isArray(pragmaRows)
        ? pragmaRows.find((r: any) => r.name === columnName)
        : undefined;
      return row?.dflt_value ?? null;
    }
    case "mssql": {
      const result = await db
        .selectFrom("sys.columns as c")
        .innerJoin("sys.tables as t", "c.object_id", "t.object_id")
        .leftJoin("sys.default_constraints as d", (join) =>
          join.on("c.default_object_id", "=", "d.object_id")
        )
        .select("d.definition as column_default")
        .where("t.name", "=", tableName)
        .where("c.name", "=", columnName)
        .executeTakeFirst();
      return result?.column_default ?? null;
    }
    default:
      throw new Error(
        `Provider ${provider} not supported for default value introspection`
      );
  }
}
