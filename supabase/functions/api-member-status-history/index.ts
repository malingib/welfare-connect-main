import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsFor } from "../_shared/cors.ts";
import { requirePrivilegedRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

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
    requirePrivilegedRole(claims.role);

    const body = await req.json().catch(() => ({}));
    const memberId = String(body?.member_id || "").trim();
    const limit = Math.min(Math.max(Number(body?.limit || 20), 1), 200);

    if (!memberId) return jsonResponse(req, 400, { error: "member_id is required" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data, error } = await supabase
      .from("member_status_transitions")
      .select("id, member_id, from_status, to_status, from_is_active, to_is_active, reason, details, performed_by_user_id, performed_by_role, created_at")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    return jsonResponse(req, 200, {
      transitions: data || [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    const status = msg === "Forbidden" ? 403 : msg.toLowerCase().includes("token") ? 401 : 500;
    return jsonResponse(req, status, { error: msg });
  }
});
