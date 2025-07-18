import { table, idColumn, column, schema } from "../../src/schema";

const users = table("users", {
  id: idColumn("id", "varchar(255)", { default: "auto" }),
  name: column("name", "string"),
});

const messages = table("messages", {
  id: idColumn("id", "varchar(255)", { default: "auto" }),
  user: column("user", "varchar(255)"),
  content: column("content", "string", {
    default: { value: "default content." },
  }),
  parent: column("parent", "varchar(255)", { nullable: true }),
  image: column("image", "binary", { nullable: true }),

  // for testing one-to-one
  mentionId: column("mention_id", "varchar(255)", {
    nullable: true,
    unique: true,
  }),
});

export const v1 = schema({
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
      mentioning: one(messages, ["mentionId", "id"]).foreignKey(),
      mentionedBy: one(messages),
    }),
  },
});
