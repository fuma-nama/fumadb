import { createHandler } from "../src/convex";
import { v1 } from "../test/query/schema-1";

export const { mutationHandler, queryHandler } = createHandler({
  secret: "test",
  schema: v1,
});
