import type { AnyColumn, AnyTable } from "../schema/create";
import type { Condition, ConditionBuilder } from "./condition-builder";

type ColumnsOf<T extends AnyTable> = T["columns"];

type ColumnKeyOfType<T extends AnyTable, Type> = {
  [K in keyof ColumnsOf<T>]: ColumnsOf<T>[K]["type"] extends Type ? K : never;
}[keyof ColumnsOf<T>];

const numericTypes = ["integer", "bigint", "decimal"];
const comparableTypes = [...numericTypes, "string", "date", "timestamp"];
const ungroupableTypes = ["json", "binary"];

type NumericType = "integer" | "bigint" | "decimal";
type ComparableType = NumericType | "string" | `varchar(${number})` | "date" | "timestamp";

/**
 * Columns that `sum` and `avg` accept.
 */
export type NumericColumnKey<T extends AnyTable> = ColumnKeyOfType<T, NumericType>;

/**
 * Columns that `min` and `max` accept.
 */
export type ComparableColumnKey<T extends AnyTable> = ColumnKeyOfType<T, ComparableType>;

/**
 * Columns that `groupBy` accepts.
 */
export type GroupableColumnKey<T extends AnyTable> = Exclude<
  keyof ColumnsOf<T>,
  ColumnKeyOfType<T, "json" | "binary">
>;

export interface AggregateOptions<
  T extends AnyTable = AnyTable,
  Group extends GroupableColumnKey<T>[] | undefined = GroupableColumnKey<T>[] | undefined,
  Count extends boolean = boolean,
  Sum extends NumericColumnKey<T> = NumericColumnKey<T>,
  Avg extends NumericColumnKey<T> = NumericColumnKey<T>,
  Min extends ComparableColumnKey<T> = ComparableColumnKey<T>,
  Max extends ComparableColumnKey<T> = ComparableColumnKey<T>,
> {
  where?: (eb: ConditionBuilder<T["columns"]>) => Condition | boolean;

  /**
   * Aggregate each group of rows with the same values in these columns, a null is a value of its own.
   *
   * The result is an array of the groups, in no particular order.
   */
  groupBy?: Group;

  /**
   * Count the rows
   */
  count?: Count;

  /**
   * Sum the values of numeric columns, nulls are skipped. It is `0` when there's no value.
   */
  sum?: Sum[];

  /**
   * Average the values of numeric columns, nulls are skipped. It is `null` when there's no value.
   */
  avg?: Avg[];

  /**
   * The smallest value of number, string and date columns, nulls are skipped. It is `null` when there's no value.
   */
  min?: Min[];

  /**
   * The largest value of number, string and date columns, nulls are skipped. It is `null` when there's no value.
   */
  max?: Max[];
}

type Out<T extends AnyTable, K> = K extends keyof ColumnsOf<T>
  ? NonNullable<ColumnsOf<T>[K]["$out"]>
  : never;

export type AggregateValues<
  T extends AnyTable,
  Count extends boolean,
  Sum extends PropertyKey,
  Avg extends PropertyKey,
  Min extends PropertyKey,
  Max extends PropertyKey,
> = (Count extends true ? { count: number } : {}) &
  ([Sum] extends [never] ? {} : { sum: { [K in Sum]: Out<T, K> } }) &
  ([Avg] extends [never] ? {} : { avg: { [K in Avg]: number | null } }) &
  ([Min] extends [never] ? {} : { min: { [K in Min]: Out<T, K> | null } }) &
  ([Max] extends [never] ? {} : { max: { [K in Max]: Out<T, K> | null } });

export type AggregateResult<
  T extends AnyTable,
  Group extends PropertyKey[] | undefined,
  Values,
> = Group extends PropertyKey[]
  ? ({
      group: {
        [K in Group[number]]: K extends keyof ColumnsOf<T> ? ColumnsOf<T>[K]["$out"] : never;
      };
    } & Values)[]
  : Values;

/**
 * `AggregateOptions` without the type of table
 */
export interface AnyAggregateOptions {
  groupBy?: PropertyKey[];
  count?: boolean;
  sum?: PropertyKey[];
  avg?: PropertyKey[];
  min?: PropertyKey[];
  max?: PropertyKey[];
}

/**
 * Aggregate options for adapters, columns are resolved.
 */
export interface SimplifiedAggregateOptions {
  where?: Condition;
  groupBy: AnyColumn[];
  sum: AnyColumn[];
  avg: AnyColumn[];
  min: AnyColumn[];
  max: AnyColumn[];
}

/**
 * A row returned by adapters, keyed by the ORM names of columns.
 *
 * Adapters decode the values of `group`, `min` and `max` like the column values of `findMany`,
 * numbers may be returned in any form (e.g. string, Decimal, Long).
 */
export interface AdapterAggregateRow {
  group: Record<string, unknown>;
  count: unknown;
  sum: Record<string, unknown>;
  avg: Record<string, unknown>;
  min: Record<string, unknown>;
  max: Record<string, unknown>;
}

