/**
 * Escape a value to match it literally in a `LIKE` pattern, the pattern must be used with `ESCAPE '!'`.
 *
 * The same rule works on every SQL database: `[` only has a special meaning on MSSQL.
 */
export function escapeLike(value: unknown): string {
  return String(value).replace(/[!%_[]/g, "!$&");
}
