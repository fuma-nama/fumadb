import { mssqlTable, varchar, customType, bigint, nvarchar, datetime, uniqueIndex, index } from "drizzle-orm/mssql-core"
import { relations } from "drizzle-orm/_relations"
import { sql } from "drizzle-orm"

export const users = mssqlTable("users", {
  id: varchar("id", { length: 255 }).primaryKey().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  image: varchar("image", { length: 200 }).default("my-avatar")
})

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

export const accounts = mssqlTable("accounts", {
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
    return "varbinary(max)";
  },
  fromDriver(value) {
    if (value == null || (value as any) === "") return null as unknown as Uint8Array;
    return value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  },
  toDriver(value) {
    return value instanceof Buffer? value : Buffer.from(value)
  }
});

export const posts = mssqlTable("posts", {
  id: varchar("id", { length: 255 }).primaryKey().notNull(),
  authorId: varchar("author_id", { length: 255 }).notNull(),
  content: varchar("content", { length: "max" }).notNull(),
  image: customBinary("image")
})

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, {
    relationName: "posts_users",
    fields: [posts.authorId],
    references: [users.id]
  })
}));

export const files = mssqlTable("files", {
  id: varchar("id", { length: 255 }).primaryKey().notNull(),
  bucket: varchar("bucket", { length: 255 }).notNull(),
  key: varchar("key", { length: 1024 }).notNull(),
  name: varchar("name", { length: "max" }).notNull(),
  size: bigint("size", { mode: "bigint" }).notNull(),
  metadata: nvarchar("metadata", { length: "max", mode: "json" }),
  checksum: varchar("checksum", { length: 255 }).notNull(),
  createdAt: datetime("created_at").notNull().defaultGetDate()
}, (table) => [
  uniqueIndex("files_bucket_key_uk").on(table.bucket, table.key).where(sql`${table.bucket} IS NOT NULL AND ${table.key} IS NOT NULL`),
  uniqueIndex("unique_c_files_checksum").on(table.checksum).where(sql`${table.checksum} IS NOT NULL`),
  index("files_bucket_created_idx").on(table.bucket, table.createdAt),
  index("files_name_idx").on(table.name)
])