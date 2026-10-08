import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  if (!router.isServer && import.meta.env.VITE_SENTRY_DSN) {
    void import("@sentry/tanstackstart-react").then((Sentry) => {
      Sentry.addIntegration(Sentry.tanstackRouterBrowserTracingIntegration(router));
    });
  }

  return router;
};
