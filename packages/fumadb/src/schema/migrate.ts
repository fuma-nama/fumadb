import type { Schema } from "./create";
import * as Kysely from "./migrate/kysely";

export type MigrationConfig = Kysely.MigrationConfig;

/**
 * Generate the migration instead of schema for lower-level solutions like Kysely (without ORM).
 */
export function generateMigration(schema: Schema, config: MigrationConfig) {
  return Kysely.getMigrations(schema, config);
}
