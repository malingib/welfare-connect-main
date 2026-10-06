import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsFor } from "../_shared/cors.ts";
import { requirePrivilegedRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";
import { isSmsFailure, sendSmsMessage } from "../_shared/sms.ts";

const ALLOWED_STATUSES = new Set(["active", "inactive", "probation", "deceased"]);

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
    const nextStatus = String(body?.status || "").trim().toLowerCase();

    if (!memberId) return jsonResponse(req, 400, { error: "member_id is required" });
    if (!ALLOWED_STATUSES.has(nextStatus)) {
      return jsonResponse(req, 400, { error: "status must be one of active/inactive/probation/deceased" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: current, error: currentError } = await supabase
      .from("members")
      .select("id, name, phone_number, status, is_active")
      .eq("id", memberId)
      .maybeSingle();

    if (currentError) throw currentError;
    if (!current) return jsonResponse(req, 404, { error: "Member not found" });

    if (current.status === "inactive" && ["active", "probation"].includes(nextStatus)) {
      return jsonResponse(req, 400, {
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

    // Notify the member in-app + SMS (best-effort: never fail the status
    // change itself). The DB trigger skips reason='manual_status_update',
    // so this is the only notification for manual changes.
    let notified = false;
    try {
      const memberName =
        String((current as { name?: unknown }).name || "").trim() || "Mwanachama";
      const fromStatus = String(current.status || "?");
      const message =
        `Mwanachama mpendwa ${memberName}, hali yako ya uanachama imebadilika kutoka ${fromStatus} hadi ${nextStatus}.`;

      const { data: inserted } = await supabase
        .from("notifications")
        .insert({
          member_id: memberId,
          role: "member",
          title: "Hali Imabadilika",
          message,
          category: "status_changed",
          data: {
            source: "api-member-status-update",
            from_status: fromStatus,
            to_status: nextStatus,
          },
        })
        .select("id")
        .maybeSingle();

      const phone = String((current as { phone_number?: unknown }).phone_number || "").trim();
      if (phone) {
        const results = await sendSmsMessage([phone], message);
        const result = results[0];
        const smsOk = result && !isSmsFailure(result);
        await supabase.from("audit_logs").insert({
          action: smsOk ? "SMS_SENT" : "SMS_FAILED",
          table_name: "sms",
          status: smsOk ? "success" : "error",
          user_id: String(claims.sub || "") || null,
          metadata: {
            source: "manual_status_update",
            trigger_key: "status_changed",
            phone_number: phone,
            message,
            member_id: memberId,
            provider_message_id: result?.providerMessageId || null,
          },
        });
        if (smsOk && inserted?.id) {
          await supabase
            .from("notifications")
            .update({ sms_sent_at: new Date().toISOString() })
            .eq("id", (inserted as { id: string }).id);
        }
      }
      notified = true;
    } catch (notifyError) {
      console.error("status-change notification failed (non-blocking):", notifyError);
    }

    return jsonResponse(req, 200, {
      success: true,
      member_id: memberId,
      from_status: current.status,
      to_status: nextStatus,
      is_active: nextIsActive,
      notified: notified,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    const status = msg === "Forbidden" ? 403 : msg.toLowerCase().includes("token") ? 401 : 500;
    return jsonResponse(req, status, { error: msg });
  }
});
