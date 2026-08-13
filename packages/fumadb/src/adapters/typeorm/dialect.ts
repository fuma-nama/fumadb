/**
 * Kysely dialect backed by a TypeORM `DataSource`.
 *
 * Vendored from kysely-typeorm v0.3.0 (MIT, Copyright (c) 2024 Kysely)
 * https://github.com/kysely-org/kysely-typeorm
 *
 * We vendor it because kysely-typeorm declares `typeorm: ">= 0.3.0 < 0.4.0"` as a peer,
 * which is unsatisfiable alongside fumadb's own `typeorm: ^1` peer — npm refuses to install
 * fumadb at all without `--legacy-peer-deps`. The code below is a verbatim port, only
 * retyped against TypeORM 1.x.
 */
import type {
  CompiledQuery,
  DatabaseConnection,
  DatabaseIntrospector,
  Dialect,
  DialectAdapter,
  Driver,
  Kysely,
  QueryCompiler,
  QueryResult,
  TransactionSettings,
} from "kysely";
import type { DataSource, QueryRunner } from "typeorm";

export type KyselySubDialect = Omit<Dialect, "createDriver">;

export interface KyselyTypeORMDialectConfig {
  kyselySubDialect: KyselySubDialect;
  typeORMDataSource: DataSource;
}

const ISOLATION_LEVELS = {
  "read committed": "READ COMMITTED",
  "read uncommitted": "READ UNCOMMITTED",
  "repeatable read": "REPEATABLE READ",
  serializable: "SERIALIZABLE",
  snapshot: null,
} as const;

const SUPPORTED_DIALECTS = ["better-sqlite3", "mssql", "mysql", "postgres", "sqlite"];

function isObject(thing: unknown): thing is Record<string, unknown> {
  return typeof thing === "object" && thing !== null && !Array.isArray(thing);
}

function assertSupportedDialect(dialect: string): void {
  if (!SUPPORTED_DIALECTS.includes(dialect)) {
    throw new Error(`Unsupported dialect: ${dialect}!`);
  }
}

class KyselyTypeORMConnection implements DatabaseConnection {
  readonly #queryRunner: QueryRunner;

  constructor(queryRunner: QueryRunner) {
    this.#queryRunner = queryRunner;
  }

  async beginTransaction(settings: TransactionSettings): Promise<void> {
    const { isolationLevel: kyselyIsolationLevel } = settings;
    const isolationLevel = kyselyIsolationLevel && ISOLATION_LEVELS[kyselyIsolationLevel];

    if (isolationLevel === null) {
      throw new Error(`Isolation level '${kyselyIsolationLevel}' is not supported!`);
    }

    await this.#queryRunner.startTransaction(isolationLevel ?? undefined);
  }

  async commitTransaction(): Promise<void> {
    await this.#queryRunner.commitTransaction();
  }

  async release(): Promise<void> {
    await this.#queryRunner.release();
  }

  async rollbackTransaction(): Promise<void> {
    await this.#queryRunner.rollbackTransaction();
  }

  async executeQuery<R>(compiledQuery: CompiledQuery<unknown>): Promise<QueryResult<R>> {
    const result = await this.#queryRunner.query(
      compiledQuery.sql,
      [...compiledQuery.parameters],
      true,
    );

    const { affected, raw, records } = result;

    return {
      insertId: Number.isInteger(raw)
        ? BigInt(raw)
        : isObject(raw) && "insertId" in raw && Number.isInteger(raw.insertId)
          ? BigInt(raw.insertId as number)
          : undefined,
      numAffectedRows: Number.isInteger(affected) ? BigInt(affected as number) : undefined,
      numChangedRows:
        isObject(raw) && "changedRows" in raw && Number.isInteger(raw.changedRows)
          ? BigInt(raw.changedRows as number)
          : undefined,
      rows: records || [],
    };
  }

  async *streamQuery<R>(
    compiledQuery: CompiledQuery<unknown>,
  ): AsyncIterableIterator<QueryResult<R>> {
    for await (const row of await this.#queryRunner.stream(compiledQuery.sql, [
      ...compiledQuery.parameters,
    ])) {
      yield { rows: [row] };
    }
  }
}

export class KyselyTypeORMDriver implements Driver {
  readonly #config: KyselyTypeORMDialectConfig;

  constructor(config: KyselyTypeORMDialectConfig) {
    this.#config = config;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const queryRunner = this.#config.typeORMDataSource.createQueryRunner();
    await queryRunner.connect();

    return new KyselyTypeORMConnection(queryRunner);
  }

  async beginTransaction(
    connection: KyselyTypeORMConnection,
    settings: TransactionSettings,
  ): Promise<void> {
    await connection.beginTransaction(settings);
  }

  async commitTransaction(connection: KyselyTypeORMConnection): Promise<void> {
    await connection.commitTransaction();
  }

  async destroy(): Promise<void> {
    if (this.#config.typeORMDataSource.isInitialized) {
      await this.#config.typeORMDataSource.destroy();
    }
  }

  async init(): Promise<void> {
    if (!this.#config.typeORMDataSource.isInitialized) {
      await this.#config.typeORMDataSource.initialize();
    }
  }

  async releaseConnection(connection: KyselyTypeORMConnection): Promise<void> {
    await connection.release();
  }

  async rollbackTransaction(connection: KyselyTypeORMConnection): Promise<void> {
    await connection.rollbackTransaction();
  }
}

export class KyselyTypeORMDialect implements Dialect {
  readonly #config: KyselyTypeORMDialectConfig;

  constructor(config: KyselyTypeORMDialectConfig) {
    assertSupportedDialect(config.typeORMDataSource.options.type);
    this.#config = config;
  }

  createAdapter(): DialectAdapter {
    return this.#config.kyselySubDialect.createAdapter();
  }

  createDriver(): Driver {
    return new KyselyTypeORMDriver(this.#config);
  }

  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return this.#config.kyselySubDialect.createIntrospector(db);
  }

  createQueryCompiler(): QueryCompiler {
    const queryCompiler = this.#config.kyselySubDialect.createQueryCompiler();

    if (this.#config.typeORMDataSource.options.type === "mssql") {
      (queryCompiler as any).getCurrentParameterPlaceholder = function (this: {
        numParameters: number;
      }) {
        return `@${this.numParameters - 1}`;
      };
    }

    return queryCompiler;
  }
}
