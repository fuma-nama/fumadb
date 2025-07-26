import { FumaDB } from "..";
import { Command } from "commander";
import { isCancel, select, cancel, text } from "@clack/prompts";
import * as fs from "node:fs/promises";
import path from "node:path";

export function createCli(options: {
  db: FumaDB<any>;

  /**
   * CLI command name, must be lowercase without whitespaces.
   */
  command: string;
  description?: string;

  /**
   * CLI Version
   */
  version: string;
}) {
  const db = options.db as FumaDB;

  async function selectVersion(defaultValue?: string) {
    const schemas = db.schemas;
    const selected = await select({
      message: "Select target schema version:",
      options: schemas.map((s, i) => ({
        value: s.version,
        label: s.version,
        hint: i === schemas.length - 1 ? "latest" : undefined,
      })),
      initialValue: defaultValue,
    });

    if (isCancel(selected)) {
      cancel("Migration cancelled.");
      process.exit(0);
    }

    return selected;
  }

  async function inputOutputPath(type: "sql" | "orm", suggestion: string) {
    const result = await text({
      message:
        type === "sql"
          ? "Where to output the SQL migration file?"
          : "Where to output the generated schema? (it will override the destination)",
      defaultValue: suggestion,
      placeholder: suggestion,
    });

    if (isCancel(result)) {
      cancel("Migration cancelled.");
      process.exit(0);
    }

    return result;
  }

  return {
    async main() {
      const program = new Command();
      program
        .name(options.command)
        .description(
          options.description ??
            "FumaDB CLI for migrations and schema generation"
        )
        .version(options.version);

      program
        .command("migrate:up")
        .description("Migrate to the next schema version")
        .action(async () => {
          const migrator = await db.createMigrator();
          const result = await migrator.up();
          await result.execute();
          console.log("Migration up executed.");
        });

      program
        .command("migrate:down")
        .description("Rollback to the previous schema version")
        .action(async () => {
          const migrator = await db.createMigrator();
          const result = await migrator.down();
          await result.execute();
          console.log("Migration down executed.");
        });

      program
        .command("migrate:to [version]")
        .description(
          "Migrate to a specific schema version (interactive if not provided)"
        )
        .action(async (version: string | undefined) => {
          const migrator = await db.createMigrator();
          version ??= await selectVersion(await migrator.versionManager.get());

          let result;
          if (version === "latest") {
            result = await migrator.migrateToLatest();
          } else {
            result = await migrator.migrateTo(version);
          }

          await result.execute();
          console.log(`Migrated to version ${version}.`);
        });

      program
        .command("generate [version]")
        .description(
          "Output SQL (for Kysely) or database schema (for ORMs) for the migration."
        )
        .option(
          "-o, --output <PATH>",
          "the output path of generated SQL/schema file"
        )
        .action(
          async (
            version: string | undefined,
            { output }: { output?: string }
          ) => {
            let generated: string;

            if (db.adapter.kysely) {
              const migrator = await db.createMigrator();
              version ??= await selectVersion(
                await migrator.versionManager.get()
              );

              let result;
              if (version === "latest") {
                result = await migrator.migrateToLatest();
              } else {
                result = await migrator.migrateTo(version);
              }

              generated = result.getSQL();
              output ??= await inputOutputPath(
                "sql",
                `./migrations/${Date.now()}.sql`
              );
            } else {
              let result;
              version ??= await selectVersion();

              try {
                result = await db.generateSchema(version);
              } catch {
                throw new Error(
                  "MongoDB doesn't support migration generation."
                );
              }

              generated = result.code;
              output ??= await inputOutputPath("orm", result.path);
            }

            await fs.mkdir(path.dirname(output), { recursive: true });
            await fs.writeFile(output, generated);
            console.log("Successful.");
          }
        );

      await program.parseAsync(process.argv);
    },
  };
}
