import type { AnyTable } from "../schema/create";

/**
 * Thrown by `create`, `createMany`, `updateMany` and `upsert` when a row violates a unique constraint or the primary key.
 *
 * The error from the database driver is available as `cause`.
 */
export class UniqueConstraintError extends Error {
  override name = "UniqueConstraintError";

  constructor(
    /**
     * Name of the violated unique constraint in FumaDB schema.
     *
     * `undefined` when it violates the primary key, or the database doesn't report the constraint.
     */
    readonly constraint: string | undefined,
    options: { cause: unknown },
  ) {
    super(
      constraint
        ? `[FumaDB] Unique constraint "${constraint}" violated.`
        : "[FumaDB] Unique constraint violated.",
      options,
    );
  }
}

interface Violation {
  /** constraint (or index) name reported by the database */
  name?: string;
  /** column names reported by the database */
  columns?: string[];
}

function parseViolation(error: unknown): Violation | undefined {
  // ORMs like Drizzle wrap the error from database drivers in `cause`
  for (let e = error, depth = 0; typeof e === "object" && e !== null && depth < 5; depth++) {
    const err = e as Record<string, any>;
    const message = typeof err.message === "string" ? err.message : "";

    // PostgreSQL & CockroachDB
    if (err.code === "23505") return { name: err.constraint ?? err.constraint_name };
    // MySQL: Duplicate entry 'value' for key 'table.constraint', some drivers append the SQL in new lines
    if (err.code === "ER_DUP_ENTRY" || err.errno === 1062)
      return { name: /for key '([^']+)'$/m.exec(message)?.[1]?.split(".").at(-1) };
    // MSSQL
    if (err.number === 2627 || err.number === 2601)
      return { name: /(?:constraint|index) '([^']+)'/.exec(message)?.[1] };
    // MongoDB
    if (err.code === 11000) return { name: /index: (\S+) dup key/.exec(message)?.[1] };
    // Prisma
    if (err.code === "P2002") {
      const target = err.meta?.target ?? err.meta?.driverAdapterError?.cause?.constraint;
      if (typeof target === "string") return { name: target };
      if (Array.isArray(target)) return { columns: target };
      return { name: target?.index, columns: target?.fields };
    }
    // SQLite: drivers use different error codes, but the same message
    const sqlite = /UNIQUE constraint failed: ([^\n]+)/.exec(message);
    if (sqlite)
      return { columns: sqlite[1].split(", ").map((col) => col.slice(col.lastIndexOf(".") + 1)) };

    e = err.cause;
  }
}

export function toUniqueConstraintError(
  table: AnyTable,
  error: unknown,
): UniqueConstraintError | undefined {
  const violation = parseViolation(error);
  if (!violation) return;

  const constraint = table.getUniqueConstraints().find((con) => {
    if (violation.name) return con.name === violation.name;
    if (!violation.columns || violation.columns.length !== con.columns.length) return false;

    return con.columns.every((col) =>
      violation.columns!.some((name) => Object.values(col.names).includes(name)),
    );
  });

  return new UniqueConstraintError(constraint?.name, { cause: error });
}
