import { pgTable, varchar, foreignKey, text, customType, bigint, json, timestamp, unique, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"

export const users = pgTable("users", {
  id: varchar("id", { length: 255 }).primaryKey().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  image: varchar("image", { length: 200 }).default("my-avatar")
}, (table) => [
  foreignKey({
    columns: [table.id],
    foreignColumns: [accounts.id],
    name: "users_accounts_account_fk"
  }).onUpdate("restrict").onDelete("restrict")
])

export const usersRelations = relations(users, ({ one, many }) => ({
  account: one(accounts, {
    relationName: "users_accounts",
    fields: [users.id],
    references: [accounts.id]
  }),
  posts: many(posts, {
    relationName: "posts_users"
  })
}));

export const accounts = pgTable("accounts", {
  id: varchar("id", { length: 255 }).primaryKey().notNull()
})

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(users, {
    relationName: "users_accounts",
    fields: [accounts.id],
    references: [users.id]
  })
}));

const customBinary = customType<
  {
    data: Uint8Array;
    driverData: Buffer;
  }
>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    if (value == null || (value as any) === "") return null as unknown as Uint8Array;
    return value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  },
  toDriver(value) {
    return value instanceof Buffer? value : Buffer.from(value)
  }
});

export const posts = pgTable("posts", {
  id: varchar("id", { length: 255 }).primaryKey().notNull(),
  authorId: varchar("author_id", { length: 255 }).notNull(),
  content: text("content").notNull(),
  image: customBinary("image")
}, (table) => [
  foreignKey({
    columns: [table.authorId],
    foreignColumns: [users.id],
    name: "posts_users_author_fk"
  }).onUpdate("restrict").onDelete("restrict")
])

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, {
    relationName: "posts_users",
    fields: [posts.authorId],
    references: [users.id]
  })
}));

export const files = pgTable("files", {
  id: varchar("id", { length: 255 }).primaryKey().notNull(),
  bucket: varchar("bucket", { length: 255 }).notNull(),
  key: varchar("key", { length: 1024 }).notNull(),
  name: text("name").notNull(),
  size: bigint("size", { mode: "bigint" }).notNull(),
  metadata: json("metadata"),
  checksum: varchar("checksum", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => [
  unique("files_bucket_key_uk").on(table.bucket, table.key),
  unique("unique_c_files_checksum").on(table.checksum),
  index("files_bucket_created_idx").on(table.bucket, table.createdAt),
  index("files_name_idx").on(table.name)
])