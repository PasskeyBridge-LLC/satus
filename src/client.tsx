/**
 * Client entry. When VITE_SENTRY_DSN is set, the Sentry SDK is loaded
 * before hydration so errors during boot are captured. When it is empty
 * the SDK chunk is never requested.
 */
import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

async function boot(): Promise<void> {
  if (import.meta.env.VITE_SENTRY_DSN) {
    const { initSentry } = await import("./lib/sentry");
    initSentry("client");
  }

  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <StartClient />
      </StrictMode>,
    );
  });
}

void boot();
