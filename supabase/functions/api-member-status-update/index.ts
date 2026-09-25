import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders } from "../_shared/cors.ts";
import { requirePrivilegedRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

const ALLOWED_STATUSES = new Set(["active", "inactive", "probation", "deceased"]);

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  try {
    const claims = await verifyAppJwtFromRequest(req);
    requirePrivilegedRole(claims.role);

    const body = await req.json().catch(() => ({}));
    const memberId = String(body?.member_id || "").trim();
    const nextStatus = String(body?.status || "").trim().toLowerCase();

    if (!memberId) return jsonResponse(400, { error: "member_id is required" });
    if (!ALLOWED_STATUSES.has(nextStatus)) {
      return jsonResponse(400, { error: "status must be one of active/inactive/probation/deceased" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: current, error: currentError } = await supabase
      .from("members")
      .select("id, status, is_active")
      .eq("id", memberId)
      .maybeSingle();

    if (currentError) throw currentError;
    if (!current) return jsonResponse(404, { error: "Member not found" });

    if (current.status === "inactive" && ["active", "probation"].includes(nextStatus)) {
      return jsonResponse(400, {
        error: "Inactive members are reactivated automatically after wallet top-ups settle the reinstatement penalty.",
      });
    }

    const nextIsActive = nextStatus !== "inactive" && nextStatus !== "deceased";

    const { error: updateError } = await supabase
      .from("members")
      .update({
        status: nextStatus,
        is_active: nextIsActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", memberId);

    if (updateError) throw updateError;

    await supabase.from("member_status_transitions").insert({
      member_id: memberId,
      from_status: current.status,
      to_status: nextStatus,
      from_is_active: current.is_active,
      to_is_active: nextIsActive,
      reason: "manual_status_update",
      performed_by_user_id: String(claims.sub || "unknown"),
      performed_by_role: String(claims.role || "unknown"),
      details: {
        source: "api-member-status-update",
      },
    });

    await supabase.from("audit_logs").insert({
      action: "MEMBER_STATUS_UPDATE",
      table_name: "members",
      record_id: memberId,
      user_id: String(claims.sub || "") || null,
      member_id: memberId,
      status: "success",
      metadata: {
        from_status: current.status,
        to_status: nextStatus,
        performed_by_user_id: String(claims.sub || "unknown"),
        performed_by_role: claims.role || null,
        session_id: claims.sid || null,
      },
    });

    return jsonResponse(200, {
      success: true,
      member_id: memberId,
      from_status: current.status,
      to_status: nextStatus,
      is_active: nextIsActive,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    const status = msg === "Forbidden" ? 403 : msg.toLowerCase().includes("token") ? 401 : 500;
    return jsonResponse(status, { error: msg });
  }
});
