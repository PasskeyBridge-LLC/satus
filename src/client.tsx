/**
 * Client entry. When VITE_SENTRY_DSN is set, the SDK chunk starts loading
 * but hydration does not wait on it. An empty DSN never requests the chunk.
 */
import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

if (import.meta.env.VITE_SENTRY_DSN) {
  void import("./lib/sentry").then(({ initSentry }) => initSentry("client"));
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
