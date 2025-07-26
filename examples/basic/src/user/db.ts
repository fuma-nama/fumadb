import { kyselyAdapter } from "fumadb/adapters/kysely";
import { myLib, createMyLib } from "../lib";

export const myLibStorage = myLib.client(
  kyselyAdapter({
    provider: "mysql",
    db: {} as any,
  }),
);

const instance = createMyLib({
  db: myLibStorage,
});

console.log(await instance.getUser());
