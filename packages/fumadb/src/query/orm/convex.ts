import { createTables, ORMAdapter, toORM } from "./base";
import { AnySchema } from "../../schema";
import * as GeneratedAPI from "../../../convex/_generated/api";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { serializeSelect, serializeWhere } from "../../convex/serialize";

interface ConvexOptions {
  secret: string;
  client: ConvexClient | ConvexHttpClient;
  generatedAPI: Record<string, unknown>;
}

// TODO: join, sort
export function fromConvex(schema: AnySchema, options: ConvexOptions) {
  const { secret, client, generatedAPI } = options;
  const api = generatedAPI as (typeof GeneratedAPI.fullApi)["test"];
  const abstractTables = createTables(schema);

  return toORM({
    tables: abstractTables,
    async count(table, v) {
      return (await client.query(api.queryHandler, {
        tableName: table._.raw.ormName,
        query: {
          type: "count",
          where: v.where ? serializeWhere(v.where) : undefined,
        },
        secret,
      })) as number;
    },
    async findFirst(table, v) {
      const result = await client.query(api.queryHandler, {
        tableName: table._.raw.ormName,
        query: {
          type: "find",
          select: serializeSelect(table._.raw, v.select),
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
        tableName: table._.raw.ormName,
        query: {
          type: "find",
          select: serializeSelect(table._.raw, v.select),
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
        tableName: table._.raw.ormName,
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
        tableName: table._.raw.ormName,
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
        tableName: table._.raw.ormName,
        action: {
          type: "create",
          data: values,
          returning: true,
        },
        secret,
      });

      if (!results) throw new Error("Failed to create records.");
      const idColumn = table._.raw.getIdColumn();
      return results.map((result) => ({
        _id: result[idColumn.ormName],
      }));
    },
    async deleteMany(table, v) {
      await client.mutation(api.mutationHandler, {
        tableName: table._.raw.names.sql,
        action: {
          type: "delete",
          where: v.where ? serializeWhere(v.where) : undefined,
        },
        secret,
      });
    },
    async upsert(table, v) {
      await client.mutation(api.mutationHandler, {
        tableName: table._.raw.names.sql,
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
}
