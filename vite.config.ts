/**
 * Vite config.
 *
 * This used to be three lines wrapping a vendor package that assembled the
 * plugin list for us. That vendor was the app builder this project started
 * on; we left the platform in August 2026, and its build wrapper was the
 * last thing it still owned. Everything it configured is spelled out below,
 * using the same public plugins it called. The pieces specific to its own
 * sandbox (an HMR gate, a dev-server bridge, an assets proxy, build-error
 * diagnostics, and a forced host/port) are gone rather than reimplemented,
 * because none of them ran outside that sandbox.
 *
 * The settings here are deliberately a faithful transcription rather than
 * an improvement pass. Anything worth changing should change in its own
 * commit, where a regression has one obvious cause.
 */
import { defineConfig, loadEnv } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import { blogPosts } from "./scripts/vite-plugin-blog-posts";

export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, process.cwd(), "VITE_");
  const allEnv = loadEnv(mode, process.cwd(), "");
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN || allEnv.SENTRY_AUTH_TOKEN;

  return {
    define: Object.fromEntries([
      ...Object.entries(viteEnv).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
      [
        "import.meta.env.VITE_VERCEL_ENV",
        JSON.stringify(process.env.VERCEL_ENV || allEnv.VERCEL_ENV || "development"),
      ],
      [
        "import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA",
        JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || allEnv.VERCEL_GIT_COMMIT_SHA || ""),
      ],
    ]),

    css: { transformer: "lightningcss" },

    build: { modulePreload: false },

    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },

    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      exclude: ["@electric-sql/pglite"],
    },

    plugins: [
      blogPosts(),
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        server: { entry: "server" },
        client: { entry: "client" },
        importProtection: {
          behavior: "error",
          client: {
            files: ["**/server/**"],
            specifiers: ["server-only"],
          },
        },
      }),
      nitro({ defaultPreset: "cloudflare-module", inlineDynamicImports: true }),
      viteReact(),
      ...(sentryAuthToken
        ? sentryTanstackStart({
            org: "passkeybridge-llc",
            project: "satus",
            authToken: sentryAuthToken,
            sourcemaps: {
              filesToDeleteAfterUpload: ["./**/*.map"],
            },
          })
        : []),
    ],
  };
});
