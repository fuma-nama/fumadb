import { ColumnBuilderCallback, Kysely, RawBuilder, sql } from "kysely";
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
    if (col instanceof IdColumn) build = build.primaryKey();

    const defaultValue = getDefaultValueAsSql(col.default);
    if (defaultValue) build = build.defaultTo(defaultValue);
    return build;
  };
}

const errors = {
  IdColumnUpdate:
    "ID columns must not be updated, not every database supports updating primary keys and often requires workarounds.",
  SQLiteUpdateForeignKeys:
    "In SQLite, you cannot modify foreign keys directly, use `recreate-table` instead.",
};

function executeColumn(
  tableName: string,
  operation: ColumnOperation,
  config: ExecuteConfig
): SQLNode[] {
  const { db, provider } = config;
  const next = () => db.schema.alterTable(tableName);
  const results: SQLNode[] = [];

  function registryUniqueColumn(col: AnyColumn) {
    if (provider === "sqlite") {
      results.push(
        db.schema
          .createIndex(col.getUniqueConstraintName(tableName))
          .on(tableName)
          .column(col.name)
          .unique()
      );
      return;
    }

    results.push(
      next().addUniqueConstraint(col.getUniqueConstraintName(tableName), [
        col.name,
      ])
    );
  }

  function deregisterUniqueColumn(col: AnyColumn) {
    if (provider === "sqlite") {
      results.push(db.schema.dropIndex(col.getUniqueConstraintName(tableName)));
      return;
    }

    results.push(next().dropConstraint(col.getUniqueConstraintName(tableName)));
  }

  switch (operation.type) {
    case "rename-column":
      results.push(next().renameColumn(operation.from, operation.to));
      return results;

    case "drop-column":
      results.push(next().dropColumn(operation.name));

      return results;
    case "create-column": {
      const col = operation.value;

      results.push(
        next().addColumn(
          col.name,
          sql.raw(schemaToDBType(col, provider)),
          getColumnBuilderCallback(col)
        )
      );

      if (col.unique) registryUniqueColumn(col);
      return results;
    }
    case "update-column":
      const col = operation.value;

      if (col instanceof IdColumn) throw new Error(errors.IdColumnUpdate);

      function onUpdateUnique() {
        if (col.unique) {
          registryUniqueColumn(col);
        } else {
          deregisterUniqueColumn(col);
        }
      }

      if (provider === "sqlite") {
        throw new Error(
          "SQLite doesn't support updating column, recreate the table instead."
        );
      }

      if (provider === "mysql") {
        results.push(
          next().modifyColumn(
            operation.name,
            sql.raw(schemaToDBType(col, provider)),
            getColumnBuilderCallback(col)
          )
        );
        if (operation.updateUnique) onUpdateUnique();
        return results;
      }

      if (operation.updateDataType)
        results.push(
          next().alterColumn(operation.name, (b) =>
            b.setDataType(sql.raw(schemaToDBType(col, provider)))
          )
        );

      if (operation.updateDefault) {
        results.push(
          next().alterColumn(operation.name, (build) => {
            if (!col.default) return build.dropDefault();

            const defaultValue = getDefaultValueAsSql(col.default);
            return build.setDefault(defaultValue);
          })
        );
      }

      if (operation.updateNullable) {
        results.push(
          next().alterColumn(operation.name, (build) =>
            col.nullable ? build.dropNotNull() : build.setNotNull()
          )
        );
      }

      if (operation.updateUnique) onUpdateUnique();
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
        return rawToNode(
          db,
          sql.raw(`EXEC sp_rename ${operation.from}, ${operation.to}`)
        );
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
      return rawToNode(db, sql.raw(operation.sql));
    case "recreate-table":
      const table = operation.value;
      const tempName = `_temp_${table.name}`;
      let result = execute(
        {
          type: "create-table",
          value: { ...table, name: tempName },
        },
        config
      );
      if (!Array.isArray(result)) result = [result];

      const colNames = Object.values(table.columns)
        .map((col) => `"${col.name}"`)
        .join(", ");

      result.push(
        rawToNode(
          db,
          sql.raw(
            `INSERT INTO "${tempName}" (${colNames}) SELECT ${colNames} FROM "${table.name}"`
          )
        )
      );
      result.push(
        db.schema.dropTable(table.name),
        db.schema.alterTable(tempName).renameTo(table.name)
      );

      return result;
    case "add-foreign-key": {
      if (provider === "sqlite")
        throw new Error(errors.SQLiteUpdateForeignKeys);
      const { table, value } = operation;

      return db.schema
        .alterTable(table)
        .addForeignKeyConstraint(
          value.name,
          value.columns,
          value.referencedTable,
          value.referencedColumns,
          (b) =>
            b
              .onUpdate(
                value.onUpdate.toLowerCase() as Lowercase<typeof value.onUpdate>
              )
              .onDelete(
                value.onDelete.toLowerCase() as Lowercase<typeof value.onDelete>
              )
        );
    }
    case "drop-foreign-key": {
      if (provider === "sqlite")
        throw new Error(errors.SQLiteUpdateForeignKeys);
      const { table, name } = operation;

      return db.schema.alterTable(table).dropConstraint(name);
    }
  }
}

function rawToNode(db: Kysely<any>, raw: RawBuilder<unknown>): SQLNode {
  return {
    compile() {
      return raw.compile(db);
    },
    execute() {
      return raw.execute(db);
    },
    toOperationNode() {
      return raw.toOperationNode();
    },
  };
}
