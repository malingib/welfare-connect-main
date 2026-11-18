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
        "id, mpesa_receipt_number, phone_number, amount, sender_name, transaction_date, status, reference, matched_member_id, intended_case_id, intended_member_id, metadata, created_at",
      )
      .order("transaction_date", { ascending: false })
      .limit(300);
    if (error) throw error;

    const memberIds = [...new Set((data || []).flatMap((row) => {
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
      return [row.intended_member_id, row.matched_member_id, metadata.phone_matched_member_id]
        .filter((id): id is string => typeof id === "string" && !!id);
    }))];
    const caseIds = [...new Set((data || []).map((row) => row.intended_case_id).filter((id): id is string => typeof id === "string" && !!id))];
    const [{ data: members, error: membersError }, { data: cases, error: casesError }] = await Promise.all([
      memberIds.length
        ? supabase.from("members").select("id, member_number, name, phone_number").in("id", memberIds)
        : Promise.resolve({ data: [], error: null }),
      caseIds.length
        ? supabase.from("cases").select("id, case_number, case_type, contribution_per_member").in("id", caseIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (membersError) throw membersError;
    if (casesError) throw casesError;
    const memberById = new Map((members || []).map((member) => [member.id, member]));
    const caseById = new Map((cases || []).map((caseRow) => [caseRow.id, caseRow]));

    const { data: settings } = await supabase.from("settings").select("registration_fee").limit(1).maybeSingle();
    const registrationFee = Number(settings?.registration_fee || 0);
    const { data: applications } = await supabase
      .from("membership_applications")
      .select("id, application_reference, full_name, phone_number, status, payment_code")
      .in("status", ["pending_review", "approved", "payment_pending"])
      .order("application_date", { ascending: false })
      .limit(500);

    const withCandidates = (data || []).map((transaction) => {
      const txRef = String(transaction.reference || "").trim().toUpperCase();

      return {
        ...transaction,
        matched_member: transaction.matched_member_id ? memberById.get(transaction.matched_member_id) || null : null,
        intended_member: transaction.intended_member_id ? memberById.get(transaction.intended_member_id) || null : null,
        payer_suggestion: typeof (transaction.metadata as Record<string, unknown> | null)?.phone_matched_member_id === "string"
          ? memberById.get((transaction.metadata as Record<string, string>).phone_matched_member_id) || null
          : null,
        intended_case: transaction.intended_case_id ? caseById.get(transaction.intended_case_id) || null : null,
        registration_candidates: (applications || [])
          .filter((application) => {
            const appRef = String(application.payment_code || "").trim().toUpperCase();
            return !!txRef && !!appRef && txRef === appRef;
          })
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
      };
    });

    return jsonResponse(req, 200, { transactions: withCandidates });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return jsonResponse(req, msg === "Forbidden" ? 403 : 401, { error: msg });
  }
});
