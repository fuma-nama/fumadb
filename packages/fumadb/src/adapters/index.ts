import type { Migrator } from "../migration-engine/create";
import type { AbstractQuery } from "../query";
import type { AnySchema } from "../schema";
import type { KyselyConfig, LibraryConfig } from "../shared/config";

export interface FumaDBAdapter {
  /**
   * Generate ORM schema based on FumaDB Schema
   */
  generateSchema?: (
    schema: AnySchema,
    schemaName: string
  ) => {
    code: string;
    path: string;
  };

  createORM: (schema: AnySchema) => AbstractQuery<AnySchema>;

  createMigrationEngine?: (lib: LibraryConfig) => Migrator;
  /**
   * Provide a Kysely client, so that libraries can optimize some queries that a Prisma-like interface cannot perform.
   */
  kysely?: KyselyConfig;
}

export type FumaDBAdapterOptionsV1 = FumaDBAdapter;

export function createAdapter(
  _version: "v1",
  options: FumaDBAdapterOptionsV1
): FumaDBAdapter {
  return options;
}
