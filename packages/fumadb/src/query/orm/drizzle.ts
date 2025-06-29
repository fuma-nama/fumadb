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
import { Column, Schema, Table } from "../../schema";
import { SQLProvider } from "../../shared/providers";

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
  _db: unknown,
  tables: Record<string, Drizzle.Table>,
  provider: SQLProvider
): ORMAdapter {
  // to avoid complex types problems, let's embrace `any`!
  const db = _db as any;

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
    async findFirst(table, v) {
      const drizzleTable = (table._ as DrizzleAbstractTable).drizzle;
      const select = mapSelect(v.select, table, abstractTables);

      let query = db.select(select).from(drizzleTable).limit(1);

      if (v.where) query = query.where(buildWhere(v.where));

      const results = await query;
      if (results.length === 0) return null;

      return results[0]!;
    },

    async findMany(table, v) {
      const drizzleTable = (table._ as DrizzleAbstractTable).drizzle;
      const select = mapSelect(v.select, table, abstractTables);
      let query = db.select(select).from(drizzleTable);

      if (v.where) query = query.where(buildWhere(v.where));

      return await query;
    },

    async updateMany(table, v) {
      const drizzleTable = (table._ as DrizzleAbstractTable).drizzle;

      let query = db.update(drizzleTable).set(v.set);

      if (v.where) {
        query = query.where(buildWhere(v.where));
      }

      await query;
    },

    async create(table, values) {
      const drizzleTable = (table._ as DrizzleAbstractTable).drizzle;

      const query = db.insert(drizzleTable).values(values);

      if (provider === "sqlite" || provider === "postgresql") {
        return (await query.returning())[0];
      }

      const obj = (await query.$returningId())[0];
      const conditons = [];
      for (const k in obj) {
        const col = table[k]! as DrizzleAbstractColumn;

        conditons.push(Drizzle.eq(col.drizzle, obj[k]));
      }

      return db
        .select()
        .from(drizzleTable)
        .where(Drizzle.and(...conditons))
        .limit(1);
    },

    async createMany(table, values) {
      const drizzleTable = (table._ as DrizzleAbstractTable).drizzle;

      await db.insert(drizzleTable).values(values);
    },

    async deleteMany(table, v) {
      const drizzleTable = (table._ as DrizzleAbstractTable).drizzle;
      let query = db.delete(drizzleTable);

      if (v.where) {
        query = query.where(buildWhere(v.where));
      }

      await query;
    },
  };
}
