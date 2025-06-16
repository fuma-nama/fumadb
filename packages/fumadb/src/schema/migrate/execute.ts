import {
  AlterTableBuilder,
  AlterTableColumnAlteringBuilder,
  ColumnBuilderCallback,
  ColumnDataType,
  Expression,
  Kysely,
  sql,
} from "kysely";
import { ColumnOperation, TableOperation } from "./shared";
import { Provider } from "../providers";
import { Column } from "../create";

interface ExecuteConfig {
  db: Kysely<unknown>;
  provider: Provider;
}

function getDefaultValueAsSql(value: Column["default"]) {
  if (value === "now") {
    return sql`CURRENT_TIMESTAMP`;
  } else if (typeof value === "object" && "sql" in value) {
    return sql.raw(value.sql);
  } else if (typeof value === "object" && "value" in value) {
    return sql.lit(value.value);
  }
}

export function schemaToDBType(
  type: Column["type"],
  provider: Provider
): ColumnDataType | Expression<unknown> {
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
        return sql`bit`;
      case "date":
        return "date";
      case "timestamp":
        return "datetime";
      case "decimal":
        return "decimal";
      case "integer":
        return sql`int`;
      case "json":
        return "json";
      case "string":
        return sql`varchar(max)`;
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
        return "boolean";
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

  if (type.startsWith("varchar")) return type as `varchar(${number})`;

  throw new Error(`cannot handle ${provider} ${type}`);
}

function getColumnBuilderCallback(
  col: Column,
  provider: Provider
): ColumnBuilderCallback {
  return (build) => {
    if (!col.nullable) {
      build = build.notNull();
    }

    if (col.default === "autoincrement") {
      if (!col.primarykey)
        throw new Error(
          "Columns using `autoincrement` as default value must be primary key"
        );

      switch (provider) {
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
      const defaultValue = getDefaultValueAsSql(col.default);
      if (defaultValue) build = build.defaultTo(defaultValue);
    }

    return build;
  };
}

function executeColumn(
  builder: AlterTableBuilder | AlterTableColumnAlteringBuilder,
  operation: ColumnOperation,
  config: ExecuteConfig
) {
  const { provider } = config;
  switch (operation.type) {
    case "rename-column":
      return builder.renameColumn(operation.from, operation.to);

    case "drop-column":
      return builder.dropColumn(operation.name);

    case "create-column":
      return builder.addColumn(
        operation.value.name,
        schemaToDBType(operation.value.type, provider),
        getColumnBuilderCallback(operation.value, provider)
      );

    case "update-column-type":
      if (provider === "mysql") {
        return builder.modifyColumn(
          operation.name,
          schemaToDBType(operation.value.type, provider),
          getColumnBuilderCallback(operation.value, provider)
        );
      }

      return builder.alterColumn(operation.name, (col) =>
        col.setDataType(schemaToDBType(operation.value.type, provider))
      );

    case "update-column-default":
      return builder.alterColumn(operation.name, (col) =>
        col.setDefault(getDefaultValueAsSql(operation.value))
      );
    case "remove-column-default":
      return builder.alterColumn(operation.name, (col) => col.dropDefault());
    case "set-column-nullable":
      return builder.alterColumn(operation.name, (col) =>
        operation.value ? col.dropNotNull() : col.setNotNull()
      );
  }
}

export function execute(operation: TableOperation, config: ExecuteConfig) {
  const { db, provider } = config;

  switch (operation.type) {
    case "create-table":
      const value = operation.value;

      return db.schema.createTable(value.name).$call((table) => {
        for (const col of Object.values(operation.value.columns)) {
          table = table.addColumn(
            col.name,
            schemaToDBType(col.type, provider),
            getColumnBuilderCallback(col, provider)
          );
        }

        if (value.keys && value.keys.length > 0) {
          table = table.addPrimaryKeyConstraint(
            `${operation.value.name}_pkey`,
            value.keys.map((key) => value.columns[key]!.name) as never[]
          );
        }

        return table;
      });
    case "update-table":
      let builder: AlterTableBuilder | AlterTableColumnAlteringBuilder =
        db.schema.alterTable(operation.name);

      for (const op of operation.value) {
        builder = executeColumn(builder, op, config);
      }

      return builder as AlterTableColumnAlteringBuilder;
    case "drop-table":
      return db.schema.dropTable(operation.name);
  }
}
