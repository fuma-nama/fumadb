import { createPress, recommendedPreset } from "fumapress";
import { vercelImage } from "fumapress/plugins/image/vercel";
import { linkValidationPlugin } from "fumapress/plugins/link-validation";
import { lucideIconsPlugin } from "fumadocs-core/source/plugins/lucide-icons";
import { DatabaseIcon } from "lucide-react";
import { SponsorsMarquee } from "@fumari/sponsors";
import { docs } from "./.source/server";

export const app = createPress(
  docs.toFumadocsSource({
    baseDir: "docs",
  }),
  {
    loaderPlugins: [lucideIconsPlugin()],
  },
).plugins(linkValidationPlugin(), vercelImage());

export default app.config({
  // search, llms.txt, Open Graph images and the sitemap are default plugins,
  // the image provider is listed above
  preset: recommendedPreset({ image: false }),
  site: {
    name: "FumaDB",
    baseUrl: "https://fumadb.vercel.app",
    git: {
      user: "fuma-nama",
      repo: "fumadb",
      branch: "main",
    },
  },
  head: [
    { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" } },
    {
      tag: "link",
      attrs: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
    },
    {
      tag: "link",
      attrs: {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&family=Geist:wght@100..900&display=swap",
      },
    },
  ],
  ui: {
    layoutProps: {
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
    },
    renderPage(props) {
      // content pages of a single (unkeyed) source have no type, plugin views do
      if (props.type !== undefined) return props.renderDefault();

      return props.renderDefault({
        pageProps: {
          tableOfContent: {
            style: "clerk",
            footer: <SponsorsMarquee />,
          },
        },
      });
    },
  },
});
