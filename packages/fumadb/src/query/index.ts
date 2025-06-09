import type { Column, Schema, Table } from "../schema/create";

interface SelectClause {
  select: true | Record<string, boolean>;
  where?: Condition[];
}

type AbstractTable<T extends Table = Table> = {
  _: {
    name: string;
  };
} & T["columns"];

export type Operator = ">" | "<" | ">=" | "<=" | "=" | "!=";

export type Condition =
  | [a: Column, operator: Operator, b: unknown]
  | boolean
  | "and"
  | "or"
  | Condition[];

export interface AbstractQuery<T extends Schema> {
  findOne: <T extends Table>(
    from: AbstractTable<T>,
    v: SelectClause
  ) => Promise<unknown>;

  get tables(): {
    [K in keyof T["tables"]]: AbstractTable<T["tables"][K]>;
  };
}

/**
 * Abstract layer to interact with database, focused on max compatibility.
 */
export function abstractQuery<T extends Schema>(schema: T): AbstractQuery<T> {
  return {} as unknown as AbstractQuery<T>;
}
