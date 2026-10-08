import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from "@sentry/tanstackstart-react";
import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next, pathname }) => {
  /* Machine endpoints opt out of the HTML error page: their callers are
   * Postgres (pg_net), Resend's webhook sender, and our own Stripe handler,
   * all of which want a status code and a JSON body rather than a rendered
   * 500. */
  if (pathname.startsWith("/api/internal/")) {
    return await next();
  }

  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  // Sentry first so request and serverFn errors are captured before our
  // branded HTML 500 middleware swallows them.
  requestMiddleware: [sentryGlobalRequestMiddleware, errorMiddleware],
  // attachSupabaseAuth forwards the user's bearer token on every serverFn
  // RPC. No protected serverFns ship in v1, but the middleware is harmless
  // and keeps any future requireSupabaseAuth route working out of the box.
  functionMiddleware: [sentryGlobalFunctionMiddleware, attachSupabaseAuth],
}));
