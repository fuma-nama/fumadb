import { mysqlTable, varchar, foreignKey, text, customType, bigint, json, datetime, uniqueIndex, index } from "drizzle-orm/mysql-core"
import { sql, defineRelations } from "drizzle-orm"

export const users = mysqlTable("users", {
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

export const accounts = mysqlTable("accounts", {
  id: varchar("id", { length: 255 }).primaryKey().notNull()
})

const customBinary = customType<
  {
    data: Uint8Array;
    driverData: Buffer;
  }
>({
  dataType() {
    return "longblob";
  },
  fromDriver(value) {
    if (value == null || (value as any) === "") return null as unknown as Uint8Array;
    return value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  },
  toDriver(value) {
    return value instanceof Buffer? value : Buffer.from(value)
  }
});

export const posts = mysqlTable("posts", {
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

export const files = mysqlTable("files", {
  id: varchar("id", { length: 255 }).primaryKey().notNull(),
  bucket: varchar("bucket", { length: 255 }).notNull(),
  key: varchar("key", { length: 1024 }).collate("utf8mb4_bin").notNull(),
  name: text("name").notNull(),
  size: bigint("size", { mode: "bigint" }).notNull(),
  metadata: json("metadata"),
  checksum: varchar("checksum", { length: 255 }).notNull(),
  createdAt: datetime("created_at", { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`)
}, (table) => [
  uniqueIndex("files_bucket_key_uk").on(table.bucket, sql`${table.key}(512)`),
  uniqueIndex("unique_c_files_checksum").on(table.checksum),
  index("files_bucket_created_idx").on(table.bucket, table.createdAt),
  index("files_name_idx").on(sql`${table.name}(255)`)
])

export const relations = defineRelations({ users, accounts, posts, files }, (r) => ({
  users: {
    account: r.one.accounts({
      from: r.users.id,
      to: r.accounts.id,
      alias: "users_accounts"
    }),
    posts: r.many.posts({
      alias: "posts_users"
    })
  },
  accounts: {
    user: r.one.users({
      from: r.accounts.id,
      to: r.users.id,
      alias: "users_accounts"
    })
  },
  posts: {
    author: r.one.users({
      from: r.posts.authorId,
      to: r.users.id,
      alias: "posts_users"
    })
  }
}))