import { PrismaClient } from "@prisma/client";
import { myLib, createMyLib } from "../lib";
import { prismaAdapter } from "fumadb/adapters/prisma";

export const myLibStorage = myLib.client(
  prismaAdapter({
    provider: "mysql",
    prisma: new PrismaClient(),
  }),
);

const instance = createMyLib({
  db: myLibStorage,
});

console.log(await instance.getUser());
