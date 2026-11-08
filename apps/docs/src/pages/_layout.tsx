import type { ReactNode } from "react";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { getPressContext, type WakuRouteProps } from "fumapress";
import type { app } from "../../press.config";

export default async function Layout({
  lang,
  children,
}: WakuRouteProps<typeof app> & { children: ReactNode }) {
  const layoutProps = await getPressContext<typeof app>().getLayoutProps({ lang });
  // the Home Layout takes these props, the others are for docs layouts
  const { nav, githubUrl, i18n, themeSwitch, searchToggle } = layoutProps;

  return (
    <HomeLayout
      {...{ nav, githubUrl, i18n, themeSwitch, searchToggle }}
      links={[
        {
          text: "Documentation",
          url: "/docs",
          active: "nested-url",
        },
        ...(layoutProps.links ?? []),
      ]}
    >
      <div className="flex flex-col w-full max-w-[1400px] flex-1 px-4 py-6 mx-auto">{children}</div>
    </HomeLayout>
  );
}
