import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "fumadb/cuid": path.resolve(import.meta.dirname, "./src/cuid.ts"),
    },
  },
  optimizeDeps: {
    include: ["drizzle-kit"],
  },
  ssr: {
    noExternal: ["drizzle-kit"],
  },
  test: {
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false,
    maxConcurrency: 1,
  },
});
