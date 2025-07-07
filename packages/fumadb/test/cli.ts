import { cancel, confirm, isCancel } from "@clack/prompts";
import { fumadb } from "../src";
import { createCli } from "../src/cli";
import { idColumn, column, schema, table } from "../src/schema";
import { kyselyTests, resetDB } from "./shared";

const users = table("users", {
  id: idColumn("id", "varchar(255)", { default: "auto" }),
  name: column("name", "string"),
});

const messages = table("messages", {
  id: idColumn("id", "varchar(255)", { default: "auto" }),
  user: column("user", "varchar(255)"),
  content: column("content", "string"),
  parent: column("parent", "varchar(255)", { nullable: true }),
});

const v1 = schema({
  version: "1.0.0",
  tables: {
    users,
    messages,
  },
  relations: {
    users: ({ many }) => ({
      messages: many(messages),
    }),
    messages: ({ one }) => ({
      author: one(users, ["user", "id"]).foreignKey(),
    }),
  },
});

const db = fumadb({
  schemas: [v1],
  namespace: "test",
});

const test = kyselyTests[0]!;
const { main } = createCli({
  db: db.configure({
    type: "kysely",
    db: test.db,
    provider: test.provider,
  }),
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
