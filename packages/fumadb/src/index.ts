import { abstractQuery } from "./query";
import { Schema } from "./schema/create";

export function fumadb<S extends Schema>(schema: S) {
  return {
    get abstract() {
      return abstractQuery(schema);
    },
  };
}
