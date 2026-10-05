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
import { blogPosts } from "./scripts/vite-plugin-blog-posts";

export default defineConfig(({ mode }) => ({
  /* Inline every VITE_* value as a literal, rather than leaning on Vite's
   * implicit import.meta.env handling. Half the readers of these vars are
   * server route handlers that run in the Nitro worker
   * (src/routes/email/unsubscribe.ts, the email endpoints,
   * integrations/supabase/client.server.ts), and an unreplaced
   * import.meta.env there resolves to undefined at runtime rather than
   * failing the build. loadEnv picks up prefixed keys from process.env as
   * well as .env files, which is how the values arrive on Vercel. */
  define: Object.fromEntries(
    Object.entries(loadEnv(mode, process.cwd(), "VITE_")).map(([k, v]) => [
      `import.meta.env.${k}`,
      JSON.stringify(v),
    ]),
  ),

  css: { transformer: "lightningcss" },

  /* The entry chunk is about 300KB gzipped. Preloading it from <head>
   * shares the slow-4G pipe with the stylesheet and the LCP font, and
   * the font is what the largest text is waiting on. The module script
   * at the end of the body still loads it for hydration. */
  build: { modulePreload: false },

  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    /* React and the TanStack query core must resolve to one copy each.
     * Two copies of React is the classic "invalid hook call"; two copies of
     * query-core silently splits the cache. */
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
    /* PGlite ships its own wasm + FS bundle; Vite's dep optimizer corrupts
     * them in dev ("Invalid FS bundle size"). Standard upstream guidance. */
    exclude: ["@electric-sql/pglite"],
  },

  plugins: [
    /* Blog sources, with drafts and embargoed posts removed at build time
     * so they never reach any bundle. See the plugin's header. */
    blogPosts(),
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      /* Redirect TanStack Start's bundled server entry to src/server.ts (our
       * SSR error wrapper). @cloudflare/vite-plugin builds from this;
       * wrangler.jsonc `main` alone is insufficient. */
      server: { entry: "server" },
      /* Fail the build if client code imports server-only modules, rather
       * than shipping a server bundle to the browser. */
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    }),
    /* `defaultPreset` rather than `preset`: it yields to an explicit
     * NITRO_PRESET in the environment, which is how the deploy target gets
     * to disagree with us. Vercel's build produces .output/ from this. */
    nitro({ defaultPreset: "cloudflare-module" }),
    viteReact(),
  ],
}));
