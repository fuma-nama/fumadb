import { FumaDBAdapter } from "../";
import { AbstractQuery } from "../../query";
import { fromKysely } from "./query";
import { KyselyConfig } from "../../shared/config";
import { createSQLMigrator } from "../../migration-engine/sql";

export function kyselyAdapter(config: KyselyConfig): FumaDBAdapter {
  return {
    createORM(schema) {
      return fromKysely(schema, config) as AbstractQuery<any>;
    },
    createMigrationEngine(lib) {
      return createSQLMigrator(lib, config);
    },
    kysely: config,
  };
}
