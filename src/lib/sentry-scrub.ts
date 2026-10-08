/**
 * Shared Sentry payload scrubber.
 *
 * Used as `beforeSend`, `beforeSendTransaction`, and `beforeBreadcrumb`
 * so every event, transaction, and breadcrumb is filtered the same way.
 * The function is pure: it mutates the object it is given (Sentry's
 * callbacks own that object) and returns it, or null to drop a crumb.
 *
 * Paths whose bodies must never leave the process: billing, CLI telemetry,
 * internal email, and Stripe webhook payloads. Authorization (including
 * CRON_SECRET bearer) and stripe-signature headers are always stripped.
 */

export const SENSITIVE_BODY_PATHS = [
  "/api/public/billing/",
  "/api/public/cli/",
  "/api/internal/email/",
  "/api/public/payments/webhook",
] as const;

const HEADER_DROP =
  /^(authorization|cookie|set-cookie|x-api-key|apikey|x-supabase|proxy-authorization|x-csrf|stripe-signature)$/i;

/** Headers that carry the client IP or IP-derived location. Never sent. */
const IP_HEADER_DROP =
  /^(x-forwarded-for|x-real-ip|forwarded|cf-connecting-ip|true-client-ip|x-client-ip|x-cluster-client-ip|fastly-client-ip|x-vercel-forwarded-for|x-vercel-proxied-for|x-vercel-ip-[a-z0-9-]+)$/i;

const SENSITIVE_KEY =
  /pass(word)?|secret|token|jwt|session|auth|api[-_]?key|otp|code|email|phone|credential|signature/i;

const EMAIL_SHAPE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT_SHAPE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

export type ScrubbableRequest = {
  url?: string;
  data?: unknown;
  body?: unknown;
  cookies?: unknown;
  query_string?: unknown;
  headers?: Record<string, string> | unknown;
};

export type ScrubbableEvent = {
  message?: string;
  user?: unknown;
  request?: ScrubbableRequest;
  extra?: unknown;
  contexts?: unknown;
  tags?: unknown;
  breadcrumbs?: { values?: ScrubbableBreadcrumb[] } | ScrubbableBreadcrumb[];
  exception?: { values?: Array<{ value?: string; type?: string }> };
};

export type ScrubbableBreadcrumb = {
  type?: string;
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
};

function stripQueryAndFragment(url: string): string {
  const hash = url.indexOf("#");
  const query = url.indexOf("?");
  let end = url.length;
  if (query !== -1) end = Math.min(end, query);
  if (hash !== -1) end = Math.min(end, hash);
  return url.slice(0, end);
}

function redactText(value: string): string {
  return value.replace(EMAIL_SHAPE, "[redacted]").replace(JWT_SHAPE, "[redacted]");
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

function redactDeep(value: unknown, parentKey?: string): unknown {
  if (typeof value === "string") {
    if (parentKey && isSensitiveKey(parentKey)) return "[redacted]";
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, parentKey));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? "[redacted]" : redactDeep(nested, key);
    }
    return out;
  }
  if (parentKey && isSensitiveKey(parentKey) && value != null) {
    return "[redacted]";
  }
  return value;
}

function requestUrlLooksSensitive(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const path = url.startsWith("http") ? new URL(url).pathname : (url.split("?")[0] ?? url);
    return SENSITIVE_BODY_PATHS.some((prefix) => path.startsWith(prefix) || path.includes(prefix));
  } catch {
    return SENSITIVE_BODY_PATHS.some((prefix) => url.includes(prefix));
  }
}

function scrubHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (HEADER_DROP.test(key) || IP_HEADER_DROP.test(key)) continue;
    const text = typeof value === "string" ? redactText(value) : String(value);
    out[key] = /^referer$/i.test(key) ? stripQueryAndFragment(text) : text;
  }
  return out;
}

function scrubRequest(request: ScrubbableRequest): void {
  if (typeof request.url === "string") {
    request.url = stripQueryAndFragment(request.url);
  }
  delete request.data;
  delete request.body;
  delete request.cookies;
  delete request.query_string;
  if (request.headers) {
    request.headers = scrubHeaders(request.headers);
  }
}

export function scrubBreadcrumb(breadcrumb: ScrubbableBreadcrumb): ScrubbableBreadcrumb | null {
  if (breadcrumb.category === "console" || breadcrumb.type === "debug") {
    return null;
  }
  if (typeof breadcrumb.message === "string") {
    breadcrumb.message = redactText(breadcrumb.message);
  }
  if (breadcrumb.data) {
    const data = { ...breadcrumb.data };
    for (const urlKey of ["url", "from", "to"] as const) {
      const raw = data[urlKey];
      if (typeof raw === "string") data[urlKey] = stripQueryAndFragment(raw);
    }
    breadcrumb.data = redactDeep(data) as Record<string, unknown>;
  }
  return breadcrumb;
}

export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  delete event.user;
  if (event.request) {
    // Billing, CLI, email, and Stripe webhook bodies never attach — even
    // after the generic `data`/`body` delete — so a future SDK field that
    // reintroduces the payload still hits this path check.
    if (requestUrlLooksSensitive(event.request.url)) {
      delete event.request.data;
      delete event.request.body;
    }
    scrubRequest(event.request);
  }
  if (typeof event.message === "string") {
    event.message = redactText(event.message);
  }
  if (event.exception?.values) {
    for (const item of event.exception.values) {
      if (typeof item.value === "string") item.value = redactText(item.value);
    }
  }
  if (event.extra) event.extra = redactDeep(event.extra);
  if (event.contexts) event.contexts = redactDeep(event.contexts);
  if (event.tags) event.tags = redactDeep(event.tags) as T["tags"];

  const crumbs = event.breadcrumbs;
  if (Array.isArray(crumbs)) {
    event.breadcrumbs = crumbs
      .map((crumb) => scrubBreadcrumb(crumb))
      .filter((crumb): crumb is ScrubbableBreadcrumb => crumb != null);
  } else if (crumbs && Array.isArray(crumbs.values)) {
    crumbs.values = crumbs.values
      .map((crumb) => scrubBreadcrumb(crumb))
      .filter((crumb): crumb is ScrubbableBreadcrumb => crumb != null);
  }
  return event;
}
