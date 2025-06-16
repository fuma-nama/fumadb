import { Column, Table } from "../create";

export type TableOperation =
  | {
      type: "create-table";
      value: Table;
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
      value: Column;
    }
  | {
      type: "update-column-type";
      name: string;
      /**
       * For MySQL, it requires the full defnition hence you need to specify the column
       */
      value: Column;
    }
  | {
      type: "update-column-default";
      name: string;
      value: Exclude<Column["default"], undefined>;
    }
  | {
      type: "remove-column-default";
      name: string;
    }
  | {
      type: "set-column-nullable";
      name: string;
      value: boolean;
    };
