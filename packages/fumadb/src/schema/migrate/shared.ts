import { Compilable, OperationNodeSource } from "kysely";
import { AnyColumn, AnyTable } from "../create";

export type SQLNode = OperationNodeSource &
  Compilable & {
    execute(): Promise<any>;
  };

export type MigrationOperation =
  | TableOperation
  | {
      type: "kysely-builder";
      value: SQLNode;
    }
  | {
      type: "sql";
      sql: string;
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
      type: "update-table";
      name: string;
      value: ColumnOperation[];
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
       * Warning: Not supported by SQLite
       */
      type: "update-column-type";
      name: string;
      /**
       * For MySQL, it requires the full defnition. Hence, you need to specify the full information of your column
       */
      value: AnyColumn;
    }
  | {
      /**
       * Warning: Not supported by SQLite
       */
      type: "update-column-default";
      name: string;
      value: Exclude<AnyColumn["default"], "auto" | undefined>;
    }
  | {
      /**
       * Warning: Not supported by SQLite
       */
      type: "remove-column-default";
      name: string;
    }
  | {
      /**
       * Warning: Not supported by SQLite
       */
      type: "set-column-nullable";
      name: string;
      value: boolean;
    };
