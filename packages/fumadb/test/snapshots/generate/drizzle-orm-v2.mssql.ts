import { mssqlTable, varchar, customType, bigint, nvarchar, datetime, uniqueIndex, index } from "drizzle-orm/mssql-core"
import { sql, defineRelations } from "drizzle-orm"

export const users = mssqlTable("users", {
  id: varchar("id", { length: 255 }).primaryKey().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  image: varchar("image", { length: 200 }).default("my-avatar")
})

export const accounts = mssqlTable("accounts", {
  id: varchar("id", { length: 255 }).primaryKey().notNull()
})

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