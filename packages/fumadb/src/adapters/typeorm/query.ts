import {
  Kysely,
  MssqlAdapter,
  MssqlIntrospector,
  MssqlQueryCompiler,
  MysqlAdapter,
  MysqlIntrospector,
  MysqlQueryCompiler,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";
import { AnySchema } from "../../schema";
import { DataSource } from "typeorm";
import { KyselySubDialect, KyselyTypeORMDialect } from "kysely-typeorm";
import { SQLProvider } from "../../shared/providers";
import { fromKysely } from "../kysely/query";

/**
 * Create TypeORM query interface based on Kysely, because TypeORM returns class instances, it's more performant to use Kysely directly.
 *
 * This doesn't support MongoDB.
 */
export function fromTypeORM(
  schema: AnySchema,
  source: DataSource,
  provider: SQLProvider
) {
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

  const kysely = new Kysely({
    dialect: new KyselyTypeORMDialect({
      kyselySubDialect: subDialect,
      typeORMDataSource: source,
    }),
  });

  return fromKysely(schema, {
    db: kysely,
    provider,
  });
}
