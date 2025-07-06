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
      /**
       * Not supported by SQLite:
       * - update columns (e.g. type, nullable, default)
       *
       * Not supported by FumaDB
       * - update table's foreign key
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
      // TODO: I think we should remove them for compatibility, migration should be simpler
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
