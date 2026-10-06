import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireMemberManagementRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";
import { corsFor } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsFor(req) });
  }

  try {
    const claims = await verifyAppJwtFromRequest(req);
    requireMemberManagementRole(claims.role);

    const body = await req.json();
    const caseId = String(body?.case_id || "").trim();
    if (!caseId) {
      return new Response(JSON.stringify({ error: "case_id is required" }), {
        status: 400,
        headers: { ...corsFor(req), "Content-Type": "application/json" },
      });
    }

    const startedAt = new Date().toISOString();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("id, case_number")
      .eq("id", caseId)
      .maybeSingle();

    if (caseErr || !caseRow) {
      return new Response(JSON.stringify({ error: "Case not found" }), {
        status: 404,
        headers: { ...corsFor(req), "Content-Type": "application/json" },
      });
    }

    // Process this case's waterfall via the idempotent DB function. The DB also
    // enqueues every payable case (queue + scheduled drain) so this call is a
    // fast-path, not the sole delivery guarantee.
    const { data: wfSummary, error: wfErr } = await supabase.rpc(
      "process_case_waterfall",
      { p_case_id: caseId },
    );

    if (wfErr) throw wfErr;

    const summary = (wfSummary || {}) as Record<string, unknown>;
    const totalMembersEligible = Number(summary.total_members_eligible || 0);
    const membersProcessed = Number(summary.members_processed || 0);
    const finalizedCasesPaid = Number(summary.finalized_cases_paid || 0);
    const activeCasesPaid = Number(summary.active_cases_paid || 0);
    const penaltyPayments = Number(summary.penalty_payments || 0);
    const reactivations = Number(summary.reactivations || 0);
    const rawErrors = Array.isArray(summary.errors) ? summary.errors : [];
    const errors = rawErrors as Array<{ member_id: string; error: string }>;

    // Mark the queued row done (best-effort; the scheduled drain is the backstop).
    try {
      await supabase
        .from("case_waterfall_queue")
        .update({ status: "done", processed_at: new Date().toISOString(), last_error: null })
        .eq("case_id", caseId);
    } catch (qErr) {
      console.error("Queue update error:", qErr);
    }

    let membersMarkedInactive = 0;

    try {
      const { data: disciplineResults } = await supabase
        .rpc("check_and_apply_member_discipline");

      if (Array.isArray(disciplineResults)) {
        membersMarkedInactive = disciplineResults
          .filter((r: Record<string, unknown>) => r.action === "marked_inactive")
          .length;
      }
    } catch (discErr) {
      console.error("Discipline sweep error:", discErr);
    }

    const completedAt = new Date().toISOString();

    const auditPayload = {
      case_id: caseId,
      case_number: caseRow.case_number,
      total_members_eligible: totalMembersEligible,
      members_processed: membersProcessed,
      finalized_cases_paid: finalizedCasesPaid,
      active_cases_paid: activeCasesPaid,
      penalty_payments: penaltyPayments,
      reactivations: reactivations,
      members_marked_inactive: membersMarkedInactive,
      errors: errors,
      started_at: startedAt,
      completed_at: completedAt,
    };

    try {
      await supabase.from("case_creation_audit").insert(auditPayload);
    } catch (auditErr) {
      console.error("Audit insert error:", auditErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        case_id: caseId,
        case_number: caseRow.case_number,
        summary: {
          total_members_eligible: totalMembersEligible,
          members_processed: membersProcessed,
          finalized_cases_paid: finalizedCasesPaid,
          active_cases_paid: activeCasesPaid,
          penalty_payments: penaltyPayments,
          reactivations: reactivations,
          members_marked_inactive: membersMarkedInactive,
          errors: errors.length,
        },
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        status: 200,
        headers: { ...corsFor(req), "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error in api-trigger-waterfall:", error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "An error occurred",
      }),
      {
        status: 500,
        headers: { ...corsFor(req), "Content-Type": "application/json" },
      },
    );
  }
});
