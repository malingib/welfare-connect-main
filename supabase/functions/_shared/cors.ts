// CORS handling for Supabase Edge Functions.
//
// Allowlist mode: only echoes origins matching malangawelfare variants,
// Netlify deploy, localhost, or ALLOWED_ORIGINS env (comma-separated,
// supports "*.example.com" wildcards). Disallowed origins get list[0]
// so browsers block the read.

const DEFAULT_ALLOWED_ORIGINS = [
  "https://malangawelfare.co.ke",
  "https://www.malangawelfare.co.ke",
  "https://malangawelfare.org",
  "https://www.malangawelfare.org",
  "https://mwelfare.netlify.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

function allowedOrigins(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS") || "";
  const fromEnv = raw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOWED_ORIGINS;
}

function isAllowedOrigin(origin: string, list: string[]): boolean {
  const o = origin.trim();
  if (list.includes(o)) return true;
  // Env-configured wildcards like https://*.example.com or *.example.com
  for (const entry of list) {
    const e = entry.trim();
    if (!e.includes("*")) continue;
    const pattern = "^" + e.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*") + "$";
    try {
      if (new RegExp(pattern).test(o)) return true;
    } catch {
      // ignore bad pattern
    }
  }
  try {
    const url = new URL(o);
    const host = url.hostname.toLowerCase();
    // All malangawelfare variants: apex, www, any subdomain, both TLDs
    if (
      host === "malangawelfare.co.ke" ||
      host.endsWith(".malangawelfare.co.ke") ||
      host === "malangawelfare.org" ||
      host.endsWith(".malangawelfare.org")
    ) {
      return url.protocol === "https:";
    }
    // Local dev on any port
    if (host === "localhost" || host === "127.0.0.1") return true;
  } catch {
    return false;
  }
  return false;
}

const BASE_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-app-token, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  Vary: "Origin",
};

// Resolve the Access-Control-Allow-Origin for a specific request. Echoes
// the request's Origin when allowlisted, otherwise falls back to list[0]
// (browser blocks disallowed callers).
export function buildCorsHeaders(origin?: string | null) {
  const list = allowedOrigins();
  const resolved =
    origin && isAllowedOrigin(origin, list) ? origin.trim() : list[0];
  return {
    ...BASE_HEADERS,
    "Access-Control-Allow-Origin": resolved,
  };
}

// Convenience: derive CORS headers straight from the incoming Request.
export function corsFor(req: Request) {
  return buildCorsHeaders(req.headers.get("origin"));
}

// Backward-compatible static export used by ~30 functions. Defaults to the
// primary allowed origin. Prefer corsFor(req) for correct per-request Origin
// echoing across all allowlisted variants.
export const corsHeaders = {
  ...BASE_HEADERS,
  "Access-Control-Allow-Origin": "https://malangawelfare.co.ke",
};

// Helper function to create a CORS response
export function corsResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

// Helper function to create an error response
export function errorResponse(message: string, status = 400) {
  return corsResponse({ error: message }, status);
}

// Helper function to create a success response
export function successResponse(data: unknown) {
  return corsResponse({ success: true, data });
}
