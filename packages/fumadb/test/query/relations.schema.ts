import { table, idColumn, column, schema } from "../../src/schema";

const users = table("users", {
  id: idColumn("id", "varchar(255)", { default: "auto" }),
  name: column("name", "string"),
});

const posts = table("posts", {
  id: idColumn("id", "varchar(255)", { default: "auto" }),
  authorId: column("author_id", "varchar(255)"),
  content: column("content", "string", {
    default: { value: "default content." },
  }),
  relyTo: column("rely_to", "varchar(255)", { nullable: true }),
  attachmentUrl: column("attachment_url", "varchar(255)", {
    unique: true,
    nullable: true,
  }),
});

const attachments = table("attachments", {
  id: idColumn("id", "varchar(255)", { default: "auto" }),
  url: column("url", "varchar(255)", {
    unique: true,
  }),
  data: column("data", "binary", { nullable: true }),
});

export const v1 = schema({
  version: "1.0.0",
  tables: {
    users,
    posts,
    attachments,
  },
  relations: {
    users: ({ many }) => ({
      posts: many(posts),
    }),
    posts: ({ one, many }) => ({
      author: one(users, ["authorId", "id"]).foreignKey({
        // if you set it on primary keys, id columns cannot be updated, it should be always `RESTRICT`.
        onUpdate: "RESTRICT",
        onDelete: "CASCADE",
      }),
      relies: many(posts),
      relying: one(posts, ["relyTo", "id"]).foreignKey(),
      attachment: one(attachments),
    }),
    attachments: ({ one }) => ({
      post: one(posts, ["url", "attachmentUrl"]).foreignKey({
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      }),
    }),
  },
});
