import { Kysely } from "kysely";
import { SQLProvider } from "../../shared/providers";
import { AnySchema, AnyTable } from "../create";
import {
  ColumnOperation,
  compileForeignKey,
  MigrationOperation,
} from "./shared";
import { deepEqual } from "../../utils/deep-equal";

/**
 * Generate migration by comparing two schemas
 */
export function generateMigrationFromSchema(
  old: AnySchema,
  schema: AnySchema,
  options: {
    db: Kysely<any>;
    provider: SQLProvider;

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
    db,
    dropUnusedTables = false,
    dropUnusedColumns = false,
  } = options;
  const operations: MigrationOperation[] = [];

  // after updating table (make sure to use new table name & columns)
  function onTableForeignKeyCheck(oldTable: AnyTable, newTable: AnyTable) {
    const actions: MigrationOperation[] = [];

    for (const relation of Object.values(newTable.relations)) {
      if (!relation.foreignKeyConfig) continue;
      const oldRelation = oldTable.relations[relation.ormName];

      if (!oldRelation || !oldRelation.foreignKeyConfig) {
        actions.push({
          type: "add-foreign-key",
          table: newTable.name,
          value: compileForeignKey(relation),
        });
        continue;
      }

      const newKey = relation.foreignKeyConfig;
      const oldKey = oldRelation.foreignKeyConfig;
      const isUpdated =
        newKey.name !== oldKey.name ||
        newKey.onDelete !== oldKey.onDelete ||
        newKey.onUpdate !== oldKey.onUpdate ||
        !deepEqual(relation.on, oldRelation.on);

      if (isUpdated) {
        actions.push(
          {
            type: "drop-foreign-key",
            name: oldKey.name,
            table: newTable.name,
          },
          {
            type: "add-foreign-key",
            table: newTable.name,
            value: compileForeignKey(relation),
          }
        );
      }
    }

    for (const oldRelation of Object.values(oldTable.relations)) {
      if (!oldRelation.foreignKeyConfig) continue;
      const isUnused =
        !newTable.relations[oldRelation.ormName]?.foreignKeyConfig;

      if (isUnused) {
        actions.push({
          type: "drop-foreign-key",
          name: oldRelation.foreignKeyConfig.name,
          table: newTable.name,
        });
      }
    }

    // sqlite requires recreating the table
    if (actions.length > 0 && provider === "sqlite") {
      operations.push({
        type: "recreate-table",
        value: newTable,
      });
      return;
    }

    operations.push(...actions);
  }

  function onTableCheck(oldTable: AnyTable, newTable: AnyTable) {
    let actions: ColumnOperation[] = [];

    for (const column of Object.values(newTable.columns)) {
      const oldColumn = oldTable.columns[column.ormName];

      if (!oldColumn) {
        actions.push({
          type: "create-column",
          value: column,
        });
        continue;
      }

      if (column.name !== oldColumn.name) {
        actions.push({
          type: "rename-column",
          from: oldColumn.name,
          to: column.name,
        });
      }
      const updateNullable = column.nullable !== oldColumn.nullable;
      const updateDataType = column.type !== oldColumn.type;
      const updateDefault = deepEqual(column.default, oldColumn.default);
      const updateUnique = column.unique !== oldColumn.unique;

      if (updateNullable || updateDataType || updateDataType || updateUnique) {
        actions.push({
          type: "update-column",
          name: column.name,
          updateDataType,
          updateDefault,
          updateNullable,
          updateUnique,
          value: column,
        });
      }
    }

    for (const oldColumn of Object.values(oldTable.columns)) {
      const isUnused = !newTable.columns[oldColumn.ormName];
      const isRequired = !oldColumn.nullable && !oldColumn.default;

      if (isUnused && (dropUnusedColumns || isRequired)) {
        if (oldColumn.unique && provider === "sqlite")
          operations.push({
            type: "kysely-builder",
            value: db.schema.dropIndex(
              oldColumn.getUniqueConstraintName(oldTable.name)
            ),
          });

        actions.push({
          type: "drop-column",
          name: oldColumn.name,
        });
      }
    }

    if (newTable.name !== oldTable.name) {
      operations.push({
        type: "rename-table",
        from: oldTable.name,
        to: newTable.name,
      });
    }

    function pushActions() {
      if (actions.length === 0) return;

      if (provider === "mysql" || provider === "postgresql") {
        operations.push({
          type: "update-table",
          name: newTable.name,
          value: actions,
        });
        return;
      }
      for (const action of actions) {
        operations.push({
          type: "update-table",
          name: newTable.name,
          value: [action],
        });
      }
    }

    // SQLite: recreate the table to update columns
    if (
      provider === "sqlite" &&
      actions.some((action) => action.type === "update-column")
    ) {
      actions = actions.filter((action) => action.type !== "update-column");
      pushActions();
      operations.push({
        type: "recreate-table",
        value: newTable,
      });
      // no need to update foreign key if it's recreated
      return;
    }

    pushActions();
    onTableForeignKeyCheck(oldTable, newTable);
  }

  for (const table of Object.values(schema.tables)) {
    const oldTable = old.tables[table.ormName];
    if (!oldTable) {
      operations.push({
        type: "create-table",
        value: table,
      });
      continue;
    }

    onTableCheck(oldTable, table);
  }

  for (const oldTable of Object.values(old.tables)) {
    if (!schema.tables[oldTable.ormName] && dropUnusedTables) {
      operations.push({
        type: "drop-table",
        name: oldTable.name,
      });
    }
  }

  return operations;
}
