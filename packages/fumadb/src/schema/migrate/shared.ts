import { Compilable, OperationNodeSource } from "kysely";
import { AnyColumn, AnyTable } from "../create";

export type SQLNode = OperationNodeSource &
  Compilable & {
    execute(): Promise<any>;
  };

export interface ForeignKeyIntrospect {
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
      type: "kysely-builder";
      value: SQLNode;
    }
  | {
      type: "sql";
      sql: string;
    }
  | {
      // warning: not supported by SQLite
      type: "add-foreign-key";
      table: string;
      value: ForeignKeyIntrospect;
    }
  | {
      // warning: not supported by SQLite
      type: "drop-foreign-key";
      table: string;
      name: string;
    };

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
       * Not supported by SQLite:
       * - update columns (e.g. type, nullable, default)
       *
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
       * Only for SQLite, recreate the table for some migrations (e.g. dropping foreign keys)
       */
      type: "recreate-table";
      value: AnyTable;
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
      type: "update-column";
      name: string;
      /**
       * For MySQL & SQLite, it requires the full definition for any modify column statement.
       * Hence, you need to specify the full information of your column here.
       *
       * Then, opt-in for in-detail modification for other databases that supports changing data type/nullable/default separately, such as PostgreSQL.
       */
      value: AnyColumn;

      updateNullable: boolean;
      updateDefault: boolean;
      updateDataType: boolean;
    };
