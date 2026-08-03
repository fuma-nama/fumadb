import * as drizzleOrm from "drizzle-orm";

export type ColumnType = any;
export type TableType = Record<string, ColumnType>;
export type DrizzleMajor = 0 | 1;

export type DBType = {
  _: {
    fullSchema?: Record<string, TableType>;
    relations?: Record<string, { table: TableType }>;
  };
  query: Record<
    string,
    {
      findMany: (config: unknown) => Promise<Record<string, unknown>[]>;
    }
  >;
  select: (...args: any[]) => any;
  insert: (...args: any[]) => any;
  update: (...args: any[]) => any;
  delete: (...args: any[]) => any;
  $count: (table: TableType, where?: unknown) => Promise<number>;
  transaction: <T>(fn: (tx: unknown) => Promise<T> | T) => Promise<T>;
};

/** 0.x via `db._.fullSchema`, 1.x via `db._.relations[name].table`. */
export function parseDrizzle(drizzle: unknown) {
  const db = drizzle as DBType;
  const fullSchema = db._?.fullSchema;
  if (fullSchema && Object.keys(fullSchema).length > 0) {
    return [db, fullSchema, 0 as DrizzleMajor] as const;
  }

  const relations = db._?.relations;
  if (relations && Object.keys(relations).length > 0) {
    const tables: Record<string, TableType> = {};
    for (const [name, entry] of Object.entries(relations)) {
      if (!entry?.table) {
        throw new Error(
          `[fumadb] Drizzle relations entry "${name}" is missing .table. Ensure defineRelations() is configured correctly.`,
        );
      }
      tables[name] = entry.table;
    }
    return [db, tables, 1 as DrizzleMajor] as const;
  }

  throw new Error(
    "[fumadb] Drizzle adapter requires query mode. On drizzle-orm 0.x pass `schema` to drizzle(); on 1.x pass `relations` from defineRelations(): https://orm.drizzle.team/docs/rqb",
  );
}

/** Schema-gen API: 1 = `relations()`, 2 = `defineRelations()`. */
export type RelationsVersion = 1 | 2;

export function resolveRelationsVersion(db: unknown): RelationsVersion {
  try {
    const [, , major] = parseDrizzle(db);
    return major === 0 ? 1 : 2;
  } catch {
    // db may not be query-configured yet while generating schema
  }

  return typeof (drizzleOrm as { defineRelations?: unknown }).defineRelations === "function"
    ? 2
    : 1;
}
