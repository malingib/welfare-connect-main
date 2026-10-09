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

function normalizePhone(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("7")) return `254${digits}`;
  return digits;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (!["GET", "POST"].includes(req.method)) return jsonResponse(req, 405, { error: "Method not allowed" });

  try {
    const claims = await verifyAppJwtFromRequest(req);
    requirePrivilegedRole(claims.role);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data, error } = await supabase
      .from("wrong_mpesa_transactions")
      .select(
        "id, mpesa_receipt_number, phone_number, amount, sender_name, transaction_date, status, reference, matched_member_id, intended_case_id, intended_member_id, created_at",
      )
      .in("status", ["pending", "PENDING_REVIEW"])
      .order("transaction_date", { ascending: false })
      .limit(300);
    if (error) throw error;

    const { data: settings } = await supabase.from("settings").select("registration_fee").limit(1).maybeSingle();
    const registrationFee = Number(settings?.registration_fee || 0);
    const { data: applications } = await supabase
      .from("membership_applications")
      .select("id, application_reference, full_name, phone_number, status, payment_code")
      .in("status", ["pending_review", "payment_pending"])
      .order("application_date", { ascending: false })
      .limit(500);

    const withCandidates = (data || []).map((transaction) => ({
      ...transaction,
      registration_candidates: (applications || [])
        .filter((application) => normalizePhone(application.phone_number) === normalizePhone(transaction.phone_number))
        .map((application) => ({
          id: application.id,
          application_reference: application.application_reference,
          full_name: application.full_name,
          phone_number: application.phone_number,
          status: application.status,
          payment_code: application.payment_code,
          amount_matches: registrationFee > 0 && Number(transaction.amount || 0) === registrationFee,
          expected_amount: registrationFee,
        })),
    }));

    return jsonResponse(req, 200, { transactions: withCandidates });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return jsonResponse(req, msg === "Forbidden" ? 403 : 401, { error: msg });
  }
});
