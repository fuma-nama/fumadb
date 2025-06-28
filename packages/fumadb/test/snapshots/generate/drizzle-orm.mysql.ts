import { mysqlTable, varchar } from "drizzle-orm/mysql-core"
import { createId } from "fumadb/cuid"

export const users = mysqlTable("users", {
  id: varchar({ length: 255 }).primaryKey().$defaultFn(() => createId()).notNull(),
  name: varchar({ length: 255 }).notNull(),
  email: varchar({ length: 255 }).notNull(),
  image: varchar({ length: 200 }).default("my-avatar")
})

export const accounts = mysqlTable("accounts", {
  id: varchar({ length: 255 }).primaryKey().notNull()
})