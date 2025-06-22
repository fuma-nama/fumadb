import { ExpressionBuilder, Kysely } from "kysely";
import { ORMAdapter } from "./base";
import { Condition, Operator, operators } from "..";

type Builder = (eb: ExpressionBuilder<any, any>) => any;

function buildWhere(condition: Condition): Builder {
  if (Array.isArray(condition)) {
    // [column, operator, value]
    if (
      condition.length === 3 &&
      !Array.isArray(condition[0]) &&
      typeof condition[0] === "object"
    ) {
      const [col, op, val] = condition;
      const name = col.name;
      if (!operators.includes(op as Operator))
        throw new Error(`Unsupported operator: ${op}`);

      return (eb) => eb(name, op as Operator, val);
    }

    // Nested conditions
    const chain: Builder[] = [];
    let isAnd = true;

    for (const child of condition) {
      if (typeof child === "string") {
        isAnd = child === "and";
        continue;
      }

      chain.push(buildWhere(child as Condition));
    }

    return (eb) => (isAnd ? eb.and(chain) : eb.or(chain));
  } else if (typeof condition === "boolean") {
    return (eb) => eb.lit(condition);
  }

  throw new Error("Invalid condition: " + JSON.stringify(condition, null, 2));
}

export function fromKysely(kysely: Kysely<any>): ORMAdapter {
  return {
    findOne: async (from, v) => {
      let query = kysely.selectFrom(from);
      if (v.where) {
        query = query.where(buildWhere(v.where));
      }
      if (v.select === true) {
        query = query.selectAll();
      } else if (typeof v.select === "object") {
        const select: string[] = [];

        for (const k in v.select) {
          if (v.select[k]) select.push(k);
        }

        query = query.select(select);
      }

      const result = await query.executeTakeFirst();
      return result ?? null;
    },

    findMany: async (from, v) => {
      let query = kysely.selectFrom(from);
      if (v.where) {
        query = query.where(buildWhere(v.where));
      }
      if (v.select === true) {
        query = query.selectAll();
      } else if (typeof v.select === "object") {
        const select: string[] = [];

        for (const k in v.select) {
          if (v.select[k]) select.push(k);
        }

        query = query.select(select);
      }

      return await query.execute();
    },

    updateMany: async (from, v) => {
      let query = kysely.updateTable(from).set(v.set);
      if (v.where) {
        query = query.where(buildWhere(v.where));
      }
      await query.execute();
    },

    createOne: async (table, values) => {
      const result = await kysely
        .insertInto(table)
        .values(values)
        .returningAll()
        .executeTakeFirst();
      return result ?? null;
    },

    createMany: async (table, values) => {
      const result = await kysely
        .insertInto(table)
        .values(values)
        .returningAll()
        .execute();
      return result;
    },

    deleteOne: async (table, v) => {
      const result = await kysely
        .deleteFrom(table)
        .where(buildWhere(v.where))
        .returningAll()
        .executeTakeFirst();
      return result ?? null;
    },

    deleteMany: async (table, v) => {
      let query = kysely.deleteFrom(table);
      if (v.where) {
        query = query.where(buildWhere(v.where));
      }
      await query.execute();
    },
  };
}
