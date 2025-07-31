import type {
  AnyColumn,
  AnySchema,
  AnyTable,
  NameVariants,
} from "../schema/create";
import {
  isUpdated,
  type ColumnOperation,
  type MigrationOperation,
} from "./shared";
import { deepEqual } from "../utils/deep-equal";
import type { Provider } from "../shared/providers";
import type { Kysely } from "kysely";
import type { RelationMode } from "../shared/config";
import { isDefaultVirtual } from "../schema/serialize";

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
  options: {
    db?: Kysely<any>;
    provider: Provider;
    relationMode?: RelationMode;

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
    relationMode = provider === "mssql" || provider === "mongodb"
      ? "fumadb"
      : "foreign-keys",
    dropUnusedTables = false,
    dropUnusedColumns = false,
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

  function onTableCheck(
    oldTable: AnyTable,
    newTable: AnyTable
  ): MigrationOperation[] | "recreate" {
    let operations: MigrationOperation[] = [];
    const colActions: ColumnOperation[] = [];

    if (getName(newTable.names) !== getName(oldTable.names)) {
      operations.push({
        type: "rename-table",
        from: getName(oldTable.names),
        to: getName(newTable.names),
      });
    }
    {
      const next = onTableUnusedForeignKeyCheck(oldTable, newTable);
      if (next === "recreate") return "recreate";
      operations.push(...next);
    }

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
        if (isDefaultVirtual(col, provider)) return;

        if (!col.default) return;
        if (typeof col.default === "object") return col.default.value;
        return col.default;
      }

      const action: ColumnOperation = {
        type: "update-column",
        name: getName(column.names),
        updateDataType: column.type !== oldColumn.type,
        updateDefault: !deepEqual(
          hashDefaultValue(column),
          hashDefaultValue(oldColumn)
        ),
        updateNullable: column.nullable !== oldColumn.nullable,
        updateUnique: column.unique !== oldColumn.unique,
        value: column,
      };

      if (isUpdated(action)) colActions.push(action);
    }

    if (
      provider === "sqlite" &&
      colActions.some((action) => !SqliteColumnOperations.includes(action.type))
    )
      return "recreate";

    operations.push(
      ...columnActionToOperation(getName(newTable.names), colActions)
    );

    {
      const next = onTableForeignKeyCheck(oldTable, newTable);
      if (next === "recreate") return "recreate";
      operations.push(...next);
    }
    {
      const next = onTableUnusedColumnsCheck(oldTable, newTable);
      if (next === "recreate") return "recreate";
      operations.push(...next);
    }

    return operations;
  }

  // after updating table name & columns
  function onTableForeignKeyCheck(
    oldTable: AnyTable,
    newTable: AnyTable
  ): MigrationOperation[] | "recreate" {
    const tableName = getName(newTable.names);
    const operations: MigrationOperation[] = [];

    for (const foreignKey of newTable.foreignKeys) {
      if (relationMode === "fumadb") break;
      const oldKey = oldTable.foreignKeys.find(
        (key) => key.name === foreignKey.name
      );

      if (!oldKey) {
        operations.push({
          type: "add-foreign-key",
          table: tableName,
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
            table: tableName,
          },
          {
            type: "add-foreign-key",
            table: tableName,
            value: foreignKey.compile(),
          }
        );
      }
    }

    // sqlite requires recreating the table
    if (operations.length > 0 && provider === "sqlite") {
      return "recreate";
    }

    return operations;
  }

  function onTableUnusedForeignKeyCheck(
    oldTable: AnyTable,
    newTable: AnyTable
  ): MigrationOperation[] | "recreate" {
    const tableName = getName(newTable.names);
    const operations: MigrationOperation[] = [];

    for (const oldKey of oldTable.foreignKeys) {
      const isUnused = newTable.foreignKeys.every(
        (key) => key.name !== oldKey.name
      );

      if (!isUnused) continue;
      if (provider === "sqlite") return "recreate";
      operations.push({
        type: "drop-foreign-key",
        name: oldKey.name,
        table: tableName,
      });
    }

    return operations;
  }

  function onTableUnusedColumnsCheck(
    oldTable: AnyTable,
    newTable: AnyTable
  ): MigrationOperation[] | "recreate" {
    const operations: MigrationOperation[] = [];

    for (const oldColumn of Object.values(oldTable.columns)) {
      const isUnused = !newTable.columns[oldColumn.ormName];
      const isRequired = !oldColumn.nullable && oldColumn.default == null;
      const shouldDrop = isUnused && (dropUnusedColumns || isRequired);

      if (!shouldDrop) continue;
      if (provider === "sqlite") return "recreate";

      // mssql doesn't auto drop unique index/constraint
      if (provider === "mssql" && oldColumn.unique) {
        operations.push({
          type: "kysely-builder",
          value: (db) =>
            db.schema
              .dropIndex(oldColumn.getUniqueConstraintName())
              .on(getName(newTable.names)),
        });
      }

      operations.push({
        type: "update-table",
        name: getName(newTable.names),
        value: [{ type: "drop-column", name: getName(oldColumn.names) }],
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

      const ops = onTableCheck(oldTable, table);
      if (ops === "recreate") {
        operations.push({
          type: "recreate-table",
          previous: oldTable,
          next: table,
        });
      } else {
        operations.push(...ops);
      }
    }

    for (const oldTable of Object.values(old.tables)) {
      if (!schema.tables[oldTable.ormName] && dropUnusedTables) {
        operations.push({
          type: "drop-table",
          name: getName(oldTable.names),
        });
      }
    }

    return operations;
  }

  return generate();
}
