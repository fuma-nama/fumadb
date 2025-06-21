import { pgTable, serial, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial().primaryKey().notNull(),
  name: varchar({ length: 255 }).notNull(),
  email: varchar({ length: 255 }).notNull(),
  image: varchar({ length: 200 }).default("my-avatar"),
});

export const accounts = pgTable("accounts", {
  id: varchar({ length: 255 }).primaryKey().notNull(),
});
