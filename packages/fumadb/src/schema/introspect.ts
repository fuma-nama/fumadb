import { Kysely, sql, TableMetadata } from "kysely";
import type { SQLProvider } from "../shared/providers";
import { dbToSchemaType } from "./serialize";
import {
  column,
  idColumn,
  table,
  schema,
  type AnySchema,
  AnyColumn,
  AnyTable,
  DefaultValue,
  RelationFn,
  RelationBuilder,
  TypeMap,
  ExplicitRelationInit,
} from "./create";
import { ForeignKeyInfo } from "./migrate/shared";
import { CockroachIntrospector } from "./cockroach-inspector";

export interface IntrospectOptions {
  /**
   * Database connection
   */
  db: Kysely<unknown>;

  /**
   * Database provider
   */
  provider: SQLProvider;

  /**
   * Schema version to generate
   * @default "1.0.0"
   */
  version?: string;

  /**
   * Internal tables to exclude from introspection
   * @default []
   */
  internalTables?: string[];

  /**
   * Custom table name mapping (database name -> schema name)
   */
  tableNameMapping?: (tableName: string) => string;

  /**
   * Custom column name mapping (database name -> schema name)
   */
  columnNameMapping?: (tableName: string, columnName: string) => string;

  columnTypeMapping?: (
    dataType: string,
    options: {
      tableName: string;
      columnName: string;
    }
  ) => keyof TypeMap;

  /**
   * Whether to include relations in the generated schema
   * @default true
   */
  includeRelations?: boolean;
}

export interface IntrospectResult {
  /**
   * Generated FumaDB schema
   */
  schema: AnySchema;
}

/**
 * Get user tables from database (copied from auto.ts)
 */
async function getUserTables(
  db: Kysely<any>,
  internalTables: string[],
  provider: SQLProvider
): Promise<TableMetadata[]> {
  const allTables =
    provider === "cockroachdb"
      ? await new CockroachIntrospector(db).getTables()
      : await db.introspection.getTables();

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
  return allTables.filter(
    (table) =>
      !table.isView &&
      (!table.schema || !excludedSchemas.includes(table.schema)) &&
      !internalTables.includes(table.name)
  );
}

/**
 * Introspect a database and generate a FumaDB schema
 */
export async function introspectSchema(
  options: IntrospectOptions
): Promise<IntrospectResult> {
  const {
    db,
    provider,
    version = "1.0.0",
    internalTables = [],
    tableNameMapping = (t) => t,
    columnNameMapping = (_, c) => c,
    columnTypeMapping = (type) =>
      dbToSchemaType(type, provider)[0] as keyof TypeMap,
    includeRelations = true,
  } = options;

  const dbTables = await getUserTables(db, internalTables, provider);

  const tables: Record<string, AnyTable> = {};
  const relations: Record<string, RelationFn> = {};

  for (const dbTable of dbTables) {
    const ormTableName = tableNameMapping(dbTable.name);
    const tableColumns: Record<string, AnyColumn> = {};
    const primaryKeys = await introspectPrimaryKeys(db, dbTable.name, provider);
    const uniqueConsts = await introspectUniqueConstraints(
      db,
      dbTable.name,
      provider
    );
    if (primaryKeys.length !== 1)
      throw new Error(
        `FumaDB only supports 1 primary key (ID column), received: ${primaryKeys.length}.`
      );

    for (const dbColumn of dbTable.columns) {
      const ormColumnName = columnNameMapping(dbTable.name, dbColumn.name);

      const columnType = columnTypeMapping(dbColumn.dataType, {
        columnName: dbColumn.name,
        tableName: dbTable.name,
      });
      if (!columnType)
        throw new Error(
          `Failed to detect data type of ${dbColumn.dataType}, note that FumaDB doesn't support advanced data types in schema.`
        );

      const isPrimaryKey = primaryKeys.includes(dbColumn.name);
      const defaultValue = dbColumn.hasDefaultValue
        ? await getColumnDefault(
            db,
            provider,
            dbTable.name,
            dbColumn.name,
            columnType
          )
        : undefined;

      if (isPrimaryKey) {
        if (!columnType.startsWith("varchar"))
          throw new Error("ID column only supports varchar at the moment");

        const idCol = idColumn(
          dbColumn.name,
          columnType as `varchar(${number})`,
          {
            // `auto` doesn't affect database, use it as fallback.
            default: (defaultValue as any) ?? "auto",
          }
        );
        tableColumns[ormColumnName] = idCol;
      } else {
        // Use regular column
        const col = column(dbColumn.name, columnType, {
          nullable: dbColumn.isNullable,
          unique: uniqueConsts.some((con) =>
            con.columns.includes(dbColumn.name)
          ),
          default: defaultValue,
        });
        tableColumns[ormColumnName] = col;
      }
    }

    tables[ormTableName] = table(dbTable.name, tableColumns);
  }

  // Build relations
  if (includeRelations) {
    for (const k in tables) {
      const table = tables[k]!;
      const foreignKeys = await introspectTableForeignKeys(
        db,
        provider,
        table.name
      );

      relations[k] = (b) => {
        const output: Record<string, ExplicitRelationInit> = {};

        for (const key of foreignKeys) {
          let relationName = key.name;
          const RemoveSuffix = "_fk";

          if (relationName.endsWith(RemoveSuffix))
            relationName = relationName.slice(0, -RemoveSuffix.length);

          output[relationName] = buildRelationDefinition(
            b,
            table,
            key,
            (name) => Object.values(tables).find((t) => t.name === name)
          );
        }
        return output;
      };
    }
  }

  const generatedSchema = schema({
    version,
    tables,
    relations,
  });

  return {
    schema: generatedSchema,
  };
}

