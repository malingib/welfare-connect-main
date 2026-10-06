import { serve } from "https://deno.land/std@0.165.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsFor } from "../_shared/cors.ts";
import { requirePrivilegedRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

function jsonResponse(req: Request, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsFor(req), "Content-Type": "application/json" },
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const anyErr = error as Record<string, unknown>;
    const msg = String(anyErr.message || anyErr.error || anyErr.details || "").trim();
    if (msg) return msg;
  }
  return "Error";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsFor(req) });
  }

  if (req.method !== "GET") {
    return jsonResponse(req, 405, { error: "Method not allowed" });
  }

  try {
    const claims = await verifyAppJwtFromRequest(req);
    requirePrivilegedRole(claims.role);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: settings, error: settingsError } = await supabase
      .from("settings")
      .select("mpesa_consumer_key, mpesa_consumer_secret, mpesa_passkey, mpesa_shortcode, mpesa_env")
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (settingsError) throw settingsError;

    const hasKeys = !!(settings?.mpesa_consumer_key && settings?.mpesa_consumer_secret);
    return jsonResponse(req, 200, {
      success: hasKeys,
      configured: hasKeys,
      env: settings?.mpesa_env ?? "sandbox",
    });
  } catch (e) {
    const msg = getErrorMessage(e);
    const status = msg === "Forbidden" ? 403 : msg.toLowerCase().includes("token") ? 401 : 500;
    return jsonResponse(req, status, { error: msg, success: false });
  }
});