import { type AnyColumn, Column } from "../schema/create";

export enum ConditionType {
  And,
  Or,
  Compare,
  Not,
}

export type Condition =
  | {
      type: ConditionType.Compare;
      a: AnyColumn;
      operator: Operator;
      b: AnyColumn | unknown | null;
    }
  | {
      type: ConditionType.Or | ConditionType.And;
      items: Condition[];
    }
  | {
      type: ConditionType.Not;
      item: Condition;
    };

declare const columnRef: unique symbol;

/**
 * A reference to another column of the same table, created by `b.ref()`.
 */
export interface ColumnRef<T = unknown> {
  readonly [columnRef]: T;
}

export type ConditionBuilder<Columns extends Record<string, AnyColumn>> = {
  <ColName extends keyof Columns>(
    a: ColName,
    operator: (typeof valueOperators)[number] | (typeof stringOperators)[number],
    b: Columns[ColName]["$in"] | null,
  ): Condition;

  /**
   * Compare against another column of the same table, see `ref()`.
   */
  <ColName extends keyof Columns>(
    a: ColName,
    operator: (typeof refOperators)[number],
    b: ColumnRef<NonNullable<Columns[ColName]["$in"]>>,
  ): Condition;

  <ColName extends keyof Columns>(
    a: ColName,
    operator: (typeof arrayOperators)[number],
    b: Columns[ColName]["$in"][],
  ): Condition;

  /**
   * Boolean values
   */
  <ColName extends keyof Columns>(a: ColName): Condition;

  and: (...v: (Condition | boolean)[]) => Condition | boolean;
  or: (...v: (Condition | boolean)[]) => Condition | boolean;
  not: (v: Condition | boolean) => Condition | boolean;

  isNull: (a: keyof Columns) => Condition;
  isNotNull: (a: keyof Columns) => Condition;

  /**
   * Reference another column of the same table, to compare against it with `=`, `!=`, `>`, `>=`, `<` or `<=`.
   *
   * A null on either side never matches.
   *
   * @example
   * ```ts
   * b("downloadCount", "<", b.ref("maxDownloads"))
   * ```
   */
  ref: <ColName extends keyof Columns>(
    name: ColName,
  ) => ColumnRef<NonNullable<Columns[ColName]["$in"]>>;
};

// replacement for `like` (Prisma doesn't support `like`)
const stringOperators = [
  "contains",
  "starts with",
  "ends with",

  "not contains",
  "not starts with",
  "not ends with",
  // excluded `regexp` since MSSQL doesn't support it, may re-consider
] as const;

const arrayOperators = ["in", "not in"] as const;

const valueOperators = ["=", "!=", ">", ">=", "<", "<=", "is", "is not"] as const;

/**
 * operators that accept a column reference (`b.ref()`) as the right-hand side
 */
export const refOperators = ["=", "!=", ">", ">=", "<", "<="] as const;

// JSON specific operators are not included, some databases don't support them
// `match` requires additional extensions & configurations on SQLite and PostgreSQL
// MySQL & SQLite requires workarounds to support `ilike`
export const operators = [...valueOperators, ...arrayOperators, ...stringOperators] as const;

export type Operator = (typeof operators)[number];

export function createBuilder<Columns extends Record<string, AnyColumn>>(
  columns: Columns,
): ConditionBuilder<Columns> {
  function col(name: keyof Columns) {
    const out = columns[name];
    if (!out) throw new Error(`[FumaDB] Invalid column name ${String(name)}`);

    return out;
  }

  const builder: ConditionBuilder<Columns> = (...args: [string, Operator, unknown] | [string]) => {
    if (args.length === 3) {
      const [a, operator, b] = args;

      if (!operators.includes(operator)) throw new Error(`Unsupported operator: ${operator}`);
      if (b instanceof Column && !(refOperators as readonly Operator[]).includes(operator))
        throw new Error(
          `[FumaDB] the \`${operator}\` operator doesn't accept a column reference, use one of: ${refOperators.join(", ")}.`,
        );

      return {
        type: ConditionType.Compare,
        a: col(a),
        b,
        operator,
      };
    }

    return {
      type: ConditionType.Compare,
      a: col(args[0]),
      operator: "=",
      b: true,
    };
  };

  builder.isNull = (a) => builder(a, "is", null);
  builder.isNotNull = (a) => builder(a, "is not", null);
  // the column itself, adapters compare against it when `b` is a `Column`
  builder.ref = (name) => col(name) as unknown as ColumnRef<never>;
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

export function buildCondition<T, Columns extends Record<string, AnyColumn>>(
  columns: Columns,
  input: (builder: ConditionBuilder<Columns>) => T,
): T {
  return input(createBuilder(columns));
}
