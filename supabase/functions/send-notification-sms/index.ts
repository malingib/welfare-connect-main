// Send SMS for member alert notifications that have not been texted yet.
//
// Covers DB-trigger-written alerts (penalty postings, automatic status
// transitions, probation completion/ending) which cannot SMS from plpgsql.
// Run daily via dashboard schedule, after send-case-reminders.
//
// Safety: only rows created in the last 48h are considered, so the first-ever
// run cannot blast the whole history. Rows are marked sms_sent_at on success.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsFor } from "../_shared/cors.ts";
import { isSmsFailure, sendSmsMessage, type SmsSendResult } from "../_shared/sms.ts";

const SWEPT_CATEGORIES = [
  "registration_submitted",
  "registration_pending_review",
  "registration_approved",
  "registration_payment_pending",
  "registration_payment_received",
  "registration_activated",
  "registration_expired",
  "whatsapp_group_invite",
  "registration_rejected",
  "probation_completed",
  "probation_ending",
  "penalty_posted",
  "status_changed",
  "auto_inactive",
  "closed_case_overdue",
  "case_opened",
  "case_closed",
];

const SWEEP_WINDOW_HOURS = 48;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });

  try {
    const authHeader = req.headers.get("authorization") || "";
    const expectedKey = Deno.env.get("CRON_SECRET");
    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsFor(req), "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const cutoff = new Date(Date.now() - SWEEP_WINDOW_HOURS * 3600000).toISOString();

    const { data: pending, error: pendingError } = await supabase
      .from("notifications")
      .select("id, member_id, title, message, category")
      .is("sms_sent_at", null)
      .in("category", SWEPT_CATEGORIES)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(500);

    if (pendingError) throw pendingError;
    if (!pending?.length) {
      return new Response(JSON.stringify({ sent: 0, failed: 0, skipped: 0 }), {
        headers: { ...corsFor(req), "Content-Type": "application/json" },
      });
    }

    const memberIds = [...new Set(pending.map((n) => String(n.member_id)).filter(Boolean))];
    const phoneByMember = new Map<string, string>();
    if (memberIds.length) {
      const { data: members } = await supabase
        .from("members")
        .select("id, phone_number")
        .in("id", memberIds);
      for (const m of (members as Array<{ id: string; phone_number: string | null }> | null) || []) {
        const phone = String(m.phone_number || "").trim();
        if (phone) phoneByMember.set(String(m.id), phone);
      }
    }

    const { data: routingRows } = await supabase
      .from("sms_alert_recipient_settings")
      .select("trigger_key, admin_user_ids, is_active");
    const adminIdsByTrigger = new Map<string, string[]>();
    for (const row of (routingRows || []) as Array<{ trigger_key: string; admin_user_ids: string[] | null; is_active: boolean }>) {
      if (row.is_active !== false) adminIdsByTrigger.set(row.trigger_key, row.admin_user_ids || []);
    }

    const configuredAdminIds = [...new Set([...adminIdsByTrigger.values()].flat())];
    const adminPhoneById = new Map<string, string>();
    if (configuredAdminIds.length) {
      const { data: admins } = await supabase
        .from("users")
        .select("id, member_id, is_active, role")
        .in("id", configuredAdminIds)
        .eq("is_active", true)
        .neq("role", "member");
      const linkedMemberIds = (admins || []).map((admin) => admin.member_id).filter(Boolean) as string[];
      if (linkedMemberIds.length) {
        const { data: adminMembers } = await supabase
          .from("members")
          .select("id, phone_number")
          .in("id", linkedMemberIds);
        const phoneByMember = new Map((adminMembers || []).map((member) => [String(member.id), String(member.phone_number || "").trim()]));
        for (const admin of admins || []) {
          const phone = admin.member_id ? phoneByMember.get(String(admin.member_id)) : "";
          if (phone) adminPhoneById.set(String(admin.id), phone);
        }
      }
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const n of pending as Array<{ id: string; member_id: string; message: string; category: string }>) {
      const phone = phoneByMember.get(String(n.member_id)) || "";
      const adminPhones = [...new Set((adminIdsByTrigger.get(n.category) || [])
        .map((adminId) => adminPhoneById.get(adminId) || "")
        .filter(Boolean))];

      try {
        let smsOk = !phone;
        let result: SmsSendResult | null = null;
        if (phone) {
          const results = await sendSmsMessage([phone], String(n.message || ""));
          result = results[0];
          smsOk = Boolean(result && !isSmsFailure(result));
        } else {
          skipped += 1;
        }

        await supabase.from("audit_logs").insert({
          action: phone ? (smsOk ? "SMS_SENT" : "SMS_FAILED") : "SMS_SKIPPED",
          table_name: "sms",
          status: smsOk ? "success" : "error",
          user_id: null,
          metadata: {
            source: "notification_sweeper",
            trigger_key: n.category,
            phone_number: phone,
            message: n.message,
            member_id: n.member_id,
            notification_id: n.id,
            provider_message_id: result?.providerMessageId || null,
          },
        });

        let adminSent = 0;
        for (const adminPhone of adminPhones) {
          const adminResults = await sendSmsMessage([adminPhone], `[Admin alert] ${String(n.message || "")}`);
          const adminResult = adminResults[0];
          const adminOk = Boolean(adminResult && !isSmsFailure(adminResult));
          await supabase.from("audit_logs").insert({
            action: adminOk ? "SMS_SENT" : "SMS_FAILED",
            table_name: "sms",
            status: adminOk ? "success" : "error",
            user_id: null,
            metadata: {
              source: "notification_admin_routing",
              trigger_key: n.category,
              phone_number: adminPhone,
              message: n.message,
              member_id: n.member_id,
              notification_id: n.id,
              recipient_type: "admin",
              provider_message_id: adminResult?.providerMessageId || null,
            },
          });
          if (adminOk) adminSent += 1;
        }

        if (smsOk || adminSent > 0) {
          await supabase
            .from("notifications")
            .update({ sms_sent_at: new Date().toISOString() })
            .eq("id", n.id);
          sent += 1;
        } else {
          failed += 1;
        }
      } catch (e) {
        console.error("sweeper SMS failed:", n.id, e);
        failed += 1;
      }
    }

    return new Response(JSON.stringify({ sent, failed, skipped }), {
      headers: { ...corsFor(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsFor(req), "Content-Type": "application/json" },
    });
  }
});
