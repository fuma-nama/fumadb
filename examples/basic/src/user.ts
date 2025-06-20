import { myLib } from "./lib";

export const myLibStorage = myLib.configure({
  targetVersion: "1.0.0",
  provider: "mysql",
  db: {} as any,
  type: "kysely",
});

const migrator = await myLibStorage.createMigrator();
migrator.migrateTo(myLibStorage.config.targetVersion);
