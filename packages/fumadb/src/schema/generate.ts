import { Schema } from "./create";

interface KyselyConfig {
  type: "kysely";
}

interface DrizzleConfig {
  type: "drizzle-orm";
}

interface TypeORMConfig {
  type: "type-orm";
}

export type Config = KyselyConfig | DrizzleConfig | TypeORMConfig;

/**
 * Generate schema for different ORMs.
 *
 * We don't want to implement the migrator, it's best for us to leverage existing solutions.
 */
export async function generate(
  schema: Schema,
  config: Config
): Promise<string> {
  return "";
}
