import type { AnyTable } from "../schema/create";

/**
 * An update relative to the current value of a column, created by `increment()`.
 */
export class Increment<T extends number | bigint = number | bigint> {
  readonly step: T;

  constructor(step: T) {
    this.step = step;
  }
}

/**
 * Update a column relative to its current value, in the same statement, so concurrent updates are never lost.
 *
 * Works on `integer`, `bigint` and `decimal` columns. Use a negative step to decrement. A null stays null.
 *
 * @example
 * ```ts
 * await orm.updateMany("links", {
 *   where: (b) => b("id", "=", id),
 *   set: { viewCount: increment(1) },
 * });
 * ```
 */
export function increment<T extends number | bigint>(step: T): Increment<T> {
  return new Increment(step);
}

export const incrementTypes = ["integer", "bigint", "decimal"];

/**
 * An insert has no current value to increment.
 */
export function assertNoIncrements(values: Record<string, unknown>) {
  for (const k in values) {
    if (values[k] instanceof Increment)
      throw new Error(`[FumaDB] \`increment()\` only works in updates, but \`${k}\` is inserted.`);
  }
}

/**
 * Validate the increments in update values, and convert their step to the type of the column.
 */
export function normalizeIncrements(
  table: AnyTable,
  values: Record<string, unknown>,
): Record<string, unknown> {
  let out: Record<string, unknown> | undefined;

  for (const k in values) {
    const value = values[k];
    const col = table.columns[k];
    if (!(value instanceof Increment) || !col) continue;

    if (!incrementTypes.includes(col.type)) {
      throw new Error(
        `[FumaDB] \`increment()\` only works on integer, bigint and decimal columns, but \`${table.ormName}.${k}\` is ${col.type}.`,
      );
    }

    let step: number | bigint = value.step;
    if (col.type !== "decimal" && typeof step === "number" && !Number.isInteger(step)) {
      throw new Error(
        `[FumaDB] \`${table.ormName}.${k}\` is an ${col.type} column, its increment must be an integer, received ${step}.`,
      );
    }

    step = col.type === "bigint" ? BigInt(step) : Number(step);
    out ??= { ...values };
    out[k] = new Increment(step);
  }

  return out ?? values;
}
