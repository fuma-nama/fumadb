import {
  compileForeignKey,
  type AnyColumn,
  type AnySchema,
  type AnyTable,
  type NameVariants,
} from "../schema/create";
import {
  isUpdated,
  type ColumnOperation,
  type MigrationOperation,
} from "./shared";
import { deepEqual } from "../utils/deep-equal";
import type { Provider } from "../shared/providers";
import type { RelationMode } from "../shared/config";

type Operation = MigrationOperation & { enforce?: "pre" | "post" };

/**
 * Generate migration by comparing two schemas
 */
export function generateMigrationFromSchema(
  old: AnySchema,
  schema: AnySchema,
  options: {
    provider: Provider;
    relationMode?: RelationMode;

    /**
     * Drop tables if no longer exist in latest schema.
     *
     * This only detects tables from schema, user tables won't be affected.
     */
    dropUnusedTables?: boolean;
    dropUnusedColumns?: boolean;
  }
): MigrationOperation[] {
  const {
    provider,
    relationMode = provider === "mssql" || provider === "mongodb"
      ? "fumadb"
      : "foreign-keys",
    dropUnusedTables = true,
    dropUnusedColumns = true,
  } = options;

  function getName(names: NameVariants) {
    return provider === "mongodb" ? names.mongodb : names.sql;
  }

  function columnActionToOperation(
    tableName: string,
    actions: ColumnOperation[]
  ): MigrationOperation[] {
    if (actions.length === 0) return [];

    if (
      provider === "mysql" ||
      provider === "postgresql" ||
      provider === "mongodb"
    ) {
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

  function onTableRenameCheck(oldTable: AnyTable, newTable: AnyTable) {
    const operations: Operation[] = [];

    if (getName(newTable.names) !== getName(oldTable.names)) {
      operations.push({
        type: "rename-table",
        from: getName(oldTable.names),
        to: getName(newTable.names),
      });
    }

    return operations;
  }

  function onTableColumnsCheck(
    oldTable: AnyTable,
    newTable: AnyTable
  ): Operation[] {
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

      if (getName(column.names) !== getName(oldColumn.names)) {
        colActions.push({
          type: "rename-column",
          from: getName(oldColumn.names),
          to: getName(column.names),
        });
      }

      /**
       * Generate hash to compare default values
       */
      function hashDefaultValue(col: AnyColumn) {
        if (!col.default || "runtime" in col.default) return;
        if (col.type === "string" && provider === "mysql") return;

        return col.default.value;
      }

      const action: ColumnOperation = {
        type: "update-column",
        name: getName(column.names),
        updateDataType: column.type !== oldColumn.type,
        updateDefault: !deepEqual(
          hashDefaultValue(column),
          hashDefaultValue(oldColumn)
        ),
        updateNullable: column.isNullable !== oldColumn.isNullable,
        updateUnique: column.isUnique !== oldColumn.isUnique,
        value: column,
      };

      if (isUpdated(action)) colActions.push(action);
    }

    return columnActionToOperation(getName(newTable.names), colActions);
  }

  function onTableForeignKeyCheck(
    oldTable: AnyTable,
    newTable: AnyTable
  ): Operation[] {
    const tableName = getName(newTable.names);
    const operations: Operation[] = [];
    if (relationMode === "fumadb") return operations;

    for (const foreignKey of newTable.foreignKeys) {
      const compiled = compileForeignKey(foreignKey, "sql");
      const oldKey = oldTable.foreignKeys.find(
        (key) => key.name === foreignKey.name
      );

      if (!oldKey) {
        operations.push({
          type: "add-foreign-key",
          table: tableName,
          value: compiled,
          enforce: "post",
        });
        continue;
      }

      const isUpdated = !deepEqual(compiled, compileForeignKey(oldKey, "sql"));
      if (isUpdated) {
        operations.push(
          {
            type: "drop-foreign-key",
            name: oldKey.name,
            table: tableName,
            enforce: "post",
          },
          {
            type: "add-foreign-key",
            table: tableName,
            value: compiled,
            enforce: "post",
          }
        );
      }
    }

    return operations;
  }

  function onTableUnusedForeignKeyCheck(
    oldTable: AnyTable,
    newTable: AnyTable
  ): MigrationOperation[] {
    const operations: MigrationOperation[] = [];

    for (const oldKey of oldTable.foreignKeys) {
      const isUnused = newTable.foreignKeys.every(
        (key) => key.name !== oldKey.name
      );

      if (!isUnused) continue;
      operations.push({
        type: "drop-foreign-key",
        name: oldKey.name,
        table: getName(oldTable.names),
      });
    }

    return operations;
  }

  function onTableUnusedColumnsCheck(
    oldTable: AnyTable,
    newTable: AnyTable
  ): Operation[] {
    const operations: Operation[] = [];

    for (const oldColumn of Object.values(oldTable.columns)) {
      const isUnused = !newTable.columns[oldColumn.ormName];
      const isRequired = !oldColumn.isNullable && !oldColumn.default;
      const shouldDrop = isUnused && (dropUnusedColumns || isRequired);

      if (!shouldDrop) continue;

      const actions: ColumnOperation[] = [
        { type: "drop-column", name: getName(oldColumn.names) },
      ];

      // mssql doesn't auto drop unique index/constraint
      if (provider === "mssql" && oldColumn.isUnique) {
        const withoutUnique = oldColumn.clone();
        withoutUnique.isUnique = false;

        actions.unshift({
          type: "update-column",
          name: getName(oldColumn.names),
          value: withoutUnique,
          updateDataType: false,
          updateDefault: false,
          updateNullable: false,
          updateUnique: true,
        });
      }

      operations.push({
        type: "update-table",
        name: getName(newTable.names),
        value: actions,
        enforce: "post",
      });
    }

    return operations;
  }

  function reorder(operations: Operation[]) {
    const out: MigrationOperation[] = [];
    for (const item of operations) {
      if (item.enforce === "pre") out.push(item);
    }

    for (const item of operations) {
      if (!item.enforce) out.push(item);
    }

    for (const item of operations) {
      if (item.enforce === "post") out.push(item);
    }

    return out;
  }

  function generate() {
    const operations: Operation[] = [];

    for (const table of Object.values(schema.tables)) {
      const oldTable = old.tables[table.ormName];
      if (!oldTable) {
        operations.push({
          type: "create-table",
          value: table,
        });
        continue;
      }

      operations.push(
        ...onTableUnusedForeignKeyCheck(oldTable, table),
        ...onTableRenameCheck(oldTable, table),
        ...onTableColumnsCheck(oldTable, table),
        ...onTableForeignKeyCheck(oldTable, table),
        ...onTableUnusedColumnsCheck(oldTable, table)
      );
    }

    for (const oldTable of Object.values(old.tables)) {
      if (!schema.tables[oldTable.ormName] && dropUnusedTables) {
        operations.push({
          type: "drop-table",
          name: getName(oldTable.names),
          enforce: "post",
        });
      }
    }

    return reorder(operations);
  }

  return generate();
}
