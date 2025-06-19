import type { Schema } from "../create";
import { execute, schemaToDBType } from "./execute";
import { generateMigration } from "./auto";
import { MigrationOperation, TableOperation } from "./shared";
import { Config, UserConfig } from "../../shared/config";

type Awaitable<T> = T | Promise<T>;

export interface MigrationContext {
  auto: () => Promise<MigrationOperation[]>;
}

export type MigrateFucntion = (
  context: MigrationContext
) => Awaitable<MigrationOperation[]>;

function createVersionManager(lib: Config, user: UserConfig) {
  const { initialVersion = "0.0.0" } = lib;
  const { db, provider } = user;
  const name = `private_${lib.namespace}_version`;
  const id = "default";

  return {
    async init() {
      await db.schema
        .createTable(name)
        .ifNotExists()
        .addColumn("version", schemaToDBType("varchar(255)", provider), (col) =>
          col.notNull()
        )
        .addColumn("id", schemaToDBType("varchar(255)", provider), (col) =>
          col.primaryKey()
        )
        .execute();

      const result = await db
        .selectFrom(name)
        .select(db.fn.count("id").as("count"))
        .executeTakeFirst();

      if (!result || Number(result.count) === 0) {
        await db
          .insertInto(name)
          .values({
            id,
            version: initialVersion,
          })
          .execute();
      }
    },
    async get() {
      await this.init();

      const result = await db
        .selectFrom(name)
        .where("id", "=", id)
        .select(["version"])
        .limit(1)
        .executeTakeFirstOrThrow();

      return result.version as string;
    },
    async set(v: string) {
      await db
        .updateTable(name)
        .set({
          id,
          version: v,
        })
        .where("id", "=", id)
        .execute();
    },
  };
}

function fromOperations(operations: MigrationOperation[], user: UserConfig) {
  return {
    async runMigrations() {
      for (const op of operations) {
        await execute(op, user).execute();
      }
    },
    getSQL() {
      const compiled = operations.map((m) => execute(m, user).compile().sql);
      return compiled.join(";\n\n") + ";";
    },
  };
}

export function createMigrator(lib: Config, user: UserConfig) {
  const { schemas, initialVersion = "0.0.0" } = lib;
  const _vm = createVersionManager(lib, user);
  const getVersionManager = _vm.init().then(() => _vm);

  function createGenerator(
    fn: () => Awaitable<{
      operations: MigrationOperation[];
      updateVersion: () => Promise<Boolean>;
    }>
  ) {
    return async () => {
      const { operations: result, updateVersion } = await fn();

      return {
        result,
        /**
         * Update database version
         *
         * @returns true if has next/prev version to continue
         */
        updateVersion,
        async runMigrations() {
          for (const op of result) {
            await execute(op, user).execute();
          }
        },
        getSQL() {
          const compiled = result.map((m) => execute(m, user).compile().sql);
          return compiled.join(";\n\n") + ";";
        },
      };
    };
  }

  function generateUp(schema: Schema) {}

  return {
    async getVersionManager() {
      return await getVersionManager;
    },
    async up() {
      const version = await (await getVersionManager).get();

      const index =
        schemas.findIndex((schema) => schema.version === version) + 1;
      if (index === schemas.length) throw new Error("Already up to date.");
      const schema = schemas[index]!;
      const context: MigrationContext = {
        auto() {
          return generateMigration(schema, user);
        },
      };

      const run = schema.up ?? (({ auto }) => auto());
      const operations = await run(context);
      return {
        operations,
        ...fromOperations(operations, user),
        async updateVersion() {
          await (await getVersionManager).set(schema.version);

          return index < schemas.length - 1;
        },
      };
    },
    async migrateToLatest() {
      return this.migrateTo(schemas.at(-1)!.version);
    },
    async migrateTo(version: string) {
      const targetIdx = schemas.findIndex(
        (schema) => schema.version === version
      );

      if (targetIdx === -1)
        throw new Error(
          `Invalid version: ${version}, supported: ${schemas
            .map((schema) => schema.version)
            .join(", ")}.`
        );

      const currentVersion = await (await getVersionManager).get();

      let operations: TableOperation[] = [];
      if (currentVersion === initialVersion) {
        operations = await generateMigration(schemas[targetIdx]!, user);
      } else {
        let index = schemas.findIndex(
          (schema) => schema.version === currentVersion
        );

        while (targetIdx > index) {
          operations.push(...(await this.up()).operations);
          index++;
        }

        while (targetIdx < index) {
          operations.push(...(await this.down()).operations);
          index--;
        }
      }

      return {
        operations,
        ...fromOperations(operations, user),
        async updateVersion() {
          await (await getVersionManager).set(version);
        },
      };
    },
    async down() {
      const version = await (await getVersionManager).get();
      if (version === initialVersion) throw new Error("Not initialized.");

      const index = schemas.findIndex((schema) => schema.version === version);
      const schema = schemas[index]!;
      const previousSchema = schemas[index - 1] ?? {
        version: initialVersion,
        tables: {},
      };
      const run = schema.down ?? (({ auto }) => auto());

      const context: MigrationContext = {
        async auto() {
          return generateMigration(previousSchema, user, {
            dropUnusedColumns: true,
            detectUnusedTables: Object.values(schema.tables).map(
              ({ name }) => name
            ),
          });
        },
      };

      const operations = await run(context);
      return {
        operations,
        ...fromOperations(operations, user),
        async updateVersion() {
          await (await getVersionManager).set(previousSchema.version);

          return previousSchema.version !== initialVersion;
        },
      };
    },
  };
}
