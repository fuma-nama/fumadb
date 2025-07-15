import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const usersTable = defineTable({
  id: v.id("users"),
  name: v.string(),
  email: v.string(),
  image: v.optional(v.string()),
})
  .index("by_id", ["id"])
  .index("by_name", ["name"])
  .index("by_email", ["email"])
  .index("by_image", ["image"]);

const accountsTable = defineTable({
  id: v.id("accounts"),
})
  .index("by_id", ["id"]);

const postsTable = defineTable({
  id: v.id("posts"),
  authorId: v.string(),
  content: v.string(),
  image: v.optional(v.bytes()),
})
  .index("by_id", ["id"])
  .index("by_authorId", ["authorId"])
  .index("by_content", ["content"])
  .index("by_image", ["image"]);


export default defineSchema({
  users: usersTable,
  accounts: accountsTable,
  posts: postsTable,
});