import type { AnyColumn, AnyTable } from "../schema/create";

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onUpdate: "RESTRICT" | "CASCADE" | "SET NULL";
  onDelete: "RESTRICT" | "CASCADE" | "SET NULL";
}

export type MigrationOperation =
  | TableOperation
  | {
      // warning: not supported by SQLite
      type: "add-foreign-key";
      table: string;
      value: ForeignKeyInfo;
    }
  | {
      // warning: not supported by SQLite
      type: "drop-foreign-key";
      table: string;
      name: string;
    }
  | CustomOperation;

export type CustomOperation = {
  type: "custom";
} & Record<string, unknown>;

export type TableOperation =
  | {
      type: "create-table";
      value: AnyTable;
    }
  | {
      type: "drop-table";
      name: string;
    }
  | {
      /**
       * Not supported by FumaDB
       * - update table's primary key
       */
      type: "update-table";
      name: string;
      value: ColumnOperation[];
    }
  | {
      type: "rename-table";
      from: string;
      to: string;
    }
  | {
      /**
       * Only for SQLite, recreate the table for some migrations (e.g. updating columns & foreign keys)
       *
       * Between the two tables, only columns with same ORM name will be transferred.
       */
      type: "recreate-table";
      previous: AnyTable;
      next: AnyTable;
    };

export type ColumnOperation =
  | {
      type: "rename-column";
      from: string;
      to: string;
    }
  | {
      type: "drop-column";
      name: string;
    }
  | {
      type: "create-column";
      value: AnyColumn;
    }
  | {
      /**
       * warning: Not supported by SQLite
       */
      type: "update-column";
      name: string;
      /**
       * For databases like MySQL, it requires the full definition for any modify column statement.
       * Hence, you need to specify the full information of your column here.
       *
       * Then, opt-in for in-detail modification for other databases that supports changing data type/nullable/default separately, such as PostgreSQL.
       */
      value: AnyColumn;

      updateNullable: boolean;
      updateDefault: boolean;
      updateDataType: boolean;
      updateUnique: boolean;
    };

export function isUpdated(
  op: Extract<ColumnOperation, { type: "update-column" }>
): boolean {
  return (
    op.updateDataType ||
    op.updateDefault ||
    op.updateNullable ||
    op.updateUnique
  );
}
