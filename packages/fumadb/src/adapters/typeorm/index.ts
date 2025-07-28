import type { DataSource } from "typeorm";
import type { SQLProvider } from "../../shared/providers";
import { FumaDBAdapter } from "..";
import { fromTypeORM } from "./query";
import { AbstractQuery } from "../../query";
import { generateSchema } from "./generate";

export interface TypeORMConfig {
  source: DataSource;
  provider: Exclude<SQLProvider, "cockroachdb">;
}

export function typeormAdapter(options: TypeORMConfig): FumaDBAdapter {
  return {
    createORM(schema) {
      return fromTypeORM(
        schema,
        options.source,
        options.provider
      ) as AbstractQuery<any>;
    },
    generateSchema(schema, name) {
      return {
        code: generateSchema(schema, options.provider),
        path: `./models/${name}.ts`,
      };
    },
  };
}
