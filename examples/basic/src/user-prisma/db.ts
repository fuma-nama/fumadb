import { myLib, createMyLib } from "../lib";

export const myLibStorage = myLib.configure({
  provider: "mysql",
  db: {} as any,
  type: "kysely",
});

const instance = createMyLib({
  db: myLibStorage,
});

console.log(await instance.getUser());
