import { FumaDBAdapter } from ".";
import { AbstractQuery } from "../query";
import { fromKysely } from "../query/orm/kysely";
import { KyselyConfig } from "../shared/config";

export function kyselyAdapter(config: KyselyConfig): FumaDBAdapter {
  return {
    createORM(schema) {
      return fromKysely(schema, config) as AbstractQuery<any>;
    },
    kysely: config,
  };
}
