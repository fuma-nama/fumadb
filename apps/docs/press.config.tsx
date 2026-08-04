import { defineConfig } from "fumapress";
import { fumadocsMdx } from "fumapress/adapters/mdx";
import { flexsearchPlugin } from "fumapress/plugins/flexsearch";
import { llmsPlugin } from "fumapress/plugins/llms.txt";
import { takumiPlugin } from "fumapress/plugins/takumi";
import { docs } from "./.source/server";
import { lucideIconsPlugin } from "fumadocs-core/source/plugins/lucide-icons";
import { createDocsLayoutPage } from "fumapress/layouts/docs";
import { createHomeLayout } from "fumapress/layouts/home";
import { imagePlugin } from "fumapress/plugins/image/vercel";
import { sitemapPlugin } from "fumapress/plugins/sitemap";
import { linkValidationPlugin } from "fumapress/plugins/link-validation";
import { DatabaseIcon } from "lucide-react";
import { SponsorsMarquee } from "@fumari/sponsors";

const config = defineConfig({
  content: docs.toFumadocsSource({
    baseDir: "docs",
  }),
  loaderOptions: {
    plugins: [lucideIconsPlugin()],
  },
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
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link
            href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&family=Geist:wght@100..900&display=swap"
            rel="stylesheet"
          />
        </>
      );
    },
  },
})
  .plugins(
    flexsearchPlugin(),
    llmsPlugin(),
    takumiPlugin(),
    linkValidationPlugin(),
    imagePlugin(),
    sitemapPlugin(),
  )
  .adapters(fumadocsMdx())
  .layouts({
    defaultProps: () => ({
      links: [
        {
          url: "https://fuma-nama.dev/sponsors",
          text: "Sponsors",
          external: true,
        },
      ],
      nav: {
        title: (
          <>
            <DatabaseIcon className="size-5 text-fd-primary" />
            FumaDB
          </>
        ),
      },
    }),
    page: createDocsLayoutPage({
      render() {
        return {
          pageProps: {
            tableOfContent: {
              style: "clerk",
              footer: <SponsorsMarquee />,
            },
          },
        };
      },
    }),
  });

export const HomeLayout = createHomeLayout<Ctx>({
  layoutProps: {
    links: [
      {
        text: "Documentation",
        url: "/docs",
        active: "nested-url",
      },
      {
        text: "Sponsors",
        url: "https://fuma-nama.dev/sponsors",
        external: true,
      },
    ],
  },
});

export type Ctx = (typeof config)["$context"];

export default config;
