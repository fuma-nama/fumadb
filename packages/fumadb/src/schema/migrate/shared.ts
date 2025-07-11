import { Compilable, OperationNodeSource } from "kysely";
import { AnyColumn, AnyRelation, AnyTable } from "../create";

export type SQLNode = OperationNodeSource &
  Compilable & {
    execute(): Promise<any>;
  };

export const getInternalTables = (namespace: string) => ({
  versions: `private_${namespace}_version`,
});

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

export function compileForeignKey(relation: AnyRelation): ForeignKeyIntrospect {
  if (!relation.foreignKeyConfig) throw new Error("Foreign key required");

  function getColumnRawName(table: AnyTable, ormName: string) {
    const col = table.columns[ormName];
    if (!col)
      throw new Error(
        `Failed to resolve column name ${ormName} in table ${table.ormName}.`
      );

    return col.name;
  }

  return {
    ...relation.foreignKeyConfig,
    referencedTable: relation.table.name,
    referencedColumns: relation.on.map(([, right]) =>
      getColumnRawName(relation.table, right)
    ),
    columns: relation.on.map(([left]) =>
      getColumnRawName(relation.referencer, left)
    ),
  };
}
