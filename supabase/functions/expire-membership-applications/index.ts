import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsFor } from "../_shared/cors.ts";
import { sendSmsMessage } from "../_shared/sms.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });

  const expectedSecret = Deno.env.get("CRON_SECRET");
  const authorization = req.headers.get("authorization") || "";
  if (expectedSecret && authorization !== `Bearer ${expectedSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsFor(req), "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const [{ data: unpaid, error: unpaidError }, { data: rejected, error: rejectedError }] = await Promise.all([
      supabase.from("membership_applications").select("id, phone_number, application_reference").eq("status", "payment_pending").lte("payment_expires_at", new Date().toISOString()),
      supabase.from("membership_applications").select("id, phone_number, application_reference").eq("status", "rejected").lte("reviewed_at", cutoff),
    ]);
    if (unpaidError) throw unpaidError;
    if (rejectedError) throw rejectedError;
    const expiring = [...(unpaid || []), ...(rejected || [])];

    const { data: count, error } = await supabase.rpc("expire_membership_applications");
    if (error) throw error;

    for (const application of expiring || []) {
      try {
        const { data: template } = await supabase
          .from("sms_templates")
          .select("raw_template")
          .eq("trigger_key", "registration_expired")
          .maybeSingle();
        const message = String((template as { raw_template?: unknown } | null)?.raw_template || "Malanga Welfare: Your membership application has expired after one week without completion. Please submit a new application or contact the Welfare Committee.")
          .replaceAll("{name}", "")
          .replaceAll("{paymentCode}", "");
        await sendSmsMessage([
          application.phone_number,
        ], message);
      } catch (smsError) {
        console.error("Expiry SMS failed", application.application_reference, smsError);
      }
    }

    return new Response(JSON.stringify({ success: true, expired: count || 0 }), {
      headers: { ...corsFor(req), "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Expiry sweep failed" }), {
      status: 500,
      headers: { ...corsFor(req), "Content-Type": "application/json" },
    });
  }
});
