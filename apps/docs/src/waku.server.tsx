import adapter from "waku/adapters/default";
import pressConfig from "../press.config";
import { createRouter } from "fumapress/router";
import Page from "./home/page";

const router = createRouter(pressConfig);

const pages = router.extend(async ({ createPage }) => [
  createPage({
    render: "static",
    path: "/",
    component: Page,
  }),
]);

export default adapter(pages);
