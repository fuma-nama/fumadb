import type { AbstractColumn } from ".";
import { AnyColumn, Column } from "../schema/create";

export enum ConditionType {
  And,
  Or,
  Compare,
  Not,
}

export type Condition =
  | {
      type: ConditionType.Compare;
      a: AbstractColumn;
      operator: Operator;
      b: AbstractColumn | unknown | null;
    }
  | {
      type: ConditionType.Or | ConditionType.And;
      items: Condition[];
    }
  | {
      type: ConditionType.Not;
      item: Condition;
    };

export type ConditionBuilder = {
  <T extends AnyColumn>(
    a: AbstractColumn<T>,
    operator: Operator,
    b: AbstractColumn<Column<T["type"]>> | T["$in"] | null
  ): Condition;

  and: (...v: (Condition | boolean)[]) => Condition | boolean;
  or: (...v: (Condition | boolean)[]) => Condition | boolean;
  not: (v: Condition | boolean) => Condition | boolean;

  isNull: (a: AbstractColumn) => Condition;
  isNotNull: (a: AbstractColumn) => Condition;
};

/**
 * From Kysely, excluded operators that's exclusive to some databases.
 */
export const operators = [
  "=",
  "!=",
  "<>",
  ">",
  ">=",
  "<",
  "<=",
  "in",
  "not in",
  "is",
  "is not",

  // replacement for `like` (Prisma doesn't support `like`)
  "contains",
  "starts with",
  "ends with",

  "not contains",
  "not starts with",
  "not ends with",

  // excluded `regexp` since MSSQL doesn't support it, may re-consider

  // JSON specific operators are not included, some databases don't support them
  // `match` requires additional extensions & configurations on SQLite and PostgreSQL
  // MySQL & SQLite requires workarounds to support `ilike`
  // containment operators such as `@>` are specific to PostgreSQL
  // `<=>` is specific to MySQL
] as const;

export type Operator = (typeof operators)[number];

export function createBuilder(): ConditionBuilder {
  const builder: ConditionBuilder = (a, operator, b) => {
    if (!operators.includes(operator))
      throw new Error(`Unsupported operator: ${operator}`);

    return {
      type: ConditionType.Compare,
      a,
      b,
      operator,
    };
  };

  builder.isNull = (a) => builder(a, "is", null);
  builder.isNotNull = (a) => builder(a, "is not", null);
  builder.not = (condition) => {
    if (typeof condition === "boolean") return !condition;

    return {
      type: ConditionType.Not,
      item: condition,
    };
  };

  builder.or = (...conditions) => {
    const out = {
      type: ConditionType.Or,
      items: [] as Condition[],
    } as const;

    for (const item of conditions) {
      if (item === true) return true;
      if (item === false) continue;

      out.items.push(item);
    }

    if (out.items.length === 0) return false;
    return out;
  };

  builder.and = (...conditions) => {
    const out = {
      type: ConditionType.And,
      items: [] as Condition[],
    } as const;

    for (const item of conditions) {
      if (item === true) continue;
      if (item === false) return false;

      out.items.push(item);
    }

    if (out.items.length === 0) return true;
    return out;
  };

  return builder;
}

export const builder = createBuilder();

export function buildCondition<T>(input: (builder: ConditionBuilder) => T): T {
  return input(builder);
}
