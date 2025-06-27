import {
  BinaryOperator,
  ExpressionBuilder,
  ExpressionWrapper,
  Kysely,
  sql,
} from "kysely";
import { createTables, getAbstractTableKeys, ORMAdapter } from "./base";
import {
  AbstractColumn,
  AbstractTable,
  AbstractTableInfo,
  Condition,
  ConditionType,
  SelectClause,
} from "..";
import { SqlBool } from "kysely";
import { Schema } from "../../schema";

export function buildWhere(
  condition: Condition,
  eb: ExpressionBuilder<any, any>
): ExpressionWrapper<any, any, SqlBool> {
  if (condition.type === ConditionType.Compare) {
    const left = condition.a;
    const op = condition.operator;
    let val = condition.b;

    if (!(val instanceof AbstractColumn) && left.encode) {
      // to database value
      val = left.encode(val);
    }

    let v: BinaryOperator;
    let rhs;

    switch (op) {
      case "contains":
        v = "like";
      case "not contains":
        v ??= "not like";
        rhs =
          val instanceof AbstractColumn
            ? sql`concat('%', ${eb.ref(val.getSQLName())}, '%')`
            : `%${val}%`;

        break;
      case "starts with":
        v = "like";
      case "not starts with":
        v ??= "not like";
        rhs =
          val instanceof AbstractColumn
            ? sql`concat(${eb.ref(val.getSQLName())}, '%')`
            : `${val}%`;

        break;
      case "ends with":
        v = "like";
      case "not ends with":
        v ??= "not like";
        rhs =
          val instanceof AbstractColumn
            ? sql`concat('%', ${eb.ref(val.getSQLName())})`
            : `%${val}`;
        break;
      default:
        v = op;
        rhs = val instanceof AbstractColumn ? eb.ref(val.getSQLName()) : val;
    }

    return eb(left.getSQLName(), v, rhs);
  }

  // Nested conditions
  if (condition.type === ConditionType.And) {
    return eb.and(condition.items.map((v) => buildWhere(v, eb)));
  }

  if (condition.type === ConditionType.Not) {
    return eb.not(buildWhere(condition.item, eb));
  }

  return eb.or(condition.items.map((v) => buildWhere(v, eb)));
}

/**
 * Transform object keys and encode values (e.g. for SQLite, date -> number)
 */
function encodeValues(values: Record<string, unknown>, table: AbstractTable) {
  const result: Record<string, unknown> = {};

  for (const k in values) {
    const col = table[k];
    const value = values[k];

    if (value === undefined || !col) continue;
    result[col.raw.name] = col.encode ? col.encode(value) : value;
  }

  return result;
}

/**
 * Transform object keys and decode values
 */
function decodeResult(
  result: Record<string, unknown>,
  table: AbstractTable,
  abstractTables: Record<string, AbstractTable>
) {
  const output: Record<string, unknown> = {};

  for (const k in result) {
    const segs = k.split(":", 2);
    const value = result[k];

    if (segs.length === 1) {
      const col = table[k]!;

      output[k] = col.decode ? col.decode(value) : value;
    }

    if (segs.length === 2) {
      const [tableName, colName] = segs as [string, string];
      const col = abstractTables[tableName]![colName]!;

      output[tableName] ??= {};
      (output[tableName] as Record<string, unknown>)[k] = col.decode
        ? col.decode(value)
        : value;
    }
  }

  return output;
}

// undefined if select all
function mapSelect(
  select: SelectClause,
  table: AbstractTable,
  abstractTables: Record<string, AbstractTable>,
  parent = ""
): string[] | undefined {
  if (select === true) {
    return;
  }

  const out: string[] = [];
  if (Array.isArray(select)) {
    for (const col of select) {
      const name = parent.length > 0 ? parent + ":" + col : col;

      out.push(`${table[col]!.getSQLName()} as "${name}"`);
    }

    return out;
  }

  for (const k in select) {
    const abstractTable = abstractTables[k]!;
    const child = mapSelect(
      select[k] === true ? getAbstractTableKeys(abstractTable) : select[k]!,
      abstractTable,
      abstractTables,
      k
    )!;

    out.push(...child);
  }

  return out;
}

// always use raw SQL names since Kysely is a query builder
export function fromKysely(schema: Schema, kysely: Kysely<any>): ORMAdapter {
  const abstractTables = createTables(schema, (name, table) => {
    const mapped = {
      _: new AbstractTableInfo(name, table),
    } as AbstractTable;

    for (const k in table.columns) {
      const column = table.columns[k]!;
      mapped[k] = new AbstractColumn(k, mapped._, column);
      mapped[k].encode = (v) => {
        if (v instanceof Date) return v.getTime();
        return v;
      };

      mapped[k].decode = (v) => {
        if (column.type === "date" || column.type === "timestamp") {
          if (typeof v === "number" || typeof v === "string")
            return new Date(v);
        }

        return v;
      };
    }

    return mapped;
  });

  return {
    tables: abstractTables,
    findFirst: async (from, v) => {
      const select = mapSelect(v.select, from, abstractTables);
      let query = kysely.selectFrom(from._.raw.name).limit(1);

      if (select) query = query.select(select);
      else query = query.selectAll();

      if (v.where) {
        query = query.where((eb) => buildWhere(v.where!, eb));
      }

      const result = await query.executeTakeFirst();
      if (!result) return null;

      return decodeResult(result, from, abstractTables);
    },

    findMany: async (from, v) => {
      const select = mapSelect(v.select, from, abstractTables);
      let query = kysely.selectFrom(from._.raw.name);

      if (select) query = query.select(select);
      else query = query.selectAll();

      if (v.where) {
        query = query.where((eb) => buildWhere(v.where!, eb));
      }

      return (await query.execute()).map((v) =>
        decodeResult(v, from, abstractTables)
      );
    },

    updateMany: async (from, v) => {
      let query = kysely
        .updateTable(from._.raw.name)
        .set(encodeValues(v.set, from));
      if (v.where) {
        query = query.where((eb) => buildWhere(v.where!, eb));
      }
      await query.execute();
    },

    createMany: async (table, values) => {
      await kysely
        .insertInto(table._.raw.name)
        .values(values.map((v) => encodeValues(v, table)))
        .execute();
    },
    deleteMany: async (table, v) => {
      let query = kysely.deleteFrom(table._.raw.name);
      if (v.where) {
        query = query.where((eb) => buildWhere(v.where!, eb));
      }
      await query.execute();
    },
  };
}
