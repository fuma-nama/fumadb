import { toORM } from "./base";
import { AnySchema } from "../../schema";
import * as GeneratedAPI from "../../../convex/_generated/api";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { serializeSelect, serializeWhere } from "../../convex/serialize";
import { createTransaction } from "../polyfills/transaction";

interface ConvexOptions {
  secret: string;
  client: ConvexClient | ConvexHttpClient;
  generatedAPI: Record<string, unknown>;
}

// TODO: join, sort
export function fromConvex(schema: AnySchema, options: ConvexOptions) {
  const { secret, client, generatedAPI } = options;
  const api = generatedAPI as (typeof GeneratedAPI.fullApi)["test"];

  const orm = createTransaction({
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

      if (Array.isArray(result)) return result[0] ?? null;
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

      if (Array.isArray(result)) return result;
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
      return results.map((result) => ({
        _id: result[idColumn.ormName],
      }));
    },
    async deleteMany(table, v) {
      await client.mutation(api.mutationHandler, {
        tableName: table.names.sql,
        action: {
          type: "delete",
          where: v.where ? serializeWhere(v.where) : undefined,
        },
        secret,
      });
    },
    async upsert(table, v) {
      await client.mutation(api.mutationHandler, {
        tableName: table.names.sql,
        action: {
          type: "upsert",
          create: v.create,
          update: v.update,
          where: v.where ? serializeWhere(v.where) : undefined,
        },
        secret,
      });
    },
  });

  return toORM(orm);
}
