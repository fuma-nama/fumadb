import type { MongoClient } from "mongodb";

export interface PrismaConfig {
  /**
   * The relation mode you're using, see https://prisma.io/docs/orm/prisma-schema/data-model/relations/relation-mode.
   *
   * Default to foreign keys on SQL databases, and `prisma` on MongoDB.
   */
  relationMode?: "prisma" | "foreign-keys";

  /**
   * Underlying database instance, highly recommended to provide so FumaDB can optimize some operations & indexes.
   *
   * supported: MongoDB
   */
  db?: MongoClient;
}

export type PrismaClient = Record<
  string,
  {
    count: (options: {
      select: Record<string, unknown>;
      where?: object;
    }) => Promise<Record<string, number>>;
    upsert: (options: {
      where: object;
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }) => Promise<void>;

    create: (options: {
      data: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;

    createMany: (options: { data: Record<string, unknown>[] }) => Promise<void>;

    delete: (options: { where: object }) => Promise<Record<string, unknown>>;

    deleteMany: (options: { where?: object }) => Promise<void>;

    findFirst: (options: {
      where: object;
      select?: Record<string, unknown>;
      orderBy?: OrderBy | OrderBy[];
      skip?: number;
    }) => Promise<Record<string, unknown> | null>;

    findMany: (options: {
      where?: object;
      select?: Record<string, unknown>;
      orderBy?: OrderBy | OrderBy[];
      skip?: number;
      take?: number;
    }) => Promise<Record<string, unknown>[]>;

    updateMany: (options: {
      where?: object;
      data: Record<string, unknown>;
    }) => Promise<void>;
  }
> & {
  $transaction: <T>(v: (tx: PrismaClient) => T | Promise<T>) => Promise<T>;
};

export type OrderBy = {
  [k: string]: "asc" | "desc" | OrderBy;
};
