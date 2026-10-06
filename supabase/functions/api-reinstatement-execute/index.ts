import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsFor } from "../_shared/cors.ts";

function jsonResponse(req: Request, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsFor(req), "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return jsonResponse(req, 405, { error: "Method not allowed" });

  return jsonResponse(req, 410, {
    error: "Manual reinstatement has been retired. Wallet top-ups automatically settle the reinstatement penalty and reactivate eligible members.",
  });
});
