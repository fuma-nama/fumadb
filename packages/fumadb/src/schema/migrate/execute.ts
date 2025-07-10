import { ColumnBuilderCallback, Kysely, sql } from "kysely";
import { ColumnOperation, MigrationOperation, SQLNode } from "./shared";
import { SQLProvider } from "../../shared/providers";
import { AnyColumn, IdColumn } from "../create";
import { schemaToDBType } from "../serialize";

interface ExecuteConfig {
  db: Kysely<any>;
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

function getColumnBuilderCallback(col: AnyColumn): ColumnBuilderCallback {
  return (build) => {
    if (!col.nullable) {
      build = build.notNull();
    }

    const primaryKey = col instanceof IdColumn;

    if (primaryKey) build = build.primaryKey();

    const defaultValue = getDefaultValueAsSql(col.default);
    if (defaultValue) build = build.defaultTo(defaultValue);
    return build;
  };
}

const errors = {
  IdColumnUpdate:
    "ID columns must not be updated, not every database supports updating primary keys and often requires workarounds.",
};

function executeColumn(
  tableName: string,
  operation: ColumnOperation,
  config: ExecuteConfig
) {
  const { db, provider } = config;
  const next = () => db.schema.alterTable(tableName);

  switch (operation.type) {
    case "rename-column":
      return next().renameColumn(operation.from, operation.to);

    case "drop-column":
      return next().dropColumn(operation.name);

    case "create-column":
      return next().addColumn(
        operation.value.name,
        sql.raw(schemaToDBType(operation.value, provider)),
        getColumnBuilderCallback(operation.value)
      );
    case "update-column":
      const results = [];

      if (operation.value instanceof IdColumn)
        throw new Error(errors.IdColumnUpdate);

      if (provider === "sqlite") {
        const tempName = `temp_${operation.value.name}`;

        results.push(next().renameColumn(operation.value.name, tempName));
        results.push(
          next().addColumn(
            operation.value.name,
            sql.raw(schemaToDBType(operation.value, provider)),
            getColumnBuilderCallback(operation.value)
          )
        );

        results.push(
          db.updateTable(tableName).set((ctx) => ({
            [operation.value.name]: ctx.ref(tempName),
          }))
        );

        results.push(next().dropColumn(tempName));
        return results;
      }

      if (provider === "mysql") {
        return next().modifyColumn(
          operation.name,
          sql.raw(schemaToDBType(operation.value, provider)),
          getColumnBuilderCallback(operation.value)
        );
      }

      if (operation.updateDataType)
        results.push(
          next().alterColumn(operation.name, (col) =>
            col.setDataType(sql.raw(schemaToDBType(operation.value, provider)))
          )
        );

      if (operation.updateDefault) {
        results.push(
          next().alterColumn(operation.name, (build) => {
            if (!operation.value.default) return build.dropDefault();

            const defaultValue = getDefaultValueAsSql(operation.value.default);
            return build.setDefault(defaultValue);
          })
        );
      }

      if (operation.updateNullable) {
        results.push(
          next().alterColumn(operation.name, (build) =>
            operation.value.nullable ? build.dropNotNull() : build.setNotNull()
          )
        );
      }

      return results;
  }
}

export function execute(
  operation: MigrationOperation,
  config: ExecuteConfig
): SQLNode | SQLNode[] {
  const { db, provider } = config;

  switch (operation.type) {
    case "create-table":
      const value = operation.value;

      return db.schema.createTable(value.name).$call((table) => {
        for (const col of Object.values(operation.value.columns)) {
          table = table.addColumn(
            col.name,
            sql.raw(schemaToDBType(col, provider)),
            getColumnBuilderCallback(col)
          );
        }

        for (const name in value.relations) {
          const relation = value.relations[name];
          if (!relation || relation.isImplied()) continue;
          const config = relation.foreignKeyConfig;
          if (!config) continue;

          const columns: string[] = [];
          const targetColumns: string[] = [];
          const targetTable = relation.table;

          for (const [left, right] of relation.on) {
            columns.push(value.columns[left]!.name);
            targetColumns.push(targetTable.columns[right]!.name);
          }

          table = table.addForeignKeyConstraint(
            `${name}_fk`,
            columns as any,
            targetTable.name,
            targetColumns,
            (b) =>
              b
                .onUpdate(
                  config.onUpdate.toLowerCase() as Lowercase<
                    typeof config.onUpdate
                  >
                )
                .onDelete(
                  config.onDelete.toLowerCase() as Lowercase<
                    typeof config.onDelete
                  >
                )
          );
        }

        return table;
      });
    case "rename-table":
      if (provider === "mssql") {
        const statement = sql`EXEC sp_rename ${operation.from}, ${operation.to}`;

        return {
          compile() {
            return statement.compile(db);
          },
          execute() {
            return statement.execute(db);
          },
          toOperationNode() {
            return statement.toOperationNode();
          },
        };
      }

      return db.schema.alterTable(operation.from).renameTo(operation.to);
    case "update-table":
      const results: SQLNode[] = [];

      for (const op of operation.value) {
        const res = executeColumn(operation.name, op, config);

        if (Array.isArray(res)) results.push(...res);
        else results.push(res);
      }

      return results;
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
