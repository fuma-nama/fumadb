import {
  BinaryOperator,
  ExpressionBuilder,
  ExpressionWrapper,
  Kysely,
  sql,
} from "kysely";
import { ORMAdapter } from "./base";
import {
  AbstractColumn,
  AbstractTable,
  AbstractTableInfo,
  Condition,
  Operator,
  operators,
  SelectClause,
} from "..";
import { SqlBool } from "kysely";

type Builder = (
  eb: ExpressionBuilder<any, any>
) => ExpressionWrapper<any, any, SqlBool>;

export function buildWhere(condition: Condition): Builder {
  if (Array.isArray(condition)) {
    // [column, operator, value]
    if (condition.length === 3 && condition[0] instanceof AbstractColumn) {
      const left = condition[0];
      const op = condition[1] as Operator;
      let val = condition[2];

      if (!operators.includes(op))
        throw new Error(`Unsupported operator: ${op}`);

      if (!(val instanceof AbstractColumn) && left.encode) {
        // to database value
        val = left.encode(val);
      }

      return (eb) => {
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
            rhs =
              val instanceof AbstractColumn ? eb.ref(val.getSQLName()) : val;
        }

        return eb(left.getSQLName(), v, rhs);
      };
    }

    // Nested conditions
    return (eb) => {
      const chain = [];
      let isAnd = true;

      for (const child of condition) {
        if (typeof child === "string") {
          isAnd = child === "and";
          continue;
        }

        chain.push(buildWhere(child as Condition)(eb));
      }

      return isAnd ? eb.and(chain) : eb.or(chain);
    };
  } else if (typeof condition === "boolean") {
    return (eb) => eb.lit(condition);
  }

  throw new Error("Invalid condition: " + JSON.stringify(condition, null, 2));
}

function flattenSelect(input: SelectClause) {
  const result = new Map<string, AbstractColumn>();

  function scan(select: SelectClause, parent = "") {
    for (const k in select) {
      if (k === "_") continue;

      const path = parent.length > 0 ? parent + "." + k : k;

      if (select[k] instanceof AbstractColumn) {
        result.set(path, select[k]);
      } else if (select[k]) {
        scan(select[k], path);
      }
    }
  }

  scan(input);
  return result;
}

function toKyselySelect(flattened: Map<string, AbstractColumn>) {
  const result: string[] = [];

  for (const [k, v] of flattened.entries()) {
    result.push(`${v.getSQLName()} as ${k}`);
  }

  return result;
}

/**
 * Transform object keys and encode values (e.g. for SQLite, date -> number)
 */
function mapValues(values: Record<string, unknown>, table: AbstractTable) {
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
function mapResult(
  from: Record<string, unknown>,
  flattened: {
    get: (key: string) => AbstractColumn | undefined;
  }
) {
  const output: Record<string, unknown> = {};

  for (const k in from) {
    const col = flattened.get(k);
    if (!col) continue;

    let curr = output;
    const segs = k.split(".");

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!;

      if (i < segs.length - 1) {
        curr[seg] ??= {};
        curr = curr[seg] as Record<string, unknown>;
      } else {
        curr[seg] = col.decode ? col.decode(from[k]) : from[k];
      }
    }
  }

  return output;
}

// always use raw SQL names since Kysely is a query builder
export function fromKysely(kysely: Kysely<any>): ORMAdapter {
  return {
    mapTable(name, table) {
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
    },
    findFirst: async (from, v) => {
      const flattened = flattenSelect(v.select);
      let query = kysely
        .selectFrom(from._.raw.name)
        .select(toKyselySelect(flattened))
        .limit(1);

      if (v.where) {
        query = query.where(buildWhere(v.where));
      }

      const result = await query.executeTakeFirst();
      if (!result) return null;

      return mapResult(result, flattened);
    },

    findMany: async (from, v) => {
      const flattened = flattenSelect(v.select);
      let query = kysely
        .selectFrom(from._.raw.name)
        .select(toKyselySelect(flattened));

      if (v.where) {
        query = query.where(buildWhere(v.where));
      }

      return (await query.execute()).map((v) => mapResult(v, flattened));
    },

    updateMany: async (from, v) => {
      let query = kysely
        .updateTable(from._.raw.name)
        .set(mapValues(v.set, from));
      if (v.where) {
        query = query.where(buildWhere(v.where));
      }
      await query.execute();
    },

    createMany: async (table, values) => {
      await kysely
        .insertInto(table._.raw.name)
        .values(values.map((v) => mapValues(v, table)))
        .execute();
    },
    deleteMany: async (table, v) => {
      let query = kysely.deleteFrom(table._.raw.name);
      if (v.where) {
        query = query.where(buildWhere(v.where));
      }
      await query.execute();
    },
  };
}
