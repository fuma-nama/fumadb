import { myLib } from "../../lib";
import { myLibStorage } from "../db";

// run this before build to migrate database
const migrator = await myLibStorage.createMigrator();

// to targeted version
const result = await migrator.migrateTo(myLib.version("1.0.0"));

// or you can migrate to latest too
// await migrator.migrateToLatest();

await result.execute();
