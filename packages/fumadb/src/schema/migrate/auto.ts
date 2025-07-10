import {
  AnySchema,
  AnyTable,
  DefaultValue,
  IdColumn,
  TypeMap,
} from "../create";
import type { SQLProvider } from "../../shared/providers";
import { ColumnOperation, MigrationOperation } from "./shared";
import { Kysely, sql, TableMetadata } from "kysely";
import { dbToSchemaType } from "../serialize";
import type { ForeignKeyIntrospect } from "./shared";

const errors = {
  UpdateDataType:
    "[Safe Mode] Column types should not be updated between different versions, because: 1) updating columns often requires stopping the consumer's server. 2) converting data types is often risky.",
  UpdateForeignKey:
    "[Safe Mode] Foreign keys should not be updated between different versions, because: 1) it requires stopping the consumer's server. 2) it requires re-creating the table.",
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

  /**
   * @returns true if should continue detecting changes for table (e.g. columns), false to skip (e.g. decided to re-create the table)
   */
  async function processForeignKeys(
    table: AnyTable
  ): Promise<MigrationOperation[]> {
    const result: MigrationOperation[] = [];
    const explicitRelations = Object.values(table.relations).filter(
      (rel) => rel && !rel.isImplied() && rel.foreignKeyConfig
    );

    const dbKeys = await getTableForeignKeys(db, provider, table.name);
    for (const relation of explicitRelations) {
      if (dbKeys.some((item) => item.name === relation.foreignKeyConfig!.name))
        continue;

      if (provider === "sqlite") {
        return [
          {
            type: "recreate-table",
            value: table,
          },
        ];
      }

      result.push({
        type: "add-foreign-key",
        table: table.name,
        value: {
          ...relation.foreignKeyConfig!,
          referencedTable: relation.table.name,
          referencedColumns: relation.on.map(([, right]) => right),
          columns: relation.on.map(([left]) => left),
        },
      });
    }

    // unused foreign keys
    for (const key of dbKeys) {
      if (
        explicitRelations.some((fk) => key.name === fk.foreignKeyConfig!.name)
      )
        continue;

      if (provider === "sqlite") {
        return [
          {
            type: "recreate-table",
            value: table,
          },
        ];
      }

      result.push({
        type: "drop-foreign-key",
        table: table.name,
        name: key.name,
      });
    }

    return result;
  }

  for (const table of schemaTables) {
    const dbTable = dbTables.find((t) => t.name === table.name);

    if (!dbTable) {
      operations.push({
        type: "create-table",
        value: table,
      });

      continue;
    }

    const foreignKeyOperations = await processForeignKeys(table);
    operations.push(...foreignKeyOperations);

    if (foreignKeyOperations.length > 0 && !unsafe) {
      throw new Error(errors.UpdateForeignKey);
    } else if (
      foreignKeyOperations.some((op) => op.type === "recreate-table")
    ) {
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

    // not every database supports combining multiple alters in one statement
    if (ops.length > 0 && (provider === "mysql" || provider === "postgresql")) {
      operations.push({
        type: "update-table",
        name: dbTable.name,
        value: ops,
      });
    } else {
      for (const op of ops) {
        operations.push({
          type: "update-table",
          name: dbTable.name,
          value: [op],
        });
      }
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

/**
 * Introspect foreign keys for a table from the database.
 */
export async function getTableForeignKeys(
  db: Kysely<any>,
  provider: SQLProvider,
  tableName: string
): Promise<ForeignKeyIntrospect[]> {
  switch (provider) {
    case "postgresql":
    case "cockroachdb": {
      // Get all foreign keys for the table
      // Join information_schema views to get columns, referenced table/columns, and actions
      const constraints = await db
        .selectFrom("information_schema.table_constraints as tc")
        .innerJoin("information_schema.key_column_usage as kcu", (join) =>
          join
            .onRef("tc.constraint_name", "=", "kcu.constraint_name")
            .onRef("tc.table_name", "=", "kcu.table_name")
        )
        .innerJoin("information_schema.referential_constraints as rc", (join) =>
          join.onRef("tc.constraint_name", "=", "rc.constraint_name")
        )
        .select([
          "tc.constraint_name as name",
          "kcu.column_name as column_name",
          "kcu.ordinal_position as ordinal_position",
          "kcu.position_in_unique_constraint as ref_position",
          "kcu.referenced_table_name as referenced_table_name",
          "kcu.referenced_column_name as referenced_column_name",
          "rc.unique_constraint_table_name as referenced_table",
          "rc.unique_constraint_name as referenced_constraint_name",
          "rc.update_rule as on_update",
          "rc.delete_rule as on_delete",
        ])
        .where("tc.table_name", "=", tableName)
        .where("tc.constraint_type", "=", "FOREIGN KEY")
        .orderBy("name", "asc")
        .orderBy("ordinal_position", "asc")
        .execute();

      // Group by constraint name
      const map = new Map<string, ForeignKeyIntrospect>();
      for (const row of constraints) {
        let fk = map.get(row.name);
        if (!fk) {
          fk = {
            name: row.name,
            columns: [],
            referencedTable: row.referenced_table,
            referencedColumns: [],
            onUpdate: mapAction(row.on_update),
            onDelete: mapAction(row.on_delete),
          };
          map.set(row.name, fk);
        }
        fk.columns.push(row.column_name);
        fk.referencedColumns.push(row.referenced_column_name);
      }
      return Array.from(map.values());
    }
    case "mysql": {
      // Query information_schema.key_column_usage and referential_constraints
      const constraints = await db
        .selectFrom("information_schema.key_column_usage as kcu")
        .innerJoin("information_schema.referential_constraints as rc", (join) =>
          join
            .onRef("kcu.constraint_name", "=", "rc.constraint_name")
            .onRef("kcu.table_name", "=", "rc.table_name")
        )
        .select([
          "kcu.constraint_name as name",
          "kcu.column_name as column_name",
          "kcu.ordinal_position as ordinal_position",
          "kcu.referenced_table_name as referenced_table",
          "kcu.referenced_column_name as referenced_column",
          "rc.update_rule as on_update",
          "rc.delete_rule as on_delete",
        ])
        .where("kcu.table_name", "=", tableName)
        .where("kcu.referenced_table_name", "is not", null)
        .orderBy("name", "asc")
        .orderBy("ordinal_position", "asc")
        .execute();

      const map = new Map<string, ForeignKeyIntrospect>();
      for (const row of constraints) {
        let fk = map.get(row.name);
        if (!fk) {
          fk = {
            name: row.name,
            columns: [],
            referencedTable: row.referenced_table,
            referencedColumns: [],
            onUpdate: mapAction(row.on_update),
            onDelete: mapAction(row.on_delete),
          };
          map.set(row.name, fk);
        }
        fk.columns.push(row.column_name);
        fk.referencedColumns.push(row.referenced_column);
      }
      return Array.from(map.values());
    }
    case "sqlite": {
      // Use PRAGMA foreign_key_list
      const pragmaRows = await sql
        .raw(`PRAGMA foreign_key_list(${tableName})`)
        .execute(db);
      // Each row: id, seq, table, from, to, on_update, on_delete, match
      const map = new Map<number, ForeignKeyIntrospect>();
      for (const row of pragmaRows.rows as any[]) {
        let fk = map.get(row.id);

        if (!fk) {
          fk = {
            name: `fk_${tableName}_${row.id}`,
            columns: [],
            referencedTable: row.table,
            referencedColumns: [],
            onUpdate: mapAction(row.on_update),
            onDelete: mapAction(row.on_delete),
          };
          map.set(row.id, fk);
        }
        fk.columns.push(row.from);
        fk.referencedColumns.push(row.to);
      }
      return Array.from(map.values());
    }
    case "mssql": {
      // Query sys.foreign_keys, sys.foreign_key_columns, sys.columns, sys.tables
      const constraints = await db
        .selectFrom("sys.foreign_keys as fk")
        .innerJoin(
          "sys.foreign_key_columns as fkc",
          "fk.object_id",
          "fkc.constraint_object_id"
        )
        .innerJoin("sys.tables as t", "fk.parent_object_id", "t.object_id")
        .innerJoin("sys.columns as c", (join) =>
          join
            .on("fkc.parent_object_id", "=", "c.object_id")
            .on("fkc.parent_column_id", "=", "c.column_id")
        )
        .innerJoin(
          "sys.tables as rt",
          "fk.referenced_object_id",
          "rt.object_id"
        )
        .innerJoin("sys.columns as rc", (join) =>
          join
            .on("fkc.referenced_object_id", "=", "rc.object_id")
            .on("fkc.referenced_column_id", "=", "rc.column_id")
        )
        .select([
          "fk.name as name",
          "c.name as column_name",
          "rc.name as referenced_column",
          "rt.name as referenced_table",
          "fkc.constraint_column_id as ordinal_position",
          "fk.delete_referential_action_desc as on_delete",
          "fk.update_referential_action_desc as on_update",
        ])
        .where("t.name", "=", tableName)
        .orderBy("name", "asc")
        .orderBy("ordinal_position", "asc")
        .execute();
      const map = new Map<string, ForeignKeyIntrospect>();
      for (const row of constraints) {
        let fk = map.get(row.name);
        if (!fk) {
          fk = {
            name: row.name,
            columns: [],
            referencedTable: row.referenced_table,
            referencedColumns: [],
            onUpdate: mapAction(row.on_update),
            onDelete: mapAction(row.on_delete),
          };
          map.set(row.name, fk);
        }
        fk.columns.push(row.column_name);
        fk.referencedColumns.push(row.referenced_column);
      }
      return Array.from(map.values());
    }
    default:
      throw new Error(
        `Provider ${provider} not supported for foreign key introspection`
      );
  }
}

function mapAction(action: string): "RESTRICT" | "CASCADE" | "SET NULL" {
  switch (action?.toUpperCase()) {
    case "CASCADE":
      return "CASCADE";
    case "SET NULL":
      return "SET NULL";
    case "RESTRICT":
    case "NO ACTION":
    case "NONE":
      return "RESTRICT";
    default:
      return "RESTRICT";
  }
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
