import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import press from "fumapress/vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [press(), fumadocsMdx(), tailwindcss()],
});
