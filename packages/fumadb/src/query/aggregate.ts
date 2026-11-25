import { isNumericType } from "../utils/parse";
import type { AnyColumn, AnyTable } from "../schema/create";
import type { Condition, ConditionBuilder } from "./condition-builder";

type ColumnsOf<T extends AnyTable> = T["columns"];

type ColumnKeyOfType<T extends AnyTable, Type> = {
  [K in keyof ColumnsOf<T>]: ColumnsOf<T>[K]["type"] extends Type ? K : never;
}[keyof ColumnsOf<T>];

type NumericType = "integer" | "bigint" | "decimal" | `decimal(${number}, ${number})`;
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

/**
 * A path in the result: `count`, `group.<column>`, `sum.<column>`, `avg.<column>`, `min.<column>` or `max.<column>`.
 */
type AggregatePath<Group, Count, Sum, Avg, Min, Max> =
  | (Count extends true ? "count" : never)
  | (Group extends PropertyKey[] ? `group.${Group[number] & string}` : never)
  | `sum.${Sum & string}`
  | `avg.${Avg & string}`
  | `min.${Min & string}`
  | `max.${Max & string}`;

type AggregateOrderBy<Path> = [path: Path, "asc" | "desc"];

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
   * The result is an array of the groups, in no particular order unless `orderBy` is set.
   */
  groupBy?: Group;

  /**
   * Count the rows
   */
  count?: Count;

  /**
   * Sum the values of numeric columns, nulls are skipped. It is `null` when there's no value.
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

  /**
   * Sort the groups by their columns or aggregates, e.g. `["sum.size", "desc"]`. Nulls are ordered by the database, like `orderBy` of `findMany`.
   */
  orderBy?: Group extends PropertyKey[]
    ? NoInfer<
        | AggregateOrderBy<AggregatePath<Group, Count, Sum, Avg, Min, Max>>
        | AggregateOrderBy<AggregatePath<Group, Count, Sum, Avg, Min, Max>>[]
      >
    : never;

  /**
   * The maximum number of groups
   */
  limit?: Group extends PropertyKey[] ? number : never;

  /**
   * The number of groups to skip
   */
  offset?: Group extends PropertyKey[] ? number : never;
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
  ([Sum] extends [never] ? {} : { sum: { [K in Sum]: Out<T, K> | null } }) &
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
  groupBy?: string[];
  count?: boolean;
  sum?: string[];
  avg?: string[];
  min?: string[];
  max?: string[];
  orderBy?: [string, "asc" | "desc"] | [string, "asc" | "desc"][];
  limit?: number;
  offset?: number;
}

const kinds = ["groupBy", "sum", "avg", "min", "max"] as const;
type SelectionKind = (typeof kinds)[number];

/**
 * A group column or an aggregate to select, under its alias.
 */
export interface AggregateSelection {
  kind: SelectionKind;
  col: AnyColumn;
  alias: string;
}

/**
 * The alias of the row count, adapters always select it.
 */
export const countAlias = "c";

/**
 * Aggregate options for adapters, columns are resolved.
 */
export interface SimplifiedAggregateOptions {
  where?: Condition;
  groupBy: AnyColumn[];
  selections: AggregateSelection[];
  /**
   * `selection` is undefined for the row count
   */
  orderBy: { alias: string; selection?: AggregateSelection; mode: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
}

/**
 * A row returned by adapters, keyed by the aliases of the row count and selections.
 *
 * Adapters decode group columns, `min` and `max` like the column values of `findMany` (see `decodeAggregateRow()`).
 * Other numbers can be in any form (e.g. string, Decimal, Long).
 */
export type AggregateRow = Record<string, unknown>;

const comparableTypes = ["string", "date", "timestamp"];
const ungroupableTypes = ["json", "binary"];

const accepts: Record<SelectionKind, (type: string) => boolean> = {
  groupBy: (type) => !ungroupableTypes.includes(type),
  sum: isNumericType,
  avg: isNumericType,
  min: (type) =>
    isNumericType(type) || comparableTypes.includes(type) || type.startsWith("varchar"),
  max: (type) =>
    isNumericType(type) || comparableTypes.includes(type) || type.startsWith("varchar"),
};

export function resolveAggregateOptions(
  table: AnyTable,
  options: AnyAggregateOptions,
): Omit<SimplifiedAggregateOptions, "where"> {
  const selections: AggregateSelection[] = [];

  for (const kind of kinds) {
    for (const name of options[kind] ?? []) {
      const col = table.columns[name];
      if (!col) throw new Error(`[FumaDB] unknown column \`${table.ormName}.${name}\`.`);
      if (!accepts[kind](col.type))
        throw new Error(
          `[FumaDB] \`${kind}\` doesn't accept the ${col.type} column \`${table.ormName}.${name}\`.`,
        );

      selections.push({ kind, col, alias: `a${selections.length}` });
    }
  }

  const { orderBy = [], limit, offset } = options;
  const orders = (typeof orderBy[0] === "string" ? [orderBy] : orderBy) as [
    string,
    "asc" | "desc",
  ][];

  if (!options.groupBy && (orders.length > 0 || limit !== undefined || offset !== undefined))
    throw new Error("[FumaDB] `orderBy`, `limit` and `offset` of `aggregate()` require `groupBy`.");

  return {
    groupBy: selections.filter((s) => s.kind === "groupBy").map((s) => s.col),
    selections,
    orderBy: orders.map(([path, mode]) => {
      if (path === "count") return { alias: countAlias, mode };

      const [kind, name] = path.split(".", 2);
      const prefix = kind === "group" ? "groupBy" : kind;
      const selection = selections.find((s) => s.kind === prefix && s.col.ormName === name);
      if (!selection)
        throw new Error(
          `[FumaDB] cannot order by \`${path}\`, it must be a selected aggregate or group column.`,
        );

      return { alias: selection.alias, selection, mode };
    }),
    limit,
    offset,
  };
}

/**
 * Decode the group columns, `min` and `max` of a row in place, like the column values of `findMany`.
 */
export function decodeAggregateRow(
  row: AggregateRow,
  options: SimplifiedAggregateOptions,
  decode: (value: unknown, col: AnyColumn) => unknown,
): AggregateRow {
  for (const { kind, col, alias } of options.selections) {
    const value = row[alias];
    if (value == null || kind === "sum" || kind === "avg") continue;

    row[alias] = decode(value, col);
  }

  return row;
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
 * Convert the rows of an adapter to the result of `aggregate()`.
 */
export function toAggregateResult(
  options: AnyAggregateOptions,
  { selections }: Omit<SimplifiedAggregateOptions, "where">,
  rows: AggregateRow[],
): unknown {
  function convert(row: AggregateRow | undefined) {
    const out: Record<string, Record<string, unknown> | number> = {};
    if (options.count) out.count = row ? toNumber(row[countAlias]) : 0;
    for (const kind of kinds) {
      if (options[kind]) out[kind === "groupBy" ? "group" : kind] = {};
    }

    for (const { kind, col, alias } of selections) {
      let value = row?.[alias] ?? null;

      // group columns are decoded by adapters
      if (value !== null && kind === "avg") value = toNumber(value);
      else if (value !== null && kind !== "groupBy" && isNumericType(col.type))
        value = toColumnNumber(value, col);

      (out[kind === "groupBy" ? "group" : kind] as Record<string, unknown>)[col.ormName] = value;
    }

    return out;
  }

  if (!options.groupBy) return convert(rows[0]);

  // without columns to group by, SQL databases return a row even when nothing matches
  return rows.filter((row) => toNumber(row[countAlias]) > 0).map(convert);
}
