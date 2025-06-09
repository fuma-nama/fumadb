export type MigrationConfig = {
  type: "kysely";
};

/**
 * Generate the migration instead of schema for lower-level solutions like Kysely (without ORM).
 */
export function generateMigration(config: MigrationConfig) {}
