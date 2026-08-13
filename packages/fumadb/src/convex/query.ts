import type { ConvexClient, ConvexHttpClient } from "convex/browser";
import type { ApiFromModules } from "convex/server";
import type { createHandler } from "./index";
import { type ORMAdapter, toORM } from "../query/orm";
import { createTransaction } from "../query/polyfills/transaction";
import type { AnySchema } from "../schema";
import { serializeSelect, serializeWhere } from "./serialize";

interface ConvexOptions {
  secret: string;
  client: ConvexClient | ConvexHttpClient;
  generatedAPI: Record<string, unknown>;
}

// TODO: join, sort
export function fromConvex(schema: AnySchema, options: ConvexOptions) {
  const { secret, client, generatedAPI } = options;
  const api = generatedAPI as ApiFromModules<{
    handler: ReturnType<typeof createHandler>;
  }>["handler"];

  const adapter: Omit<ORMAdapter, "transaction"> = {
    tables: schema.tables,
    async count(table, v) {
      return (await client.query(api.queryHandler, {
        tableName: table.ormName,
        query: {
          type: "count",
          where: v.where ? serializeWhere(v.where) : undefined,
        },
        secret,
      })) as number;
    },
    async findFirst(table, v) {
      const result = await client.query(api.queryHandler, {
        tableName: table.ormName,
        query: {
          type: "find",
          select: serializeSelect(table, v.select),
          where: v.where ? serializeWhere(v.where) : undefined,
          limit: 1,
        },
        secret,
      });

      if (Array.isArray(result) && result.length > 0) return result[0] as Record<string, unknown>;
      return null;
    },
    async findMany(table, v) {
      const result = await client.query(api.queryHandler, {
        tableName: table.ormName,
        query: {
          type: "find",
          select: serializeSelect(table, v.select),
          where: v.where ? serializeWhere(v.where) : undefined,
          limit: v.limit,
          offset: v.offset,
        },
        secret,
      });

      if (Array.isArray(result)) return result as Record<string, unknown>[];
      return [];
    },
    async updateMany(table, v) {
      await client.mutation(api.mutationHandler, {
        tableName: table.ormName,
        action: {
          type: "update",
          set: v.set,
          where: v.where ? serializeWhere(v.where) : undefined,
        },
        secret,
      });
    },
    async create(table, values) {
      const result = await client.mutation(api.mutationHandler, {
        tableName: table.ormName,
        action: {
          type: "create",
          data: [values],
          returning: true,
        },
        secret,
      });

      return result?.[0];
    },
    async createMany(table, values) {
      const results = await client.mutation(api.mutationHandler, {
        tableName: table.ormName,
        action: {
          type: "create",
          data: values,
          returning: true,
        },
        secret,
      });

      if (!results) throw new Error("Failed to create records.");
      const idColumn = table.getIdColumn();
      return results.map((result: Record<string, unknown>) => ({
        _id: result[idColumn.ormName],
      }));
    },
    async deleteMany(table, v) {
      await client.mutation(api.mutationHandler, {
        tableName: table.ormName,
        action: {
          type: "delete",
          where: v.where ? serializeWhere(v.where) : undefined,
        },
        secret,
      });
    },
    async upsert(table, v) {
      const result = await client.mutation(api.mutationHandler, {
        tableName: table.ormName,
        action: {
          type: "upsert",
          create: v.create,
          update: v.update,
          where: v.where ? serializeWhere(v.where) : undefined,
          returning: v.returning ?? false,
        },
        secret,
      });

      if (!v.returning) return;
      return (result as Record<string, unknown> | null) ?? undefined;
    },
  };

  return toORM({
    ...adapter,
    async transaction(run) {
      // Convex already runs each mutation in its own transaction, so the soft
      // transaction is only needed to tie multiple operations together.
      // It is deliberately not applied to `adapter` itself: it overrides `upsert`
      // with a rollback-aware (but non-atomic) polyfill, and outside of a
      // transaction we want the handler's atomic upsert instead.
      const ctx = createTransaction(adapter);

      try {
        return await run(toORM(ctx));
      } catch (e) {
        await ctx.rollback();
        throw e;
      }
    },
  });
}
