import {
  AbstractColumn,
  AbstractQuery,
  AbstractTable,
  AbstractTableInfo,
  Condition,
  eb,
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
    async deleteMany(table: AbstractTable, { where }) {
      let conditions = where?.(eb);
      if (conditions === true) conditions = undefined;
      if (conditions === false) return;

      await adapter.deleteMany(table, { where: conditions });
    },
    async findMany(table: AbstractTable, { select, where }) {
      let conditions = where?.(eb);
      if (conditions === true) conditions = undefined;
      if (conditions === false) return [];

      return await adapter.findMany(table, {
        select: simplifySelect(select, table),
        where: conditions,
      });
    },
    async findFirst(table: AbstractTable, { select, where }) {
      let conditions = where?.(eb);
      if (conditions === true) conditions = undefined;
      if (conditions === false) return null;

      return await adapter.findFirst(table, {
        select: simplifySelect(select, table),
        where: conditions,
      });
    },
    updateMany(table: AbstractTable, { set, where }) {
      let conditions = where?.(eb);
      if (conditions === true) conditions = undefined;
      if (conditions === false) return;

      return adapter.updateMany(table, { set, where: conditions });
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
