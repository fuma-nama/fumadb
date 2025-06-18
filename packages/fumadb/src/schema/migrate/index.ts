import type { Schema } from "../create";
import { execute, schemaToDBType } from "./execute";
import { autoUp } from "./auto-up";
import { MigrationOperation } from "./shared";
import { revertOperation } from "./auto-down";
import { Provider } from "../providers";
import { Kysely } from "kysely";
import { Config } from "../../shared/config";

type Awaitable<T> = T | Promise<T>;

type SupportedProvider = Exclude<Provider, "mongodb" | "cockroachdb">;
export interface MigrationContext {
  auto: () => Promise<MigrationOperation[]>;
}

export type MigrateFucntion = (
  context: MigrationContext
) => Awaitable<MigrationOperation[]>;

export interface MigrationConfig {
  type: "kysely";
  provider: SupportedProvider;
  db: Kysely<unknown>;
  version: string;
}

export async function getVersionFromDatabase(
  config: Config,
  db: Kysely<any>
): Promise<string> {
  const name = `private_${config.namespace}_version`;
  const id = "default";

  await db.schema
    .createTable(name)
    .ifNotExists()
    .addColumn(
      "version",
      schemaToDBType("varchar(255)", config.provider),
      (col) => col.notNull()
    )
    .addColumn("id", schemaToDBType("varchar(255)", config.provider), (col) =>
      col.primaryKey()
    )
    .execute();

  const result = await db
    .selectFrom(name)
    .where("id", "=", id)
    .select(["version"])
    .limit(1)
    .execute();

  if (result.length === 0) {
    const version = "0.0.0";

    await db
      .insertInto(name)
      .values({
        id,
        version,
      })
      .execute();

    return version;
  }

  return result[0]!.version as string;
}

export function createMigrator(schemas: Schema[], config: MigrationConfig) {
  let version = config.version ?? schemas[0]!.version;

  function createGenerator(
    fn: () => Awaitable<MigrationOperation[]>,
    updateVersion: () => void
  ) {
    return async () => {
      const result = await fn();

      return {
        result,
        updateVersion,
        async runMigrations() {
          for (const op of result) {
            await execute(op, config).execute();
          }
        },
        getSQL() {
          const compiled = result.map((m) => execute(m, config).compile().sql);
          return compiled.join(";\n\n") + ";";
        },
      };
    };
  }

  function generateUp(schema: Schema) {
    const context: MigrationContext = {
      auto() {
        return autoUp(schema, config);
      },
    };

    const run = schema.up ?? (({ auto }) => auto());
    return run(context);
  }

  return {
    up: createGenerator(
      () => {
        const index =
          schemas.findIndex((schema) => schema.version === version) + 1;
        if (index === schemas.length) throw new Error("Already up to date.");

        return generateUp(schemas[index]!);
      },
      () => {
        const index = schemas.findIndex((schema) => schema.version === version);

        version = schemas[index + 1]!.version;
      }
    ),
    getVersionFromDatabase() {},
    get version() {
      return version;
    },
    set version(v: string) {
      version = v;
    },
    down: createGenerator(
      () => {
        const index = schemas.findIndex((schema) => schema.version === version);
        const schema = schemas[index]!;
        const previousSchema = schemas[index - 1] ?? {
          version: "0.0.0",
          tables: {},
        };
        const run = schema.down ?? (({ auto }) => auto());

        const context: MigrationContext = {
          async auto() {
            return (await generateUp(schema))
              .map((op) => revertOperation(previousSchema, schema, op))
              .reverse();
          },
        };

        return run(context);
      },
      () => {
        const index = schemas.findIndex((schema) => schema.version === version);
        version = schemas[index - 1]?.version ?? "0.0.0";
      }
    ),
  };
}
