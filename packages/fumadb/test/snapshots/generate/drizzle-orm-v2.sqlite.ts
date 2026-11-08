import { sqliteTable, text, foreignKey, customType, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core"
import { sql, defineRelations } from "drizzle-orm"

export const users = sqliteTable("users", {
  id: text("id", { length: 255 }).primaryKey().notNull(),
  name: text("name", { length: 255 }).notNull(),
  email: text("email", { length: 255 }).notNull(),
  image: text("image", { length: 200 }).default("my-avatar")
}, (table) => [
  foreignKey({
    columns: [table.id],
    foreignColumns: [accounts.id],
    name: "users_accounts_account_fk"
  }).onUpdate("restrict").onDelete("restrict")
])

export const accounts = sqliteTable("accounts", {
  id: text("id", { length: 255 }).primaryKey().notNull()
})

const customBinary = customType<
  {
    data: Uint8Array;
    driverData: Buffer;
  }
>({
  dataType() {
    return "blob";
  },
  fromDriver(value) {
    if (value == null || (value as any) === "") return null as unknown as Uint8Array;
    return value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  },
  toDriver(value) {
    return value instanceof Buffer? value : Buffer.from(value)
  }
});

export const posts = sqliteTable("posts", {
  id: text("id", { length: 255 }).primaryKey().notNull(),
  authorId: text("author_id", { length: 255 }).notNull(),
  content: text("content").notNull(),
  image: customBinary("image")
}, (table) => [
  foreignKey({
    columns: [table.authorId],
    foreignColumns: [users.id],
    name: "posts_users_author_fk"
  }).onUpdate("restrict").onDelete("restrict")
])

const customBigInt = customType<
  {
    data: bigint;
    driverData: number | bigint;
  }
>({
  dataType() {
    return "integer";
  },
  fromDriver(value) {
    return BigInt(value)
  },
  toDriver(value) {
    return value
  }
});

export const files = sqliteTable("files", {
  id: text("id", { length: 255 }).primaryKey().notNull(),
  bucket: text("bucket", { length: 255 }).notNull(),
  key: text("key", { length: 1024 }).notNull(),
  name: text("name").notNull(),
  size: customBigInt("size").notNull(),
  metadata: text("metadata", { mode: "json" }),
  checksum: text("checksum", { length: 255 }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`)
}, (table) => [
  uniqueIndex("files_bucket_key_uk").on(table.bucket, table.key),
  uniqueIndex("unique_c_files_checksum").on(table.checksum),
  index("files_bucket_created_idx").on(table.bucket, table.createdAt),
  index("files_name_idx").on(table.name)
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