import {
  AbstractColumn,
  AbstractQuery,
  AbstractTable,
  AbstractTableInfo,
  Condition,
  SelectClause,
} from "..";
import { Schema, Table } from "../../schema";

export interface ORMAdapter {
  findFirst: {
    (
      from: AbstractTable,
      v: {
        select: SelectClause;
        where?: Condition;
      }
    ): Promise<Record<string, unknown> | null>;
  };

  findMany: {
    (
      from: AbstractTable,
      v: {
        select: SelectClause;
        where?: Condition;
      }
    ): Promise<Record<string, unknown>[]>;
  };

  updateMany: {
    (
      from: AbstractTable,
      v: {
        where?: Condition;
        set: Record<string, unknown>;
      }
    ): Promise<void>;
  };

  createMany: {
    (table: AbstractTable, values: Record<string, unknown>[]): Promise<void>;
  };

  deleteMany: {
    (
      table: AbstractTable,
      v: {
        where?: Condition;
      }
    ): Promise<void>;
  };

  mapTable?: (name: string, table: Table) => AbstractTable;
}

export function toORM<T extends Schema>(
  schema: T,
  adapter: ORMAdapter
): AbstractQuery<T> {
  const {
    mapTable = (name, table) => {
      const mapped = {
        _: new AbstractTableInfo(name, table),
      } as AbstractTable;

      for (const k in table.columns) {
        mapped[k] = new AbstractColumn(k, mapped._, table.columns[k]!);
      }

      return mapped;
    },
  } = adapter;

  const tables = Object.fromEntries(
    Object.entries(schema.tables).map(([k, v]) => {
      return [k, mapTable(k, v)];
    })
  );

  return {
    async createMany(table: AbstractTable, values) {
      await adapter.createMany(table, values);
    },
    async deleteMany(table: AbstractTable, v) {
      await adapter.deleteMany(table, v);
    },
    async findMany(table: AbstractTable, v) {
      const select = simplifySelect(v.select, table);
      const result = await adapter.findMany(table, {
        select,
        where: v.where,
      });

      return result;
    },
    async findFirst(table: AbstractTable, v) {
      const select = simplifySelect(v.select, table);
      const result = await adapter.findFirst(table, {
        select,
        where: v.where,
      });

      return result;
    },
    updateMany(table: AbstractTable, v) {
      return adapter.updateMany(table, v);
    },
    tables,
  } as AbstractQuery<T>;
}

function simplifySelect(input: true | SelectClause, table: AbstractTable) {
  if (input === true) {
    input = table;
  }

  return input;
}
