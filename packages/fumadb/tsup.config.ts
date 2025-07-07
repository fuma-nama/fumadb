import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/schema/index.ts",
    "src/query/index.ts",
    "src/cli/index.ts",
  ],
  splitting: false,
  format: "esm",
  sourcemap: true,
  dts: true,
  clean: true,
});
