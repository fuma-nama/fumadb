import type { DataSource } from "typeorm";
import type { SQLProvider } from "../../shared/providers";
import { FumaDBAdapter } from "..";
import { generateSchema } from "./generate";
import {
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  MysqlAdapter,
  MysqlIntrospector,
  MysqlQueryCompiler,
  MssqlAdapter,
  MssqlIntrospector,
  MssqlQueryCompiler,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  Kysely,
} from "kysely";
import { KyselySubDialect, KyselyTypeORMDialect } from "kysely-typeorm";
import { fromKysely } from "../kysely/query";

export interface TypeORMConfig {
  source: DataSource;
  provider: Exclude<SQLProvider, "cockroachdb">;
}

export function typeormAdapter(options: TypeORMConfig): FumaDBAdapter {
  const kysely = getKysely(options.source, options.provider);
  const kyselyConfig = {
    db: kysely,
    provider: options.provider,
  };

  return {
    createORM(schema) {
      return fromKysely(schema, kyselyConfig);
    },
    generateSchema(schema, name) {
      return {
        code: generateSchema(schema, options.provider),
        path: `./models/${name}.ts`,
      };
    },
    kysely: kyselyConfig,
  };
}

/**
 * Create TypeORM query interface based on Kysely, because TypeORM returns class instances, it's more performant to use Kysely directly.
 *
 * This doesn't support MongoDB.
 */
function getKysely(source: DataSource, provider: SQLProvider) {
  let subDialect: KyselySubDialect;

  if (provider === "postgresql") {
    subDialect = {
      createAdapter: () => new PostgresAdapter(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    };
  } else if (provider === "mysql") {
    subDialect = {
      createAdapter: () => new MysqlAdapter(),
      createIntrospector: (db) => new MysqlIntrospector(db),
      createQueryCompiler: () => new MysqlQueryCompiler(),
    };
  } else if (provider === "mssql") {
    subDialect = {
      createAdapter: () => new MssqlAdapter(),
      createIntrospector: (db) => new MssqlIntrospector(db),
      createQueryCompiler: () => new MssqlQueryCompiler(),
    };
  } else {
    subDialect = {
      createAdapter: () => new SqliteAdapter(),
      createIntrospector: (db) => new SqliteIntrospector(db),
      createQueryCompiler: () => new SqliteQueryCompiler(),
    };
  }

  return new Kysely({
    dialect: new KyselyTypeORMDialect({
      kyselySubDialect: subDialect,
      typeORMDataSource: source,
    }),
  });
}
