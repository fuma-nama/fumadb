import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "fumadb/cuid": path.resolve(__dirname, "./src/cuid.ts"),
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
  },
});
