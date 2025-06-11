import {
  ColumnBuilderCallback,
  ColumnDataType,
  Kysely,
  sql,
  type AlterTableColumnAlteringBuilder,
  type CreateTableBuilder,
} from "kysely";
import { Column, Schema, Table } from "../create";
import { Provider } from "../providers";

type SupportedProvider = Exclude<Provider, "mongodb" | "cockroachdb">;

export interface MigrationConfig {
  type: "kysely";
  provider: SupportedProvider;
  db: Kysely<unknown>;
}

/**
 * Strip data type function params, like integer(n) -> integer
 */
function stripParams(dataType: string) {
  return dataType.split("(", 2)[0]!;
}

function schemaToDBType(
  col: Column,
  { provider }: MigrationConfig
): ColumnDataType | (string & {}) {
  const type = col.type;
  if (provider === "sqlite") {
    switch (type) {
      case "bigint":
      case "integer":
      case "timestamp":
      case "date":
      case "bool":
        return "integer";
      case "json":
      case "string":
        return "text";
      case "decimal":
        return "real";
      default:
        // sqlite doesn't support varchar
        if (type.startsWith("varchar")) return "text";
    }
  }

  if (provider === "mssql") {
    switch (type) {
      case "bigint":
        return "bigint";
      case "bool":
        return "bit";
      case "date":
        return "date";
      case "timestamp":
        return "datetime";
      case "decimal":
        return "decimal";
      case "integer":
        return "int";
      case "json":
        return "json";
      case "string":
        return "varchar(max)";
    }
  }

  if (provider === "postgresql") {
    switch (type) {
      case "bigint":
        return "bigint";
      case "bool":
        return "boolean";
      case "date":
        return "date";
      case "timestamp":
        return "timestamp";
      case "decimal":
        return "decimal";
      case "integer":
        return "integer";
      case "json":
        return "json";
      case "string":
        return "text";
    }
  }

  if (provider === "mysql") {
    switch (type) {
      case "bigint":
        return "bigint";
      case "bool":
        return "bool";
      case "date":
        return "date";
      case "decimal":
        return "decimal";
      case "integer":
        return "integer";
      case "json":
        return "json";
      case "string":
        return "text";
      case "timestamp":
        return "timestamp";
    }
  }

  if (type.startsWith("varchar")) return type;

  throw new Error(`cannot handle ${provider} ${type}`);
}

/**
 * Get the possible column types that the raw DB type can map to.
 */
export function dbToSchemaType(
  dbType: string,
  { provider }: MigrationConfig
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

  const typeName = stripParams(dbType);

  if (provider === "postgresql") {
    switch (typeName) {
      case "decimal":
      case "real":
      case "numeric":
      case "double precision":
        return ["decimal"];
      case "timestamp":
      case "timestamptz":
        return ["timestamp"];
      case "varchar":
        // return raw db type: varchar(n)
        return [dbType as Column["type"]];
      case "text":
        return ["string"];
      case "boolean":
      case "bool":
        return ["bool"];
      default:
        return [typeName as Column["type"]];
    }
  }

  if (provider === "mysql") {
    switch (typeName) {
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
        // return raw db type: varchar(n)
        return [dbType as Column["type"]];
      case "text":
        return ["string"];
      default:
        return [typeName as Column["type"]];
    }
  }

  if (provider === "mssql") {
    switch (typeName) {
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
        return ["string"];
      // return raw db type: varchar(n)
      case "nvarchar":
        return [dbType.slice(1) as Column["type"]];
      case "varchar":
        return [dbType as Column["type"]];
      default:
        return [typeName as Column["type"]];
    }
  }

  throw new Error("unhandled database provider: " + provider);
}

export async function getMigrations(schema: Schema, config: MigrationConfig) {
  const { db } = config;
  const metadata = await db.introspection.getTables();

  const newTables: Table[] = [];
  const alters: {
    tableName: string;
    added: Column[];
    modified: Column[];
    deleted: string[];
  }[] = [];

  for (const table of Object.values(schema.tables)) {
    const tableData = metadata.find((t) => t.name === table.name);

    if (!tableData) {
      newTables.push(table);
      continue;
    }

    const alter: (typeof alters)[number] = {
      tableName: table.name,
      added: [],
      modified: [],
      deleted: [],
    };

    for (const col of Object.values(table.columns)) {
      const column = tableData.columns.find((c) => c.name === col.name);
      if (!column) {
        alter.added.push(col);
        continue;
      }

      const converted = dbToSchemaType(column.dataType, config).map((v) =>
        v === "varchar(n)" && col.type.startsWith("varchar") ? col.type : v
      );

      if (!converted.includes(col.type)) {
        alter.modified.push(col);
      }
    }

    for (const col of tableData.columns) {
      const isDeleted = !Object.values(table.columns).some(
        (item) => item.name === col.name
      );

      if (isDeleted) {
        alter.deleted.push(col.name);
      }
    }

    if (
      alter.added.length > 0 ||
      alter.modified.length > 0 ||
      alter.deleted.length > 0
    )
      alters.push(alter);
  }

  const migrations: (
    | AlterTableColumnAlteringBuilder
    | CreateTableBuilder<string, string>
  )[] = [];

  function getColumnBuilderCallback(col: Column): ColumnBuilderCallback {
    return (build) => {
      if (col.default === "autoincrement") {
        if (!col.primarykey)
          throw new Error(
            "Columns using `autoincrement` as default value must be primary key"
          );

        switch (config.provider) {
          case "mysql":
          case "sqlite":
            build = build.autoIncrement();
            break;
          case "mssql":
            build = build.identity();
            break;
          case "postgresql":
            build = build.generatedAlwaysAsIdentity();
        }

        build = build.primaryKey();
      } else if (col.default === "now") {
        build = build.defaultTo(sql`CURRENT_TIMESTAMP`);
      } else if (typeof col.default === "object" && "sql" in col.default) {
        build = build.defaultTo(sql.raw(col.default.sql));
      } else if (typeof col.default === "object" && "value" in col.default) {
        build = build.defaultTo(col.default.value);
      }

      return build;
    };
  }

  for (const table of newTables) {
    let query = db.schema.createTable(table.name);

    for (const col of Object.values(table.columns)) {
      query = query.addColumn(
        col.name,
        schemaToDBType(col, config) as ColumnDataType,
        getColumnBuilderCallback(col)
      );
    }

    if (table.keys && table.keys.length > 0) {
      query = query.addPrimaryKeyConstraint(
        "primary_key",
        table.keys.map((key) => table.columns[key]!.name) as never[]
      );
    }

    migrations.push(query);
  }

  for (const alter of alters) {
    let query = db.schema.alterTable(
      alter.tableName
    ) as unknown as AlterTableColumnAlteringBuilder;

    for (const col of alter.added) {
      query = query.addColumn(
        col.name,
        schemaToDBType(col, config) as ColumnDataType,
        getColumnBuilderCallback(col)
      );
    }

    for (const col of alter.modified) {
      query = query.modifyColumn(
        col.name,
        schemaToDBType(col, config) as ColumnDataType,
        getColumnBuilderCallback(col)
      );
    }

    for (const key of alter.deleted) {
      query = query.dropColumn(key);
    }

    migrations.push(query);
  }

  async function runMigrations() {
    for (const migration of migrations) {
      await migration.execute();
    }
  }
  async function compileMigrations() {
    const compiled = migrations.map((m) => m.compile().sql);
    return compiled.join(";\n\n") + ";";
  }
  return {
    runMigrations,
    compileMigrations,
  };
}
