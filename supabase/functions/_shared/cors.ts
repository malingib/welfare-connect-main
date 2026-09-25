// CORS handling for Supabase Edge Functions.
//
// Origins are driven by the ALLOWED_ORIGINS env var (comma-separated).
// Falls back to the known production + local-dev origins. The previous
// wildcard ('*') is gone: privileged functions must not accept requests
// from arbitrary origins.

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

const BASE_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-app-token, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  Vary: "Origin",
};

// Resolve the Access-Control-Allow-Origin for a specific request. Only echoes
// the request's Origin when it is in the allowlist; otherwise falls back to the
// primary allowed origin (which a disallowed browser origin will reject).
export function buildCorsHeaders(origin?: string | null) {
  const list = allowedOrigins();
  const resolved =
    origin && list.includes(origin) ? origin : list[0];
  return {
    ...BASE_HEADERS,
    "Access-Control-Allow-Origin": resolved,
  };
}

// Convenience: derive CORS headers straight from the incoming Request.
export function corsFor(req: Request) {
  return buildCorsHeaders(req.headers.get("origin"));
}

// Backward-compatible static export used by ~30 functions. No longer '*';
// defaults to the primary allowed origin. Prefer corsFor(req) for correct
// multi-origin echoing.
export const corsHeaders = buildCorsHeaders(null);

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
