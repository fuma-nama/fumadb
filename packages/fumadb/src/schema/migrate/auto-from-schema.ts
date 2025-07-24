import { AnySchema, AnyTable } from "../create";
import { ColumnOperation, MigrationOperation } from "./shared";
import { deepEqual } from "../../utils/deep-equal";
import { KyselyConfig } from "../../shared/config";

const SqliteColumnOperations: ColumnOperation["type"][] = [
  "create-column",
  "rename-column",
];

/**
 * Generate migration by comparing two schemas
 */
export function generateMigrationFromSchema(
  old: AnySchema,
  schema: AnySchema,
  options: KyselyConfig & {
    /**
     * Drop tables if no longer exist in latest schema.
     *
     * This only detects from schema, user tables won't be affected.
     */
    dropUnusedTables?: boolean;

    /**
     * Note: even by explicitly disabling it, it still drops unused columns that's required.
     */
    dropUnusedColumns?: boolean;
  }
): MigrationOperation[] {
  const {
    provider,
    relationMode = provider === "mssql" ? "fumadb" : "foreign-keys",
    dropUnusedTables = false,
    dropUnusedColumns = false,
  } = options;

  function columnActionToOperation(
    tableName: string,
    actions: ColumnOperation[]
  ): MigrationOperation[] {
    if (actions.length === 0) return [];

    if (provider === "mysql" || provider === "postgresql") {
      return [
        {
          type: "update-table",
          name: tableName,
          value: actions,
        },
      ];
    }

    return actions.map((action) => ({
      type: "update-table",
      name: tableName,
      value: [action],
    }));
  }

  function onTableCheck(
    oldTable: AnyTable,
    newTable: AnyTable
  ): MigrationOperation[] {
    const operations: MigrationOperation[] = [];
    const colActions: ColumnOperation[] = [];

    for (const column of Object.values(newTable.columns)) {
      const oldColumn = oldTable.columns[column.ormName];

      if (!oldColumn) {
        colActions.push({
          type: "create-column",
          value: column,
        });
        continue;
      }

      if (column.names.sql !== oldColumn.names.sql) {
        colActions.push({
          type: "rename-column",
          from: oldColumn.names.sql,
          to: column.names.sql,
        });
      }
      const updateNullable = column.nullable !== oldColumn.nullable;
      const updateDataType = column.type !== oldColumn.type;
      const updateDefault = deepEqual(column.default, oldColumn.default);
      const updateUnique = column.unique !== oldColumn.unique;

      if (updateNullable || updateDataType || updateDataType || updateUnique) {
        colActions.push({
          type: "update-column",
          name: column.names.sql,
          updateDataType,
          updateDefault,
          updateNullable,
          updateUnique,
          value: column,
        });
      }
    }

    if (
      provider === "sqlite" &&
      colActions.some((action) => !SqliteColumnOperations.includes(action.type))
    ) {
      // SQLite: recreate the table as a workaround
      return [
        {
          type: "recreate-table",
          previous: oldTable,
          next: newTable,
        },
      ];
    }

    if (newTable.names.sql !== oldTable.names.sql) {
      operations.push({
        type: "rename-table",
        from: oldTable.names.sql,
        to: newTable.names.sql,
      });
    }
    operations.push(...columnActionToOperation(newTable.names.sql, colActions));

    const next = onTableForeignKeyCheck(oldTable, newTable);
    if (next.some((action) => action.type === "recreate-table")) {
      return next;
    }

    operations.push(...next);
    return operations;
  }

  // after updating table name & columns
  function onTableForeignKeyCheck(
    oldTable: AnyTable,
    newTable: AnyTable
  ): MigrationOperation[] {
    const operations: MigrationOperation[] = [];

    for (const foreignKey of newTable.foreignKeys) {
      if (relationMode === "fumadb") break;
      const oldKey = oldTable.foreignKeys.find(
        (key) => key.name === foreignKey.name
      );

      if (!oldKey) {
        operations.push({
          type: "add-foreign-key",
          table: newTable.names.sql,
          value: foreignKey.compile(),
        });
        continue;
      }

      const isUpdated = !deepEqual(foreignKey.compile(), oldKey.compile());
      if (isUpdated) {
        operations.push(
          {
            type: "drop-foreign-key",
            name: oldKey.name,
            table: newTable.names.sql,
          },
          {
            type: "add-foreign-key",
            table: newTable.names.sql,
            value: foreignKey.compile(),
          }
        );
      }
    }

    for (const oldKey of oldTable.foreignKeys) {
      const isUnused = newTable.foreignKeys.every(
        (key) => key.name !== oldKey.name
      );

      if (isUnused) {
        operations.push({
          type: "drop-foreign-key",
          name: oldKey.name,
          table: newTable.names.sql,
        });
      }
    }

    // sqlite requires recreating the table
    if (operations.length > 0 && provider === "sqlite") {
      return [
        {
          type: "recreate-table",
          previous: oldTable,
          next: newTable,
        },
      ];
    }

    const next = onTableUnusedColumnsCheck(oldTable, newTable);
    if (next.some((action) => action.type === "recreate-table")) return next;

    operations.push(...next);
    return operations;
  }

  function onTableUnusedColumnsCheck(
    oldTable: AnyTable,
    newTable: AnyTable
  ): MigrationOperation[] {
    const operations: MigrationOperation[] = [];
    for (const oldColumn of Object.values(oldTable.columns)) {
      const isUnused = !newTable.columns[oldColumn.ormName];
      const isRequired = !oldColumn.nullable && !oldColumn.default;
      const shouldDrop = isUnused && (dropUnusedColumns || isRequired);

      if (!shouldDrop) continue;
      if (provider === "sqlite") {
        return [
          {
            type: "recreate-table",
            previous: oldTable,
            next: newTable,
          },
        ];
      }

      // mssql doesn't auto drop unique index/constraint
      if (provider === "mssql" && oldColumn.unique) {
        operations.push({
          type: "kysely-builder",
          value: (db) =>
            db.schema
              .dropIndex(oldColumn.getUniqueConstraintName())
              .on(newTable.names.sql),
        });
      }

      operations.push({
        type: "update-table",
        name: newTable.names.sql,
        value: [{ type: "drop-column", name: oldColumn.names.sql }],
      });
    }

    return operations;
  }

  function generate() {
    const operations: MigrationOperation[] = [];

    for (const table of Object.values(schema.tables)) {
      const oldTable = old.tables[table.ormName];
      if (!oldTable) {
        operations.push({
          type: "create-table",
          value: table,
        });
        continue;
      }

      operations.push(...onTableCheck(oldTable, table));
    }

    for (const oldTable of Object.values(old.tables)) {
      if (!schema.tables[oldTable.ormName] && dropUnusedTables) {
        operations.push({
          type: "drop-table",
          name: oldTable.names.sql,
        });
      }
    }

    return operations;
  }

  return generate();
}
