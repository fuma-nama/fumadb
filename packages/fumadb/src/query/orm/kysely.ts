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
  Condition,
  ConditionType,
  AnySelectClause,
} from "..";
import { SqlBool } from "kysely";
import { Schema } from "../../schema";
import { SQLProvider } from "../../shared/providers";
import { createId } from "../../cuid";

export function buildWhere(
  condition: Condition,
  eb: ExpressionBuilder<any, any>,
  provider: SQLProvider
): ExpressionWrapper<any, any, SqlBool> {
  if (condition.type === ConditionType.Compare) {
    const left = condition.a;
    const op = condition.operator;
    let val = condition.b;

    if (!(val instanceof AbstractColumn)) {
      val = encodeValue(val, left, provider);
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
    return eb.and(condition.items.map((v) => buildWhere(v, eb, provider)));
  }

  if (condition.type === ConditionType.Not) {
    return eb.not(buildWhere(condition.item, eb, provider));
  }

  return eb.or(condition.items.map((v) => buildWhere(v, eb, provider)));
}

function decodeValue(
  value: unknown,
  column: AbstractColumn,
  provider: SQLProvider
) {
  if (provider !== "sqlite") return value;

  const raw = column.raw;
  if (raw.type === "json" && typeof value === "string") {
    return JSON.parse(value);
  }

  if (
    (raw.type === "timestamp" || raw.type === "date") &&
    (typeof value === "number" || typeof value === "string")
  ) {
    return new Date(value);
  }

  if (raw.type === "bool" && typeof value === "number") return value === 1;

  if (raw.type === "bigint" && value instanceof Buffer) {
    return value.readBigInt64BE(0);
  }

  return value;
}

function encodeValue(
  value: unknown,
  column: AbstractColumn,
  provider: SQLProvider
) {
  if (provider !== "sqlite") return value;
  const raw = column.raw;

  if (value === null) return null;

  if (raw.type === "json") {
    return JSON.stringify(value);
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "boolean") return value ? 1 : 0;

  if (typeof value === "bigint") {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(value);
    return buf;
  }

  return value;
}

// always use raw SQL names since Kysely is a query builder
export function fromKysely(
  schema: Schema,
  kysely: Kysely<any>,
  provider: SQLProvider
): ORMAdapter {
  const abstractTables = createTables(schema);

  /**
   * Transform object keys and encode values (e.g. for SQLite, date -> number)
   */
  function encodeValues(
    values: Record<string, unknown>,
    table: AbstractTable,
    generateId: boolean
  ) {
    const result: Record<string, unknown> = {};

    for (const k in values) {
      const col = table[k];
      const value = values[k];

      if (value === undefined || !col) continue;
      result[col.raw.name] = encodeValue(value, col, provider);
    }

    if (generateId) {
      for (const k in table) {
        if (k === "_") continue;
        const col = table[k]!;

        if (
          col.isID() &&
          col.raw.default === "auto" &&
          (!(k in result) || result[k] === undefined)
        ) {
          result[k] = createId();
        }
      }
    }

    return result;
  }

  /**
   * Transform object keys and decode values
   */
  function decodeResult(result: Record<string, unknown>, table: AbstractTable) {
    const output: Record<string, unknown> = {};

    for (const k in result) {
      const segs = k.split(":", 2);
      const value = result[k];

      if (segs.length === 1) {
        output[k] = decodeValue(value, table[k]!, provider);
      }

      if (segs.length === 2) {
        const [tableName, colName] = segs as [string, string];
        const col = abstractTables[tableName]![colName]!;

        output[tableName] ??= {};
        const obj = output[tableName] as Record<string, unknown>;
        obj[k] = decodeValue(value, col, provider);
      }
    }

    return output;
  }

  // undefined if select all
  function mapSelect(
    select: AnySelectClause,
    table: AbstractTable,
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
        k
      )!;

      out.push(...child);
    }

    return out;
  }

  return {
    tables: abstractTables,
    async create(table, values) {
      const insertValues = encodeValues(values, table, true);
      let query = kysely.insertInto(table._.raw.name).values(insertValues);

      if (provider === "mssql") {
        return decodeResult(
          await query.outputAll("inserted").executeTakeFirstOrThrow(),
          table
        );
      }

      if (provider === "postgresql" || provider === "sqlite") {
        return decodeResult(
          await query.returningAll().executeTakeFirstOrThrow(),
          table
        );
      }

      for (const k in table) {
        if (k === "_") continue;
        const col = table[k]!;

        if (col.isID()) {
          const value = insertValues[k];
          if (!value) continue;

          await query.execute();
          return decodeResult(
            await kysely
              .selectFrom(table._.raw.name)
              .where(col.getSQLName(), "=", value)
              .limit(1)
              .executeTakeFirstOrThrow(),
            table
          );
        }
      }

      throw new Error(
        "cannot find value of id column, which is required for `create()`."
      );
    },
    async findFirst(from, v) {
      const select = mapSelect(v.select, from);
      let query = kysely.selectFrom(from._.raw.name).limit(1);

      if (select) query = query.select(select);
      else query = query.selectAll();

      if (v.where) {
        query = query.where((eb) => buildWhere(v.where!, eb, provider));
      }

      const result = await query.executeTakeFirst();
      if (!result) return null;

      return decodeResult(result, from);
    },

    async findMany(from, v) {
      const select = mapSelect(v.select, from);
      let query = kysely.selectFrom(from._.raw.name);

      if (select) query = query.select(select);
      else query = query.selectAll();

      if (v.where) {
        query = query.where((eb) => buildWhere(v.where!, eb, provider));
      }

      return (await query.execute()).map((v) => decodeResult(v, from));
    },

    async updateMany(from, v) {
      let query = kysely
        .updateTable(from._.raw.name)
        .set(encodeValues(v.set, from, false));
      if (v.where) {
        query = query.where((eb) => buildWhere(v.where!, eb, provider));
      }
      await query.execute();
    },

    async createMany(table, values) {
      await kysely
        .insertInto(table._.raw.name)
        .values(values.map((v) => encodeValues(v, table, true)))
        .execute();
    },
    async deleteMany(table, v) {
      let query = kysely.deleteFrom(table._.raw.name);
      if (v.where) {
        query = query.where((eb) => buildWhere(v.where!, eb, provider));
      }
      await query.execute();
    },
  };
}
