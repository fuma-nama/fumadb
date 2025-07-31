import { cancel, confirm, isCancel } from "@clack/prompts";
import { fumadb } from "../src";
import { createCli } from "../src/cli";
import { idColumn, column, schema, table, variantSchema } from "../src/schema";
import { kyselyTests, resetDB } from "./shared";
import { kyselyAdapter } from "../src/adapters/kysely";

const v1 = schema({
  version: "1.0.0",
  tables: {
    users: table("users", {
      id: idColumn("id", "varchar(255)", { default: "auto" }),
      name: column("name", "string"),
    }),
    messages: table("messages", {
      id: idColumn("id", "varchar(255)", { default: "auto" }),
      user: column("user", "varchar(255)"),
      content: column("content", "string"),
      parent: column("parent", "varchar(255)", { nullable: true }),
    }),
  },
  relations: {
    users: ({ many }) => ({
      messages: many("messages"),
    }),
    messages: ({ one }) => ({
      author: one("users", ["user", "id"]).foreignKey(),
    }),
  },
});

const v1Roles = variantSchema("role", v1, {
  tables: {
    roles: table("roles", {
      id: idColumn("id", "varchar(255)"),
      userId: column("user_id", "varchar(255)", { unique: true }),
    }),
  },
  relations: {
    roles: (b) => ({
      user: b.one("users", ["userId", "id"]),
    }),
    users: (b) => ({
      role: b.one("roles"),
    }),
  },
});

const db = fumadb({
  schemas: [v1, v1Roles],
  namespace: "test",
});

const test = kyselyTests[0]!;
const { main } = createCli({
  db: db.client(kyselyAdapter(test)),
  command: "my-lib",
  version: "0.0.0",
});

const isReset = await confirm({
  message: "reset db?",
});

if (isCancel(isReset)) {
  cancel("skipped cli testing");
  process.exit(0);
}

if (isReset) await resetDB(test.provider);

void main();
