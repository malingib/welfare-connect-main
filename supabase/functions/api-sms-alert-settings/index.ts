import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requirePrivilegedRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

function response(origin: string | null, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...buildCorsHeaders(origin), "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(origin) });
  if (req.method !== "POST") return response(origin, 405, { error: "Method not allowed" });

  try {
    const claims = await verifyAppJwtFromRequest(req);
    requirePrivilegedRole(claims.role);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "list").trim().toLowerCase();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    if (action === "list") {
      const { data, error } = await supabase
        .from("sms_alert_recipient_settings")
        .select("trigger_key, admin_user_ids, is_active, updated_at")
        .order("trigger_key");
      if (error) throw error;
      return response(origin, 200, { settings: data || [] });
    }

    if (action === "update") {
      const triggerKey = String(body.trigger_key || "").trim();
      const ids = Array.isArray(body.admin_user_ids)
        ? body.admin_user_ids.map((id: unknown) => String(id).trim()).filter(Boolean)
        : [];
      if (!triggerKey) return response(origin, 400, { error: "trigger_key is required" });

      const { data, error } = await supabase
        .from("sms_alert_recipient_settings")
        .upsert({
          trigger_key: triggerKey,
          admin_user_ids: ids,
          is_active: body.is_active !== false,
          updated_at: new Date().toISOString(),
          updated_by: String(claims.sub || "") || null,
        }, { onConflict: "trigger_key" })
        .select("trigger_key, admin_user_ids, is_active, updated_at")
        .single();
      if (error) throw error;
      return response(origin, 200, { setting: data });
    }

    return response(origin, 400, { error: "Unsupported action" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return response(origin, message === "Forbidden" ? 403 : 401, { error: message });
  }
});
