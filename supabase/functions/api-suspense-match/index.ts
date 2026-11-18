import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsFor } from "../_shared/cors.ts";
import { requireFinanceRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

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
    requireFinanceRole(claims.role);
    const body = await req.json().catch(() => ({}));
    const suspenseId = String(body?.suspense_id || "");
    const memberId = String(body?.member_id || "");
    const caseId = body?.case_id ? String(body.case_id) : null;
    const overrideReason = String(body?.override_reason || "").trim();
    if (!suspenseId || !memberId) {
      return jsonResponse(req, 400, { error: "suspense_id and member_id required" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: suspense, error: suspenseErr } = await supabase
      .from("wrong_mpesa_transactions")
      .select(
        "id, amount, mpesa_receipt_number, intended_case_id, intended_member_id, metadata, reference, notes, transaction_date, status",
      )
      .eq("id", suspenseId)
      .maybeSingle();
    if (suspenseErr || !suspense) return jsonResponse(req, 404, { error: "Suspense transaction not found" });
    if (!["pending", "PENDING_REVIEW"].includes(String(suspense.status))) {
      return jsonResponse(req, 409, { error: "Only pending suspense payments can be matched" });
    }

    const metadata = suspense.metadata && typeof suspense.metadata === "object"
      ? suspense.metadata as Record<string, unknown>
      : {};
    const payerSuggestionId = typeof metadata.phone_matched_member_id === "string"
      ? metadata.phone_matched_member_id
      : null;
    const suggestedMemberIds = [suspense.intended_member_id, payerSuggestionId].filter(Boolean);
    const isOverride = suggestedMemberIds.length > 0 && !suggestedMemberIds.includes(memberId);
    if (isOverride && overrideReason.length < 5) {
      return jsonResponse(req, 400, { error: "A reason of at least 5 characters is required when matching a different member from the suggestions" });
    }

    const targetCaseId = caseId || suspense.intended_case_id || null;
    const txType = targetCaseId ? "contribution" : "wallet_funding";
    const normalizedReceipt = String(suspense.mpesa_receipt_number || "")
      .trim()
      .replace(/\s+/g, "")
      .toUpperCase();

    if (normalizedReceipt) {
      const { data: existingTx, error: existingTxErr } = await supabase
        .from("transactions")
        .select("id")
        .eq("mpesa_reference", normalizedReceipt)
        .limit(1)
        .maybeSingle();
      if (existingTxErr) throw existingTxErr;

      if (existingTx) {
        const { error: updateErr } = await supabase
          .from("wrong_mpesa_transactions")
          .update({
            status: "matched",
            matched_member_id: memberId,
            intended_case_id: targetCaseId,
            matched_at: new Date().toISOString(),
            matched_by: claims.sub,
            metadata: { ...metadata, matched_by: claims.sub, match_override_reason: isOverride ? overrideReason : null },
            notes: `${suspense.notes || ""}\nDuplicate receipt already in transactions (${existingTx.id}); skipped insert.`.trim(),
          })
          .eq("id", suspenseId);
        if (updateErr) throw updateErr;

        const { error: auditErr } = await supabase.from("audit_logs").insert({
          user_id: claims.sub,
          action: "SUSPENSE_MANUAL_MATCH",
          table_name: "wrong_mpesa_transactions",
          record_id: suspense.id,
          status: "success",
          metadata: {
            suspense_id: suspense.id,
            member_id: memberId,
            intended_member_id: suspense.intended_member_id,
            payer_suggestion_member_id: payerSuggestionId,
            override: isOverride,
            override_reason: isOverride ? overrideReason : null,
            receipt: normalizedReceipt,
            amount: suspense.amount,
            deduplicated: true,
            existing_transaction_id: existingTx.id,
          },
        });
        if (auditErr) console.error("Failed to record suspense match audit", auditErr.message);

        return jsonResponse(req, 200, { success: true, deduplicated: true, existing_transaction_id: existingTx.id });
      }
    }

    const { error: txErr } = await supabase.from("transactions").insert({
      member_id: memberId,
      case_id: targetCaseId,
      amount: suspense.amount,
      transaction_type: txType,
      payment_method: "mpesa",
      mpesa_reference: normalizedReceipt || null,
      reference: suspense.reference,
      description: targetCaseId
        ? `M-Pesa Case Payment matched from suspense - Ref: ${suspense.reference || "N/A"}`
        : `M-Pesa Wallet Funding matched from suspense - Ref: ${suspense.reference || "N/A"}`,
      status: "completed",
      created_at: suspense.transaction_date,
      metadata: {
        matched_from_suspense: true,
        suspense_id: suspense.id,
      },
    });
    if (txErr) throw txErr;

    const { error: updateErr } = await supabase
      .from("wrong_mpesa_transactions")
      .update({
        status: "matched",
        matched_member_id: memberId,
        intended_case_id: targetCaseId,
        matched_at: new Date().toISOString(),
        matched_by: claims.sub,
        metadata: { ...metadata, matched_by: claims.sub, match_override_reason: isOverride ? overrideReason : null },
      })
      .eq("id", suspenseId);
    if (updateErr) throw updateErr;

    const { error: auditErr } = await supabase.from("audit_logs").insert({
      user_id: claims.sub,
      action: "SUSPENSE_MANUAL_MATCH",
      table_name: "wrong_mpesa_transactions",
      record_id: suspense.id,
      status: "success",
      metadata: {
        suspense_id: suspense.id,
        member_id: memberId,
        intended_member_id: suspense.intended_member_id,
        payer_suggestion_member_id: payerSuggestionId,
        override: isOverride,
        override_reason: isOverride ? overrideReason : null,
        receipt: normalizedReceipt,
        amount: suspense.amount,
      },
    });
    if (auditErr) console.error("Failed to record suspense match audit", auditErr.message);

    return jsonResponse(req, 200, { success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return jsonResponse(req, msg === "Forbidden" ? 403 : 401, { error: msg });
  }
});