/**
 * Get column default value from database
 */
async function getColumnDefault(
  db: Kysely<any>,
  provider: SQLProvider,
  tableName: string,
  columnName: string,
  columnType: string
): Promise<DefaultValue | undefined> {
  try {
    const rawDefault = await getColumnDefaultValue(
      db,
      provider,
      tableName,
      columnName
    );
    return normalizeColumnDefault(rawDefault, columnType);
  } catch {
    return undefined;
  }
}

/**
 * Get column default value from database
 */
async function getColumnDefaultValue(
  db: Kysely<any>,
  provider: SQLProvider,
  tableName: string,
  columnName: string
): Promise<unknown | null> {
  switch (provider) {
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
      const { sql } = await import("kysely");
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

/**
 * Normalize column default value
 */
function normalizeColumnDefault(
  raw: unknown | null,
  type: string
): DefaultValue {
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

function buildRelationDefinition(
  builder: RelationBuilder,
  table: AnyTable,
  fk: ForeignKeyInfo,
  dbNameToTable: (name: string) => AnyTable | undefined
) {
  const targetTable = dbNameToTable(fk.referencedTable);
  if (!targetTable)
    throw new Error(
      `Failed to resolve referenced table in a foreign key: ${fk.referencedTable}`
    );

  const on: [string, string][] = [];
  for (let i = 0; i < fk.columns.length; i++) {
    const col = fk.columns[i]!;
    const refCol = fk.referencedColumns[i]!;

    on.push([
      table.getColumnByDBName(col)!.ormName,
      targetTable.getColumnByDBName(refCol)!.ormName,
    ]);
  }

  return builder.one(targetTable, ...on).foreignKey({
    name: fk.name,
    onDelete: fk.onDelete,
    onUpdate: fk.onUpdate,
  });
}

async function introspectPrimaryKeys(
  db: Kysely<any>,
  tableName: string,
  provider: SQLProvider
): Promise<string[]> {
  if (provider === "sqlite") {
    const columns = await db
      .selectFrom(sql.raw(`pragma_table_info('${tableName}')`).as("t"))
      .select(["name", "pk"])
      .execute();

    return columns.filter((col) => col.pk).map((col) => col.name as string);
  }

  if (provider === "postgresql" || provider === "cockroachdb") {
    const pkRows = await db
      .selectFrom("pg_constraint")
      .innerJoin("pg_class", "pg_constraint.conrelid", "pg_class.oid")
      .innerJoin("pg_namespace", "pg_class.relnamespace", "pg_namespace.oid")
      .where("pg_class.relname", "=", tableName)
      .where("pg_constraint.contype", "=", "p")
      .select(["pg_constraint.conname", "pg_constraint.conkey"])
      .execute();

    const attnumToName = await postgresqlIntrospectAttnumToName(db, tableName);

    const primaryKeys: string[] = [];
    for (const pk of pkRows) {
      const attnums = postgresqlParseConName(pk.conkey);

      for (const attnum of attnums) {
        const colName = attnumToName.get(attnum);

        if (colName !== undefined) {
          primaryKeys.push(colName);
        }
      }
    }
    return primaryKeys;
  }

  if (provider === "mysql") {
    const keyRows = await db
      .selectFrom("information_schema.KEY_COLUMN_USAGE")
      .where("TABLE_NAME", "=", tableName)
      .select(["CONSTRAINT_NAME", "COLUMN_NAME"])
      .execute();

    const constraints: Record<string, string[]> = {};
    for (const row of keyRows) {
      if (row.CONSTRAINT_NAME && row.COLUMN_NAME) {
        constraints[row.CONSTRAINT_NAME] ??= [];
        constraints[row.CONSTRAINT_NAME]!.push(row.COLUMN_NAME);
      }
    }

    const pkRow = await db
      .selectFrom("information_schema.TABLE_CONSTRAINTS")
      .where("TABLE_NAME", "=", tableName)
      .where("CONSTRAINT_TYPE", "=", "PRIMARY KEY")
      .select(["CONSTRAINT_NAME"])
      // a table should have at least one primary key
      .executeTakeFirstOrThrow();

    const pkName = pkRow.CONSTRAINT_NAME;
    return constraints[pkName] ?? [];
  }

  if (provider === "mssql") {
    const result = await db
      .selectFrom("sys.key_constraints as kc")
      .select("c.name as column_name")
      .innerJoin("sys.index_columns as ic", (v) =>
        v
          .onRef("kc.parent_object_id", "=", "ic.object_id")
          .onRef("kc.unique_index_id", "=", "ic.index_id")
      )
      .innerJoin("sys.columns as c", (v) =>
        v
          .onRef("ic.object_id", "=", "c.object_id")
          .onRef("ic.column_id", "=", "c.column_id")
      )
      .innerJoin("sys.tables as t", "kc.parent_object_id", "t.object_id")
      .innerJoin("sys.schemas as s", "t.schema_id", "s.schema_id")
      .where("kc.type", "=", "PK")
      .where("s.name", "=", "dbo")
      .where("t.name", "=", tableName)
      .orderBy("ic.key_ordinal")
      .execute();

    return result.map((row) => row.column_name);
  }

  // Fallback: return empty
  return [];
}

async function postgresqlIntrospectAttnumToName(
  db: Kysely<any>,
  tableName: string
) {
  const colRows = await db
    .selectFrom("pg_attribute")
    .innerJoin("pg_class", "pg_attribute.attrelid", "pg_class.oid")
    .where("pg_class.relname", "=", tableName)
    .where("pg_attribute.attnum", ">", 0)
    .select(["pg_attribute.attnum", "pg_attribute.attname"])
    .execute();

  const attnumToName = new Map<number, string>();
  for (const row of colRows) {
    attnumToName.set(Number(row.attnum), row.attname);
  }
  return attnumToName;
}

/**
 * @param conName usually in the format of {1,2,4} or returned as an array of numbers (depending on the driver)
 */
function postgresqlParseConName(conName: unknown): number[] {
  if (Array.isArray(conName)) return conName.map(Number);
  if (typeof conName === "string") {
    return conName
      .substring(1, conName.length - 1)
      .split(",")
      .map(Number);
  }

  return [];
}

interface UniqueConstraint {
  name: string;
  columns: string[];
}

async function introspectUniqueConstraints(
  db: Kysely<any>,
  tableName: string,
  provider: SQLProvider
): Promise<UniqueConstraint[]> {
  if (provider === "sqlite") {
    const indexes = await db
      .selectFrom(sql.raw(`pragma_index_list('${tableName}')`).as("i"))
      .select(["name", "unique"])
      .execute();

    const uniqueConstraints: UniqueConstraint[] = [];
    for (const idx of indexes) {
      if (!idx.unique) continue;

      const idxCols = await db
        .selectFrom(sql.raw(`pragma_index_info('${idx.name}')`).as("ii"))
        .select(["name"])
        .execute();
      uniqueConstraints.push({
        name: idx.name,
        columns: idxCols.map((c) => c.name as string),
      });
    }

    return uniqueConstraints;
  }

  if (provider === "postgresql" || provider === "cockroachdb") {
    const uniqueRows = await db
      .selectFrom("pg_constraint")
      .innerJoin("pg_class", "pg_constraint.conrelid", "pg_class.oid")
      .innerJoin("pg_namespace", "pg_class.relnamespace", "pg_namespace.oid")
      .where("pg_class.relname", "=", tableName)
      .where("pg_constraint.contype", "=", "u")
      .select(["pg_constraint.conname", "pg_constraint.conkey"])
      .execute();

    const attnumToName = await postgresqlIntrospectAttnumToName(db, tableName);
    const uniqueConstraints: UniqueConstraint[] = [];
    for (const uq of uniqueRows) {
      const attnums = postgresqlParseConName(uq.conkey);
      uniqueConstraints.push({
        name: uq.conname,
        columns: attnums.flatMap((a: number) => attnumToName.get(a) ?? []),
      });
    }

    return uniqueConstraints;
  }

  if (provider === "mysql") {
    const keyRows = await db
      .selectFrom("information_schema.KEY_COLUMN_USAGE")
      .where("TABLE_NAME", "=", tableName)
      .select(["CONSTRAINT_NAME", "COLUMN_NAME"])
      .execute();

    const constraints: Record<string, string[]> = {};
    for (const row of keyRows) {
      if (row.CONSTRAINT_NAME && row.COLUMN_NAME) {
        constraints[row.CONSTRAINT_NAME] ??= [];
        constraints[row.CONSTRAINT_NAME]!.push(row.COLUMN_NAME);
      }
    }

    const uniqueRows = await db
      .selectFrom("information_schema.TABLE_CONSTRAINTS")
      .where("TABLE_NAME", "=", tableName)
      .where("CONSTRAINT_TYPE", "=", "UNIQUE")
      .select(["CONSTRAINT_NAME"])
      .execute();

    const uniqueConstraints: UniqueConstraint[] = [];
    for (const uq of uniqueRows) {
      uniqueConstraints.push({
        name: uq.CONSTRAINT_NAME,
        columns: constraints[uq.CONSTRAINT_NAME] ?? [],
      });
    }

    return uniqueConstraints;
  }

  if (provider === "mssql") {
    const constraints = await db
      .selectFrom("sys.key_constraints as kc")
      .innerJoin("sys.index_columns as ic", (join) =>
        join
          .onRef("kc.parent_object_id", "=", "ic.object_id")
          .onRef("kc.unique_index_id", "=", "ic.index_id")
      )
      .innerJoin("sys.columns as c", (join) =>
        join
          .onRef("ic.object_id", "=", "c.object_id")
          .onRef("ic.column_id", "=", "c.column_id")
      )
      .innerJoin("sys.tables as t", "kc.parent_object_id", "t.object_id")
      .where("kc.type", "=", "UQ")
      .where("t.name", "=", tableName)
      .select([
        "kc.name as constraint_name",
        "c.name as column_name",
        "ic.key_ordinal",
      ])
      .orderBy("constraint_name")
      .orderBy("ic.key_ordinal")
      .execute();
    const grouped = new Map<string, UniqueConstraint>();
    for (const item of constraints) {
      const value: UniqueConstraint = grouped.get(item.constraint_name) ?? {
        name: item.constraint_name,
        columns: [],
      };

      value.columns.push(item.column_name);
      grouped.set(item.constraint_name, value);
    }

    return Array.from(grouped.values());
  }

  // Fallback: return empty
  return [];
}

async function introspectTableForeignKeys(
  db: Kysely<any>,
  provider: SQLProvider,
  tableName: string
): Promise<ForeignKeyInfo[]> {
  switch (provider) {
    case "postgresql":
    case "cockroachdb": {
      // Get all foreign keys for the table (columns, referenced table, and actions)
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
        .innerJoin("information_schema.table_constraints as tc_ref", (join) =>
          join
            .onRef("rc.unique_constraint_name", "=", "tc_ref.constraint_name")
            .onRef(
              "rc.unique_constraint_schema",
              "=",
              "tc_ref.constraint_schema"
            )
        )
        .select([
          "tc.constraint_name as name",
          "kcu.column_name as column_name",
          "kcu.ordinal_position as ordinal_position",
          "tc_ref.table_name as referenced_table",
          "rc.unique_constraint_name as referenced_constraint_name",
          "rc.update_rule as on_update",
          "rc.delete_rule as on_delete",
        ])
        .where("tc.table_name", "=", tableName)
        .where("tc.constraint_type", "=", "FOREIGN KEY")
        .orderBy("name", "asc")
        .orderBy("ordinal_position", "asc")
        .execute();

      const map = new Map<
        string,
        ForeignKeyInfo & {
          referencedConstraintName: string;
          referencedTable: string;
        }
      >();
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
            referencedConstraintName: row.referenced_constraint_name,
          };
          map.set(row.name, fk);
        }
        fk.columns.push(row.column_name);
      }

      // referenced columns
      for (const fk of map.values()) {
        const refCols = await db
          .selectFrom("information_schema.key_column_usage")
          .select(["column_name"])
          .where("constraint_name", "=", fk.referencedConstraintName)
          .where("table_name", "=", fk.referencedTable)
          .orderBy("ordinal_position", "asc")
          .execute();
        fk.referencedColumns = refCols.map((r) => r.column_name);
        // Remove helper fields
        delete (fk as any).referencedConstraintName;
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

      const map = new Map<string, ForeignKeyInfo>();
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
      const map = new Map<number, ForeignKeyInfo>();
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
            .onRef("fkc.parent_object_id", "=", "c.object_id")
            .onRef("fkc.parent_column_id", "=", "c.column_id")
        )
        .innerJoin(
          "sys.tables as rt",
          "fk.referenced_object_id",
          "rt.object_id"
        )
        .innerJoin("sys.columns as rc", (join) =>
          join
            .onRef("fkc.referenced_object_id", "=", "rc.object_id")
            .onRef("fkc.referenced_column_id", "=", "rc.column_id")
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
      const map = new Map<string, ForeignKeyInfo>();
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

function mapAction(
  action: string | undefined
): "RESTRICT" | "CASCADE" | "SET NULL" {
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
