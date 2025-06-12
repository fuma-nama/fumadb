import { Column } from "../create";

export type MigrationOperations =
  | {
      type: "rename";
      columnFrom: string;
      columnTo: string;
    }
  | {
      type: "drop";
      column: string;
    }
  | {
      type: "create";
      column: Column;
    }
  | {
      type: "update";
      column: Column;
    };
