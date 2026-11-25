const RegexVarchar = /^varchar\((\d+)\)$/;
const RegexDecimal = /^decimal\((\d+), ?(\d+)\)$/;

/**
 * The precision and scale of `decimal` columns. 38 is the maximum precision of MS SQL Server, and a JS number holds fewer digits.
 */
export const defaultDecimal = { precision: 38, scale: 16 } as const;

/**
 * Get the precision and scale of a `decimal` or `decimal(p, s)` type, `undefined` for other types.
 */
export function parseDecimal(type: string): { precision: number; scale: number } | undefined {
  if (type === "decimal") return defaultDecimal;

  const match = RegexDecimal.exec(type);
  if (!match) return;
  return { precision: Number(match[1]), scale: Number(match[2]) };
}

/**
 * `integer`, `bigint`, `decimal` and `decimal(p, s)`
 */
export function isNumericType(type: string): boolean {
  return type === "integer" || type === "bigint" || isDecimalType(type);
}

/**
 * `decimal` and `decimal(p, s)`, cheaper than `parseDecimal()` for checking values
 */
export function isDecimalType(type: string): boolean {
  return type === "decimal" || type.startsWith("decimal(");
}

export function parseVarchar(template: string): number {
  const match = RegexVarchar.exec(template);
  if (!match) throw new Error("Failed to match varchar(n)");
  return Number(match[1]);
}

export function ident(s: string, identation = 2): string {
  const tab = " ".repeat(identation);

  return s
    .split("\n")
    .map((v) => tab + v)
    .join("\n");
}
