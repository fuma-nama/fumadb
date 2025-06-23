import {
  BinaryOperator,
  ExpressionBuilder,
  ExpressionWrapper,
  Kysely,
  sql,
} from "kysely";
import { ORMAdapter } from "./base";
import { Condition, Operator, operators } from "..";
import { SqlBool } from "kysely";
import { z } from "zod";

const columnSchema = z.object({
  name: z.string(),
});

type Builder = (
  eb: ExpressionBuilder<any, any>
) => ExpressionWrapper<any, any, SqlBool>;

export function buildWhere(condition: Condition): Builder {
  if (Array.isArray(condition)) {
    // [column, operator, value]
    const column = columnSchema.safeParse(condition[0]);

    if (condition.length === 3 && column.success) {
      const op = condition[1] as Operator;
      const val = columnSchema.safeParse(condition[2]);
      const name = column.data.name;

      if (!operators.includes(op))
        throw new Error(`Unsupported operator: ${op}`);

      return (eb) => {
        let v: BinaryOperator;
        let rhs;

        switch (op) {
          case "contains":
            v = "like";
          case "not contains":
            v ??= "not like";
            rhs = val.success
              ? sql`concat('%', ${eb.ref(val.data.name)}, '%')`
              : `%${condition[2]}%`;

            break;
          case "starts with":
            v = "like";
          case "not starts with":
            v ??= "not like";
            rhs = val.success
              ? sql`concat(${eb.ref(val.data.name)}, '%')`
              : `${condition[2]}%`;

            break;
          case "ends with":
            v = "like";
          case "not ends with":
            v ??= "not like";
            rhs = val.success
              ? sql`concat('%', ${eb.ref(val.data.name)})`
              : `%${condition[2]}`;
            break;
          default:
            v = op;
            rhs = val.success ? val.data.name : condition[2];
        }

        return eb(name, v, rhs);
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
      await kysely.insertInto(table).values(values).execute();
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
