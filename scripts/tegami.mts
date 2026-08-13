import { tegami } from "tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

const paper = tegami({
  ignore: ["docs", "example-basic", "@repo/typescript-config", "new-package"],
  npm: {
    client: "pnpm",
  },
  plugins: [
    github({
      repo: "fuma-nama/fumadb",
      versionPr: {
        base: "dev",
      },
    }),
  ],
});

await runCli(paper);
