import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*"],
    // for database operations
    fileParallelism: false,
  },
});
