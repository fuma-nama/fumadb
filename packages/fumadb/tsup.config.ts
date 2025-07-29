import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/schema/index.ts",
    "src/query/index.ts",
    "src/adapters/index.ts",
    "src/cli/index.ts",
    "src/adapters/*/index.ts",
  ],
  format: "esm",
  sourcemap: false,
  dts: true,
  clean: true,
});
