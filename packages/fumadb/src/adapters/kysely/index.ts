import type { FumaDBAdapter } from "../";
import { fromKysely } from "./query";
import type { KyselyConfig } from "../../shared/config";
import { createSQLMigrator } from "../../migration-engine/sql";

export function kyselyAdapter(config: KyselyConfig): FumaDBAdapter {
  return {
    createORM(schema) {
      return fromKysely(schema, config);
    },
    createMigrationEngine(lib) {
      return createSQLMigrator(lib, config);
    },
    kysely: config,
  };
}
