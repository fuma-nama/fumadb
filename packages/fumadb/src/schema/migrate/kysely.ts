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

function getDefaultValueAsSql(col: Column) {
  if (col.default === "now") {
    return sql`CURRENT_TIMESTAMP`;
  } else if (typeof col.default === "object" && "sql" in col.default) {
    return sql.raw(col.default.sql);
  } else if (typeof col.default === "object" && "value" in col.default) {
    return sql.lit(col.default.value);
  }
}

export async function getMigrations(schema: Schema, config: MigrationConfig) {
  const { db } = config;
  const metadata = await db.introspection.getTables();

  const newTables: Table[] = [];
  const alters: {
    table: Table;
    added: Column[];
    deleted: string[];

    maybeModified: Column[];
  }[] = [];

  for (const table of Object.values(schema.tables)) {
    const tableData = metadata.find((t) => t.name === table.name);

    if (!tableData) {
      newTables.push(table);
      continue;
    }

    const alter: (typeof alters)[number] = {
      table,
      added: [],
      maybeModified: [],
      deleted: [],
    };

    for (const col of Object.values(table.columns)) {
      const column = tableData.columns.find((c) => c.name === col.name);
      if (!column) {
        alter.added.push(col);
        continue;
      }

      alter.maybeModified.push(col);
    }

    for (const col of tableData.columns) {
      const isDeleted = !Object.values(table.columns).some(
        (item) => item.name === col.name
      );

      // for non-nullable columns that's deleted:
      // the library may no longer pass them when creating new rows,
      // we need to drop them to ensure no error happen due to missing values of unused columns.
      if (isDeleted && !col.isNullable) {
        alter.deleted.push(col.name);
      }
    }

    if (
      alter.added.length > 0 ||
      alter.maybeModified.length > 0 ||
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
      if (!col.nullable) {
        build = build.notNull();
      }

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
      } else {
        const defaultValue = getDefaultValueAsSql(col);
        if (defaultValue) build = build.defaultTo(defaultValue);
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

  // TODO: handle changes in primary keys
  for (const alter of alters) {
    const { table } = alter;
    const primaryKeys = table.keys?.map((v) => table.columns[v]!.name);
    let query = db.schema.alterTable(
      table.name
    ) as unknown as AlterTableColumnAlteringBuilder;

    for (const col of alter.added) {
      query = query.addColumn(
        col.name,
        schemaToDBType(col, config) as ColumnDataType,
        getColumnBuilderCallback(col)
      );
    }

    for (const col of alter.maybeModified) {
      const isPrimaryKey = col.primarykey || primaryKeys?.includes(col.name);
      // ignore primary keys
      if (isPrimaryKey) continue;

      if (config.provider === "mysql") {
        query = query.modifyColumn(
          col.name,
          schemaToDBType(col, config) as ColumnDataType,
          getColumnBuilderCallback(col)
        );
        continue;
      }

      const raw = metadata
        .find(({ name }) => name === table.name)
        ?.columns.find(({ name }) => name === col.name)!;

      const isChanged = dbToSchemaType(raw.dataType, config).every((v) => {
        if (v === "varchar(n)" && col.type.startsWith("varchar")) return false;
        return v !== col.type;
      });

      if (isChanged) {
        query = query.alterColumn(col.name, (build) =>
          build.setDataType(schemaToDBType(col, config) as ColumnDataType)
        );
      }

      const nullable = col.nullable ?? false;
      if (nullable !== raw.isNullable) {
        query = query.alterColumn(col.name, (build) =>
          nullable ? build.dropNotNull() : build.setNotNull()
        );
      }

      // there's no easy way to compare default values of columns, so we update it regardless of current value
      if (raw.hasDefaultValue && !col.default) {
        query = query.alterColumn(col.name, (builder) => builder.dropDefault());
      } else {
        const defaultValue = getDefaultValueAsSql(col);

        if (defaultValue)
          query = query.alterColumn(col.name, (build) =>
            build.setDefault(defaultValue)
          );
      }
    }

    for (const key of alter.deleted) {
      query = query.dropColumn(key);
    }

    migrations.push(query);
  }

  async function runMigrations() {
    for (const migration of migrations) {
      console.log(migration.compile());
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
