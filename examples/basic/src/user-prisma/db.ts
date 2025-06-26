import { PrismaClient } from "@prisma/client";
import { myLib, createMyLib } from "../lib";

export const myLibStorage = myLib.configure({
  provider: "mysql",
  type: "prisma",
  prisma: new PrismaClient(),
});

const instance = createMyLib({
  db: myLibStorage,
});

console.log(await instance.getUser());
