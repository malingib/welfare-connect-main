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
import { isSmsFailure, sendSmsMessage } from "../_shared/sms.ts";

const SWEPT_CATEGORIES = [
  "probation_completed",
  "probation_ending",
  "penalty_posted",
  "status_changed",
  "auto_inactive",
  "closed_case_overdue",
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

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const n of pending as Array<{ id: string; member_id: string; message: string; category: string }>) {
      const phone = phoneByMember.get(String(n.member_id)) || "";
      if (!phone) {
        skipped += 1;
        continue;
      }

      try {
        const results = await sendSmsMessage([phone], String(n.message || ""));
        const result = results[0];
        const smsOk = result && !isSmsFailure(result);

        await supabase.from("audit_logs").insert({
          action: smsOk ? "SMS_SENT" : "SMS_FAILED",
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

        if (smsOk) {
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
