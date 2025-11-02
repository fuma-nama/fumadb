import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { generateUUID } from "fumadb/uuid"

export const users = sqliteTable("users", {
  id: text("id").primaryKey().notNull().$defaultFn(() => generateUUID()),
  email: text("email", { length: 255 }).notNull(),
  sessionToken: text("session_token")
})