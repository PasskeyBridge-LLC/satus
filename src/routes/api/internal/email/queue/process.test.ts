import { describe, expect, it, vi } from "vitest";
import { Route } from "./process";

// We want to test that missing auth header returns 401
// And invalid auth header returns 403
// Without actually running the whole queue logic which depends on env vars and a complex mock.

describe("process-email-queue endpoint", () => {
  it("returns 401 if missing Authorization header", async () => {
    // Stub env vars so the pre-checks pass
    vi.stubEnv("RESEND_API_KEY", "re_12345678901234567890");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...");
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");

    const request = new Request("http://localhost/api/internal/email/queue/process", {
      method: "POST",
    });

    const handler = Route.options.server?.handlers?.POST;
    if (!handler) throw new Error("Missing POST handler");

    const response = await handler({ request, params: {} } as any);
    expect(response.status).toBe(401);
    
    const body = await response.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns 403 if Authorization header is wrong", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_12345678901234567890");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...");
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");

    const request = new Request("http://localhost/api/internal/email/queue/process", {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong-key",
      },
    });

    const handler = Route.options.server?.handlers?.POST;
    if (!handler) throw new Error("Missing POST handler");

    const response = await handler({ request, params: {} } as any);
    expect(response.status).toBe(403);
    
    const body = await response.json();
    expect(body).toEqual({ error: "Forbidden" });
  });
});
