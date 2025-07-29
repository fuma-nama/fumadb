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

  createORM: <S extends AnySchema>(schema: S) => AbstractQuery<S>;

  createMigrationEngine?: (lib: LibraryConfig) => Migrator;
  kysely?: KyselyConfig;
}
