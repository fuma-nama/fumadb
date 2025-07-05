import { afterAll } from "vitest";
import { sqlite, cleanupPrismaFiles } from "./shared";
import * as fs from "node:fs";

afterAll(() => {
  fs.rmSync(sqlite);
  cleanupPrismaFiles();
});
