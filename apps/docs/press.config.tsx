import { defineConfig } from "fumapress";
import { fumadocsMdx } from "fumapress/adapters/mdx";
import { flexsearchPlugin } from "fumapress/plugins/flexsearch";
import { llmsPlugin } from "fumapress/plugins/llms.txt";
import { takumiPlugin } from "fumapress/plugins/takumi";
import { loader } from "fumadocs-core/source";
import { docs } from "./.source/server";
import { lucideIconsPlugin } from "fumadocs-core/source/plugins/lucide-icons";
import { createDocsLayout } from "fumapress/layouts/docs";

export default defineConfig({
  loader: loader(docs.toFumadocsSource(), {
    baseUrl: "/",
    plugins: [lucideIconsPlugin()],
  }),
  site: {
    name: "FumaDB",
    baseUrl: "https://fumadb.vercel.app",
    git: {
      user: "fuma-nama",
      repo: "fumadb",
      branch: "main",
    },
  },
  meta: {
    root() {
      return (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin=""
          />
          <link
            href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&family=Geist:wght@100..900&display=swap"
            rel="stylesheet"
          />
        </>
      );
    },
  },
})
  .usePlugins(flexsearchPlugin(), llmsPlugin(), takumiPlugin())
  .useAdapters(fumadocsMdx())
  .useLayouts({
    page: createDocsLayout({
      async render(page) {
        return {
          pageProps: {
            toc: (await page.data.load()).toc,
            tableOfContent: { style: "clerk" },
          },
        };
      },
    }),
  });
