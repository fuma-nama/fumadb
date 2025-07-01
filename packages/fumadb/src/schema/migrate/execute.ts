import {
  AlterTableBuilder,
  AlterTableColumnAlteringBuilder,
  ColumnBuilderCallback,
  ColumnDataType,
  Expression,
  Kysely,
  sql,
} from "kysely";
import { ColumnOperation, MigrationOperation, SQLNode } from "./shared";
import { SQLProvider } from "../../shared/providers";
import { AnyColumn } from "../create";

interface ExecuteConfig {
  db: Kysely<unknown>;
  provider: SQLProvider;
}

/**
 * Generate default value (ignore `auto` which is generated at runtime)
 */
function getDefaultValueAsSql(value: AnyColumn["default"]) {
  if (value === "now") {
    return sql`CURRENT_TIMESTAMP`;
  } else if (typeof value === "object" && "sql" in value) {
    return sql.raw(value.sql);
  } else if (typeof value === "object" && "value" in value) {
    return sql.lit(value.value);
  }
}

export function schemaToDBType(
  column: AnyColumn,
  provider: SQLProvider
): ColumnDataType | Expression<unknown> {
  const { type } = column;

  if (provider === "sqlite") {
    switch (type) {
      case "integer":
      case "timestamp":
      case "date":
      case "bool":
        return "integer";
      case "bigint":
        return "blob";
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
      case "bool":
        return sql`bit`;
      case "timestamp":
        return "datetime";
      case "integer":
        return sql`int`;
      case "string":
        return sql`varchar(max)`;
      default:
        if (type.startsWith("varchar")) return type as `varchar(${number})`;
        return type;
    }
  }

  if (provider === "postgresql") {
    switch (type) {
      case "bool":
        return "boolean";
      case "json":
        return "json";
      case "string":
        return "text";
      default:
        if (type.startsWith("varchar")) return type as `varchar(${number})`;
        return type;
    }
  }

  if (provider === "mysql") {
    switch (type) {
      case "bool":
        return "boolean";
      case "string":
        return "text";
      default:
        if (type.startsWith("varchar")) return type as `varchar(${number})`;
        return type;
    }
  }

  if (provider === "cockroachdb") {
    switch (type) {
      case "bool":
        return sql`bool`;
      // for string & varchar, use string
      case "string":
        return sql`string`;
      default:
        if (type.startsWith("varchar")) return sql`string`;
        return type;
    }
  }

  throw new Error(`cannot handle ${provider} ${type}`);
}

function getColumnBuilderCallback(col: AnyColumn): ColumnBuilderCallback {
  return (build) => {
    if (!col.nullable) {
      build = build.notNull();
    }

    const primaryKey = "id" in col && col.id;

    if (primaryKey) build = build.primaryKey();

    const defaultValue = getDefaultValueAsSql(col.default);
    if (defaultValue) build = build.defaultTo(defaultValue);
    return build;
  };
}

const errors = {
  IdColumnUpdate:
    "ID columns must not be updated, not every database supports updating primary keys and often requires workarounds.",
  SQLiteModify: "SQLite does not support modifying columns.",
};

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
        schemaToDBType(operation.value, provider),
        getColumnBuilderCallback(operation.value)
      );

    case "update-column-type":
      if ("id" in operation.value && operation.value.id)
        throw new Error(errors.IdColumnUpdate);

      if (provider === "sqlite") throw new Error(errors.SQLiteModify);

      if (provider === "mysql") {
        return builder.modifyColumn(
          operation.name,
          schemaToDBType(operation.value, provider),
          getColumnBuilderCallback(operation.value)
        );
      }

      return builder.alterColumn(operation.name, (col) =>
        col.setDataType(schemaToDBType(operation.value, provider))
      );

    case "update-column-default":
      if (provider === "sqlite") throw new Error(errors.SQLiteModify);

      return builder.alterColumn(operation.name, (col) =>
        col.setDefault(getDefaultValueAsSql(operation.value))
      );
    case "remove-column-default":
      if (provider === "sqlite") throw new Error(errors.SQLiteModify);

      return builder.alterColumn(operation.name, (col) => col.dropDefault());
    case "set-column-nullable":
      if (provider === "sqlite") throw new Error(errors.SQLiteModify);

      return builder.alterColumn(operation.name, (col) =>
        operation.value ? col.dropNotNull() : col.setNotNull()
      );
  }
}

export function execute(
  operation: MigrationOperation,
  config: ExecuteConfig
): SQLNode {
  const { db, provider } = config;

  switch (operation.type) {
    case "create-table":
      const value = operation.value;

      return db.schema.createTable(value.name).$call((table) => {
        for (const col of Object.values(operation.value.columns)) {
          table = table.addColumn(
            col.name,
            schemaToDBType(col, provider),
            getColumnBuilderCallback(col)
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
    case "kysely-builder":
      return operation.value;
    case "sql":
      const raw = sql.raw(operation.sql);
      return {
        async execute() {
          await raw.execute(db);
        },
        toOperationNode() {
          return raw.toOperationNode();
        },
        compile() {
          return raw.compile(db);
        },
      };
  }
}