export function resolveAggregateOptions(
  table: AnyTable,
  options: AnyAggregateOptions,
): Omit<SimplifiedAggregateOptions, "where"> {
  function resolve(kind: string, names: PropertyKey[] = [], check: (type: string) => boolean) {
    return names.map((name) => {
      const col = table.columns[name as string];
      if (!col) throw new Error(`[FumaDB] unknown column \`${table.ormName}.${String(name)}\`.`);
      if (!check(col.type))
        throw new Error(
          `[FumaDB] \`${kind}\` doesn't accept the ${col.type} column \`${table.ormName}.${col.ormName}\`.`,
        );

      return col;
    });
  }

  const isNumeric = (type: string) => numericTypes.includes(type);
  const isComparable = (type: string) =>
    comparableTypes.includes(type) || type.startsWith("varchar");

  return {
    groupBy: resolve("groupBy", options.groupBy, (type) => !ungroupableTypes.includes(type)),
    sum: resolve("sum", options.sum, isNumeric),
    avg: resolve("avg", options.avg, isNumeric),
    min: resolve("min", options.min, isComparable),
    max: resolve("max", options.max, isComparable),
  };
}

function toNumber(value: unknown): number {
  return Number(typeof value === "object" ? String(value) : value);
}

/**
 * Convert a number in any form (e.g. string, Decimal, Long) to the value type of a numeric column.
 */
function toColumnNumber(value: unknown, col: AnyColumn): number | bigint {
  if (col.type !== "bigint") return toNumber(value);
  if (typeof value === "bigint") return value;

  const str = String(value);
  // e.g. `12.000` from a decimal sum
  return /^-?\d+$/.test(str) ? BigInt(str) : BigInt(Math.trunc(Number(str)));
}

/**
 * Normalize the rows of an adapter to the result of `aggregate()`.
 */
export function toAggregateResult(
  options: AnyAggregateOptions,
  resolved: Omit<SimplifiedAggregateOptions, "where">,
  rows: AdapterAggregateRow[],
): unknown {
  function values(row: AdapterAggregateRow | undefined) {
    const out: Record<string, unknown> = {};
    if (options.count) out.count = row ? toNumber(row.count) : 0;

    function map(
      kind: "sum" | "avg" | "min" | "max",
      convert: (value: unknown, col: AnyColumn) => unknown,
    ) {
      if (!options[kind]) return;
      const result: Record<string, unknown> = {};

      for (const col of resolved[kind]) {
        result[col.ormName] = convert(row?.[kind][col.ormName] ?? null, col);
      }

      out[kind] = result;
    }

    map("sum", (value, col) => toColumnNumber(value ?? 0, col));
    map("avg", (value) => (value === null ? null : toNumber(value)));
    const extreme = (value: unknown, col: AnyColumn) => {
      if (value === null || !numericTypes.includes(col.type)) return value;
      return toColumnNumber(value, col);
    };
    map("min", extreme);
    map("max", extreme);
    return out;
  }

  if (!options.groupBy) return values(rows[0]);

  // without columns to group by, SQL databases return a row even when nothing matches
  return rows
    .filter((row) => toNumber(row.count) > 0)
    .map((row) => {
      const group: Record<string, unknown> = {};
      for (const col of resolved.groupBy) group[col.ormName] = row.group[col.ormName] ?? null;

      return { group, ...values(row) };
    });
}

/**
 * For adapters that select the aggregates of a row as flat columns: the alias of each aggregate.
 */
export const aggregateAliases = {
  count: "c",
  groupBy: (i: number) => `g${i}`,
  sum: (i: number) => `s${i}`,
  avg: (i: number) => `a${i}`,
  min: (i: number) => `n${i}`,
  max: (i: number) => `x${i}`,
};

/**
 * Read a flat row selected with `aggregateAliases`.
 *
 * @param decode - decode a column value, like the result of `findMany`
 */
export function fromAliasedRow(
  row: Record<string, unknown>,
  options: SimplifiedAggregateOptions,
  decode: (value: unknown, col: AnyColumn) => unknown,
): AdapterAggregateRow {
  function read(
    kind: "groupBy" | "sum" | "avg" | "min" | "max",
    transform?: (value: unknown, col: AnyColumn) => unknown,
  ) {
    const out: Record<string, unknown> = {};

    options[kind].forEach((col, i) => {
      const value = row[aggregateAliases[kind](i)] ?? null;
      out[col.ormName] = value === null || !transform ? value : transform(value, col);
    });

    return out;
  }

  return {
    count: row[aggregateAliases.count],
    group: read("groupBy", decode),
    sum: read("sum"),
    avg: read("avg"),
    min: read("min", decode),
    max: read("max", decode),
  };
}

/**
 * Integer and decimal columns are summed and averaged as decimals: MS SQL Server sums `int` in `int`, which overflows, and averages it with integer division.
 */
export function aggregatesAsDecimal(col: AnyColumn): boolean {
  return col.type === "integer" || col.type === "decimal";
}
