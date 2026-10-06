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

function asSafeString(value: unknown, fallback: string): string {
  const str = String(value ?? "").trim();
  return str || fallback;
}

function asNullableUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return jsonResponse(req, 405, { error: "Method not allowed" });

  try {
    const claims = await verifyAppJwtFromRequest(req);
    const body = await req.json().catch(() => ({}));

    const action = asSafeString(body?.action, "CLIENT_EVENT");
    const tableName = asSafeString(body?.table_name, "system");
    const status = asSafeString(body?.status, "info");
    const recordId = asNullableUuid(body?.record_id);
    const metadata = body?.metadata && typeof body.metadata === "object" ? body.metadata : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { error } = await supabase.from("audit_logs").insert({
      action,
      table_name: tableName,
      record_id: recordId,
      status,
      user_id: asNullableUuid(claims?.sub),
      member_id: asNullableUuid(claims?.member_id),
      metadata,
    });

    if (error) throw error;

    return jsonResponse(req, 200, { success: true });
  } catch (e) {
    const msg = getErrorMessage(e);
    const status = msg === "Forbidden" ? 403 : msg.toLowerCase().includes("token") ? 401 : 500;
    return jsonResponse(req, status, { error: msg });
  }
});
