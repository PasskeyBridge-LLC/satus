import { describe, expect, it, vi } from "vitest";
import { Route } from "./process";

// We want to test that missing auth header returns 401
// And invalid auth header returns 403
// Without actually running the whole queue logic which depends on env vars and a complex mock.
// To bypass the queue logic we use a mock for createEmailQueueClient in actual test,
// but for these auth tests we just want to see it fail early or pass auth and throw on createEmailQueueClient.

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    throw new Error("Auth passed, stopping execution");
  },
}));

type RouteHandler = (ctx: {
  request: Request;
  params: Record<string, string>;
}) => Promise<Response>;

function handlers(): { GET?: RouteHandler; POST?: RouteHandler } {
  const found = (
    Route as unknown as {
      options?: { server?: { handlers?: { GET?: RouteHandler; POST?: RouteHandler } } };
    }
  ).options?.server?.handlers;
  if (!found) throw new Error("queue/process handlers are not registered");
  return found;
}

describe("process-email-queue endpoint", () => {
  it("returns 401 if missing Authorization header (GET)", async () => {
    // Stub env vars so the pre-checks pass
    vi.stubEnv("RESEND_API_KEY", "re_12345678901234567890");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...");
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");

    const request = new Request("http://localhost/api/internal/email/queue/process", {
      method: "GET",
    });

    const handler = handlers().GET;
    if (!handler) throw new Error("Missing GET handler");

    const response = await handler({ request, params: {} });
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns 403 if Authorization header is wrong (POST)", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_12345678901234567890");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...");
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");

    const request = new Request("http://localhost/api/internal/email/queue/process", {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong-key",
      },
    });

    const handler = handlers().POST;
    if (!handler) throw new Error("Missing POST handler");

    const response = await handler({ request, params: {} });
    expect(response.status).toBe(403);

    const body = await response.json();
    expect(body).toEqual({ error: "Forbidden" });
  });

  it("passes auth if Bearer matches SUPABASE_SERVICE_ROLE_KEY (POST)", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_12345678901234567890");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "valid-service-key");
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");

    const request = new Request("http://localhost/api/internal/email/queue/process", {
      method: "POST",
      headers: {
        Authorization: "Bearer valid-service-key",
      },
    });

    const handler = handlers().POST;
    if (!handler) throw new Error("Missing POST handler");

    await expect(handler({ request, params: {} })).rejects.toThrow(
      "Auth passed, stopping execution",
    );
  });

  it("passes auth if Bearer matches CRON_SECRET (GET)", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_12345678901234567890");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "valid-service-key");
    vi.stubEnv("CRON_SECRET", "valid-cron-secret");
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");

    const request = new Request("http://localhost/api/internal/email/queue/process", {
      method: "GET",
      headers: {
        Authorization: "Bearer valid-cron-secret",
      },
    });

    const handler = handlers().GET;
    if (!handler) throw new Error("Missing GET handler");

    await expect(handler({ request, params: {} })).rejects.toThrow(
      "Auth passed, stopping execution",
    );
  });
});
