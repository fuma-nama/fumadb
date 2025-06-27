import * as Drizzle from "drizzle-orm";
import { createTables, ORMAdapter } from "./base";
import {
  AbstractColumn,
  AbstractTable,
  AbstractTableInfo,
  Condition,
  ConditionType,
  SelectClause,
} from "..";
import { MySqlDatabase } from "drizzle-orm/mysql-core";
import { PgDatabase } from "drizzle-orm/pg-core";
import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { Column, Schema, Table } from "../../schema";

export type DrizzleDatabase =
  | MySqlDatabase<any, any>
  | PgDatabase<any, any>
  | BaseSQLiteDatabase<any, any>;

class DrizzleAbstractColumn extends AbstractColumn {
  drizzle: Drizzle.AnyColumn;

  constructor(
    name: string,
    table: AbstractTableInfo,
    column: Column,
    drizzle: Drizzle.AnyColumn
  ) {
    super(name, table, column);
    this.drizzle = drizzle;
  }
}

class DrizzleAbstractTable extends AbstractTableInfo {
  drizzle: Drizzle.Table;

  constructor(name: string, table: Table, drizzle: Drizzle.Table) {
    super(name, table);
    this.drizzle = drizzle;
  }
}

function buildWhere(condition: Condition): Drizzle.SQLWrapper | undefined {
  if (condition.type === ConditionType.Compare) {
    const left = (condition.a as DrizzleAbstractColumn).drizzle;
    const op = condition.operator;
    let right = condition.b;
    if (right instanceof DrizzleAbstractColumn) right = right.drizzle;
    let inverse = false;

    switch (op) {
      case "=":
        return Drizzle.eq(left, right);
      case "!=":
      case "<>":
        return Drizzle.ne(left, right);
      case ">":
        return Drizzle.gt(left, right);
      case ">=":
        return Drizzle.gte(left, right);
      case "<":
        return Drizzle.lt(left, right);
      case "<=":
        return Drizzle.lte(left, right);
      case "in": {
        // @ts-expect-error -- skip type check
        return Drizzle.inArray(left, right);
      }
      case "not in":
        // @ts-expect-error -- skip type check
        return Drizzle.notInArray(left, right);
      case "is":
        return right === null ? Drizzle.isNull(left) : Drizzle.eq(left, right);
      case "is not":
        return right === null
          ? Drizzle.isNotNull(left)
          : Drizzle.ne(left, right);
      case "not contains":
        inverse = true;
      case "contains":
        right =
          typeof right === "string"
            ? `%${right}%`
            : Drizzle.sql`concat('%', ${right}, '%')`;

        return inverse
          ? // @ts-expect-error -- skip type check
            Drizzle.notLike(left, right)
          : // @ts-expect-error -- skip type check
            Drizzle.like(left, right);
      case "not ends with":
        inverse = true;
      case "ends with":
        right =
          typeof right === "string"
            ? `%${right}`
            : Drizzle.sql`concat('%', ${right})`;

        return inverse
          ? // @ts-expect-error -- skip type check
            Drizzle.notLike(left, right)
          : // @ts-expect-error -- skip type check
            Drizzle.like(left, right);
      case "not starts with":
        inverse = true;
      case "starts with":
        right =
          typeof right === "string"
            ? `${right}%`
            : Drizzle.sql`concat(${right}, '%')`;

        return inverse
          ? // @ts-expect-error -- skip type check
            Drizzle.notLike(left, right)
          : // @ts-expect-error -- skip type check
            Drizzle.like(left, right);

      default:
        throw new Error(`Unsupported operator: ${op}`);
    }
  }

  if (condition.type === ConditionType.And)
    return Drizzle.and(...condition.items.map(buildWhere));

  if (condition.type === ConditionType.Not) {
    const result = buildWhere(condition.item);
    if (!result) return;

    return Drizzle.not(result);
  }

  return Drizzle.or(...condition.items.map(buildWhere));
}

type MappedSelect = {
  [key: string]: Drizzle.AnyColumn | Drizzle.Table | MappedSelect;
};

// undefined if select all
function mapSelect(
  select: SelectClause,
  table: AbstractTable,
  abstractTables: Record<string, AbstractTable>
): MappedSelect | undefined {
  if (select === true) {
    return;
  }

  const out: MappedSelect = {};

  if (Array.isArray(select)) {
    for (const item of select) {
      out[item] = (table[item]! as DrizzleAbstractColumn).drizzle;
    }

    return out;
  }

  for (const k in select) {
    const abstractTable = abstractTables[k]!;

    out[k] =
      mapSelect(select[k]!, abstractTable, abstractTables) ??
      (abstractTable._ as DrizzleAbstractTable).drizzle;
  }

  return out;
}

export function fromDrizzle(
  schema: Schema,
  db: DrizzleDatabase,
  tables: Record<string, Drizzle.Table>
): ORMAdapter {
  const abstractTables = createTables(schema, (name, table) => {
    const mapped = {
      _: new DrizzleAbstractTable(name, table, tables[name]!),
    } as unknown as AbstractTable;

    for (const k in table.columns) {
      mapped[k] = new DrizzleAbstractColumn(
        k,
        mapped._,
        table.columns[k]!,
        tables[name]!._.columns[k]!
      );
    }

    return mapped;
  });

  return {
    tables: abstractTables,
    findFirst: async (_from, v) => {
      const from = _from as unknown as DrizzleAbstractTable;
      const select = mapSelect(v.select, _from, abstractTables);

      let query = db
        // @ts-expect-error -- skip type check
        .select(select)
        // @ts-expect-error -- skip type check
        .from(from.drizzle)
        .limit(1);

      if (v.where) query = query.where(buildWhere(v.where));

      const results = await query;
      if (results.length === 0) return null;

      return results[0]!;
    },

    findMany: async (_from, v) => {
      const from = _from as unknown as DrizzleAbstractTable;
      const select = mapSelect(v.select, _from, abstractTables);
      // @ts-expect-error -- skip type check
      let query = db.select(select).from(from.drizzle);

      if (v.where) query = query.where(buildWhere(v.where));

      return await query;
    },

    updateMany: async (_from, v) => {
      const from = _from as unknown as DrizzleAbstractTable;
      let query = db
        // @ts-expect-error -- skip type check
        .update(from.drizzle)
        .set(v.set);

      if (v.where) {
        query = query.where(buildWhere(v.where));
      }

      await query;
    },

    createMany: async (_from, values) => {
      const from = _from as unknown as DrizzleAbstractTable;
      // @ts-expect-error -- skip type check
      await db.insert(from.drizzle).values(values);
    },

    deleteMany: async (_from, v) => {
      const from = _from as unknown as DrizzleAbstractTable;
      // @ts-expect-error -- skip type check
      let query = db.delete(from.drizzle);

      if (v.where) {
        query = query.where(buildWhere(v.where));
      }

      await query;
    },
  };
}
