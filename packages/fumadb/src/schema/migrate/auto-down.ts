import { Schema, Table } from "../create";
import { MigrationOperation, ColumnOperation } from "./shared";

export function revertOperation(
  prev: Schema,
  cur: Schema,
  operation: MigrationOperation
): MigrationOperation {
  function revertCol(
    previousTable: Table,
    _updatedTable: Table,
    col: ColumnOperation
  ): ColumnOperation | undefined {
    function findPreviousColumn(name: string) {
      const result = Object.values(previousTable.columns).find(
        (col) => col.name === name
      );

      if (!result)
        throw new Error(
          `Cannot find column ${name} from ${previousTable.name} table in schema ${prev.version}.`
        );

      return result;
    }

    switch (col.type) {
      case "create-column":
        return {
          type: "drop-column",
          name: col.value.name,
        };

      case "drop-column":
        return {
          type: "create-column",
          value: findPreviousColumn(col.name),
        };
      case "rename-column":
        return {
          type: "rename-column",
          from: col.to,
          to: col.from,
        };
      case "update-column-default":
      case "remove-column-default":
        const previousColumn = findPreviousColumn(col.name);
        if (!previousColumn.default)
          return {
            type: "remove-column-default",
            name: col.name,
          };

        return {
          type: "update-column-default",
          name: col.name,
          value: previousColumn.default,
        };
      case "set-column-nullable":
        return {
          type: "set-column-nullable",
          name: col.name,
          value: !col.value,
        };
      case "update-column-type":
        return {
          type: "update-column-type",
          name: col.name,
          value: findPreviousColumn(col.name),
        };
    }
  }

  function findTable(
    name: string,
    schema: Schema,
    schemaName = `schema ${schema.version}`
  ) {
    const result = Object.values(schema.tables).find(
      (table) => table.name === name
    );

    if (!result)
      throw new Error(`Cannot find table ${name} from ${schemaName}.`);

    return result;
  }

  switch (operation.type) {
    case "create-table":
      return {
        type: "drop-table",
        name: operation.value.name,
      };
    case "drop-table":
      const removedTable = findTable(operation.name, prev);

      return {
        type: "create-table",
        value: removedTable,
      };
    case "update-table":
      const updatedTable = findTable(operation.name, cur);
      const previousTable = findTable(operation.name, prev);

      return {
        type: "update-table",
        name: operation.name,
        value: operation.value
          .flatMap((op) => {
            const reverted = revertCol(previousTable, updatedTable, op);
            return reverted ? [reverted] : [];
          })
          .reverse(),
      };
  }
}
