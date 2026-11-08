import { mssqlTable, customType, varchar } from "drizzle-orm/mssql-core"
import { defineRelations } from "drizzle-orm"

const customUniqueIdentifier = customType<
  {
    data: string;
    driverData: string;
  }
>({
  dataType() {
    return "uniqueidentifier";
  },
  fromDriver(value) {
    return value
  },
  toDriver(value) {
    return value
  }
});

export const users = mssqlTable("users", {
  id: customUniqueIdentifier("id").primaryKey().notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  sessionToken: customUniqueIdentifier("session_token")
})

export const relations = defineRelations({ users })