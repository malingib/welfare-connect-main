import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsFor } from "../_shared/cors.ts";
import { verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

function jsonResponse(req: Request, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsFor(req), "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return jsonResponse(req, 405, { error: "Method not allowed" });

  try {
    const claims = await verifyAppJwtFromRequest(req);
    const role = String(claims.role || "").toLowerCase();
    const body = await req.json().catch(() => ({}));
    const deviceToken = String(body?.device_token || "");
    const platform = String(body?.platform || "flutter");
    if (!deviceToken) return jsonResponse(req, 400, { error: "device_token is required" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { error } = await supabase
      .from("device_tokens")
      .upsert({
        user_id: claims.sub ?? null,
        member_id: claims.member_id ?? null,
        role,
        device_token: deviceToken,
        platform,
        is_active: true,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "device_token" });
    if (error) throw error;

    return jsonResponse(req, 200, { success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return jsonResponse(req, 401, { error: msg });
  }
});
