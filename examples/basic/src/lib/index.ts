import { fumadb } from "fumadb";
import { schema } from "fumadb/schema";

export const myLib = fumadb({
  schemas: [
    schema({
      version: "1.0.0" as const,
      tables: {},
    }),
  ],
  namespace: "lib",
});
