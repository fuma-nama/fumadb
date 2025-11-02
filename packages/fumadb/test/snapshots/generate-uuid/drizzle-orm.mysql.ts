import { mysqlTable, char, varchar } from "drizzle-orm/mysql-core"
import { generateUUID } from "fumadb/uuid"

export const users = mysqlTable("users", {
  id: char("id", { length: 36 }).primaryKey().notNull().$defaultFn(() => generateUUID()),
  email: varchar("email", { length: 255 }).notNull(),
  sessionToken: char("session_token", { length: 36 })
})