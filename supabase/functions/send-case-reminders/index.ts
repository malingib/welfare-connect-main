import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { isSmsFailure, sendSmsMessage } from "../_shared/sms.ts";

interface UnpaidCase {
  case_id: string;
  case_number: string;
  contribution_per_member: number;
  case_status: string;
  case_date: string;
}

interface MemberCase extends UnpaidCase {
  member_id: string;
  member_phone: string;
  member_name: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") || "";
    const expectedKey = Deno.env.get("CRON_SECRET");
    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const today = new Date().toISOString().slice(0, 10);
    const threeDaysFromNow = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

    // Get all members with phone numbers who are active or probation
    const { data: members, error: memberError } = await supabase
      .from("members")
      .select("id, name, phone_number, member_number")
      .in("status", ["active", "probation"])
      .not("phone_number", "is", null);

    if (memberError) throw memberError;
    if (!members?.length) {
      return new Response(JSON.stringify({ sent: 0, message: "No eligible members" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prefer admin-editable templates from sms_templates so Settings edits
    // affect the automated reminders too. Fall back to built-in defaults.
    const dbTemplates: Record<string, string> = {};
    try {
      const { data: tplRows } = await supabase
        .from("sms_templates")
        .select("trigger_key, raw_template")
        .in("trigger_key", ["overdue_reminder", "case_due"]);
      for (const row of (tplRows as Array<{ trigger_key: string; raw_template: string }> | null) || []) {
        const text = String(row?.raw_template || "").trim();
        if (row?.trigger_key && text) dbTemplates[row.trigger_key] = text;
      }
    } catch {
      // Fall through to built-in defaults.
    }

    const sent: { member_id: string; case_number: string; trigger: string }[] = [];

    for (const member of members) {
      const phone = String(member.phone_number || "").trim();
      if (!phone) continue;

      const { data: obligations, error: obError } = await supabase
        .rpc("get_member_unpaid_case_obligations", { p_member_id: member.id });

      if (obError || !Array.isArray(obligations)) continue;

      for (const ob of obligations as UnpaidCase[]) {
        const deadline = ob.case_date?.slice(0, 10);
        if (!deadline) continue;

        let triggerKey = "";
        let rawTemplate = "";

        if (deadline < today) {
          triggerKey = "overdue_reminder";
          rawTemplate = dbTemplates["overdue_reminder"] ||
            "Mwanachama mpendwa, malipo ya case {caseNumber} yamechelewa. Tafadhali lipa KES {amount} haraka iwezekanavyo.";
        } else if (deadline <= threeDaysFromNow) {
          triggerKey = "case_due";
          rawTemplate = dbTemplates["case_due"] ||
            "Mwanachama mpendwa, hujalipa case {caseNumber}. Tafadhali lipa KES {amount} kwa paybill 4164179 account {memberNumber} kabla {deadline}.";
        } else {
          continue;
        }

        // Dedup: skip if reminder already sent today for this member+case
        const { data: existing } = await supabase
          .from("audit_logs")
          .select("id")
          .eq("table_name", "sms")
          .eq("metadata->>source", "cron_case_reminder")
          .eq("metadata->>case_number", ob.case_number)
          .eq("metadata->>phone_number", phone)
          .gte("created_at", today)
          .limit(1);
        if (existing?.length) continue;

        // Fetch wallet balance from DB
        let balance = "";
        const { data: wallet } = await supabase
          .from("members")
          .select("wallet_balance")
          .eq("id", member.id)
          .single();
        if (wallet) balance = String(wallet.wallet_balance ?? "");

        const context: Record<string, string> = {
          name: member.name || "Mwanachama",
          memberNumber: String(member.member_number || ""),
          amount: String(ob.contribution_per_member || 0),
          caseNumber: ob.case_number || "",
          deadline: deadline,
          balance,
          ref: "",
          senderName: "",
        };

        let msg = rawTemplate;
        for (const [key, value] of Object.entries(context)) {
          msg = msg.replaceAll(`{${key}}`, value || "");
          msg = msg.replaceAll(`[${key}]`, value || "");
        }

        const results = await sendSmsMessage([phone], msg);

        // Log to audit_logs
        const result = results[0];
        const action = isSmsFailure(result) ? "SMS_FAILED" : result.status === "delivered" ? "SMS_DELIVERED" : "SMS_SENT";
        const isSuccess = !isSmsFailure(result);

        await supabase.from("audit_logs").insert({
          action,
          table_name: "sms",
          status: isSuccess ? "success" : "error",
          user_id: null,
          metadata: {
            source: "cron_case_reminder",
            trigger_key: triggerKey,
            phone_number: phone,
            message: msg,
            case_number: ob.case_number,
            provider_message_id: result.providerMessageId,
          },
        });

        if (isSuccess) {
          await supabase.from("notifications").insert({
            member_id: member.id,
            role: "member",
            title: triggerKey === "overdue_reminder" ? "Malipo Yamechelewa" : "Malipo Yanakaribia",
            message: msg,
            category: triggerKey,
            data: { sms: true, phone, trigger_key: triggerKey, case_number: ob.case_number },
          });

          sent.push({ member_id: member.id, case_number: ob.case_number, trigger: triggerKey });
        }
      }
    }

    return new Response(JSON.stringify({ sent: sent.length, details: sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error in send-case-reminders:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
