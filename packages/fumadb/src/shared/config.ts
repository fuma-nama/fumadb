import type { Kysely } from "kysely";
import type { AnySchema } from "../schema";
import type { Provider, SQLProvider } from "./providers";
import type { MongoClient } from "mongodb";
import type { DataSource } from "typeorm";
import type { PrismaClient } from "./prisma";

export interface LibraryConfig<Schemas extends AnySchema[] = AnySchema[]> {
  namespace: string;

  /**
   * different versions of schemas (must be sorted in ascending order)
   */
  schemas: Schemas;

  /**
   * The initial version, it refers to the version of database **before** being initialized.
   *
   * You should not use this version number in your schemas.
   *
   * @defaultValue '0.0.0'
   */
  initialVersion?: string;
}

export interface KyselyConfig {
  type: "kysely";
  db: Kysely<any>;
  provider: SQLProvider;

  /**
   * Define how foreign keys are handled.
   *
   * - `foreign-keys`: rely on database's actual foreign keys.
   * - `fumadb`: rely on FumaDB's simple foreign key engine.
   *
   * When not specified, use `foreign-keys` except for MSSQL.
   */
  relationMode?: "foreign-keys" | "fumadb";
}

export interface PrismaConfig {
  type: "prisma";
  provider: Provider;
  prisma: PrismaClient;

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

export type DatabaseConfig =
  | {
      type: "drizzle-orm";
      /**
       * Drizzle instance, must have query mode configured: https://orm.drizzle.team/docs/rqb.
       */
      db: unknown;
      provider: Exclude<
        Provider,
        "cockroachdb" | "mongodb" | "mssql" | "convex"
      >;
    }
  | (Omit<PrismaConfig, "prisma"> & {
      prisma: unknown;
    })
  | KyselyConfig
  | {
      type: "typeorm";
      source: DataSource;
      provider: Exclude<SQLProvider, "cockroachdb">;
    }
  | {
      type: "mongodb";
      client: MongoClient;
    };
