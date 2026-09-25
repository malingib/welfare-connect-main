import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  requirePrivilegedRole,
  verifyAppJwtFromRequest,
  type AppJwtPayload,
} from "../_shared/app_jwt.ts";

import { buildCorsHeaders } from "../_shared/cors.ts";

function jsonResponse(
  status: number,
  payload: Record<string, unknown>,
  origin?: string | null,
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...buildCorsHeaders(origin), "Content-Type": "application/json" },
  });
}

function nestedMessage(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  return (
    nestedMessage(record.message) ||
    nestedMessage(record.error) ||
    nestedMessage(record.code) ||
    JSON.stringify(record)
  );
}

function isVercelDeny(status: number, parsed: unknown, text: string): boolean {
  const message = nestedMessage(parsed).toLowerCase() || text.toLowerCase();
  return status === 403 && /vercel|forbidden|mitigated|deny/.test(message);
}

type SupabaseClientLike = ReturnType<typeof createClient>;

async function getNetPaidForCase(
  supabase: SupabaseClientLike,
  memberId: string,
  caseId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("transactions")
    .select("transaction_type,amount,status")
    .eq("member_id", memberId)
    .eq("case_id", caseId)
    .in("transaction_type", [
      "contribution",
      "case_wallet_deduction",
      "arrears",
      "late_payment",
      "contribution_refund",
      "case_wallet_refund",
    ])
    .or("status.eq.completed,status.is.null");

  if (error || !Array.isArray(data)) return 0;

  return data.reduce((total: number, row: Record<string, unknown>) => {
    const txType = String(row.transaction_type || "").toLowerCase().trim();
    const amount = Number(row.amount || 0);
    if (txType === "contribution" || txType === "case_wallet_deduction" || txType === "arrears" || txType === "late_payment") {
      return total + Math.abs(amount);
    }
    if (txType === "contribution_refund" || txType === "case_wallet_refund") {
      return total + (amount >= 0 ? -amount : amount);
    }
    return total;
  }, 0);
}

async function runEdgeBulkDeduct(
  caseRef: string,
  memberIds: string[],
  claims: AppJwtPayload,
): Promise<Record<string, unknown>> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let caseQuery = supabase
    .from("cases")
    .select("id,case_number,contribution_per_member,is_active,is_finalized")
    .eq("id", caseRef)
    .maybeSingle();

  if (/^\d+$/.test(caseRef)) {
    caseQuery = supabase
      .from("cases")
      .select("id,case_number,contribution_per_member,is_active,is_finalized")
      .eq("case_number", caseRef)
      .maybeSingle();
  }

  const { data: caseRow, error: caseError } = await caseQuery;
  if (caseError) throw caseError;
  if (!caseRow) throw new Error("Case not found");
  if (!caseRow.is_active || caseRow.is_finalized) {
    throw new Error("Case must be active and not finalized");
  }

  const required = Number(caseRow.contribution_per_member || 0);
  if (!Number.isFinite(required) || required <= 0) {
    throw new Error("Invalid contribution_per_member on case");
  }

  const caseId = String(caseRow.id);
  const caseNumber = String(caseRow.case_number || "");
  const uniqueMemberIds = [...new Set(memberIds.map((id) => String(id || "").trim()).filter(Boolean))];

  const deducted: string[] = [];
  const skipped_already_paid: string[] = [];
  const skipped_insufficient: Record<string, unknown>[] = [];
  const skipped_ineligible: Record<string, unknown>[] = [];

  for (const memberId of uniqueMemberIds) {
    const netPaid = await getNetPaidForCase(supabase, memberId, caseId);
    if (netPaid + 1e-6 >= required) {
      skipped_already_paid.push(memberId);
      continue;
    }

    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id,wallet_balance,is_active,status")
      .eq("id", memberId)
      .maybeSingle();

    if (memberError || !member) {
      skipped_insufficient.push({
        member_id: memberId,
        reason: "member_not_found",
        detail: memberError?.message || null,
      });
      continue;
    }

    const status = String(member.status || "").toLowerCase().trim();
    const isActive = Boolean(member.is_active);
    if (!isActive || !["active", "probation"].includes(status)) {
      skipped_ineligible.push({
        member_id: memberId,
        reason: "member_not_eligible",
        is_active: isActive,
        status,
      });
      continue;
    }

    const wallet = Number(member.wallet_balance || 0);
    if (wallet + 1e-6 < required) {
      skipped_insufficient.push({
        member_id: memberId,
        reason: "insufficient_balance",
        wallet_balance: wallet,
      });
      continue;
    }

    const payload = {
      member_id: memberId,
      case_id: caseId,
      amount: Math.round(required * 100) / 100,
      transaction_type: "case_wallet_deduction",
      payment_method: "wallet",
      description: `Case wallet deduction — Case ${caseNumber}`,
      status: "completed",
      reference: `case_deduct:${caseId}:${memberId}`,
      metadata: {
        source: "edge_bulk_deduct_case",
        case_number: caseNumber,
        session_id: claims.sid || null,
        actor_user_id: String(claims.sub || "") || null,
      },
    };

    const { error: insertError } = await supabase.from("transactions").insert(payload);
    if (!insertError) {
      deducted.push(memberId);
      continue;
    }

    if (insertError.code === "23505") {
      const nextNetPaid = await getNetPaidForCase(supabase, memberId, caseId);
      if (nextNetPaid + 1e-6 >= required) {
        skipped_already_paid.push(memberId);
        continue;
      }
    }

    skipped_insufficient.push({
      member_id: memberId,
      reason: "insert_failed",
      code: insertError.code || null,
      detail: insertError.message,
    });
  }

  return {
    success: true,
    case_id: caseId,
    case_number: caseNumber,
    required_amount: required,
    deducted,
    skipped_already_paid,
    skipped_ineligible,
    skipped_insufficient,
  };
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req.headers.get("Origin"));
  let resolvedRole = "unknown";
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, req.headers.get("Origin"));
  }

  try {
    const claims = await verifyAppJwtFromRequest(req);
    resolvedRole = String(claims.role || "").toLowerCase().trim() || "unknown";
    requirePrivilegedRole(claims.role);

    const mlgUrl = Deno.env.get("MLG_BULK_DEDUCT_URL");
    const internalKey = Deno.env.get("MLG_INTERNAL_BULK_KEY");
    if (!mlgUrl || !internalKey) {
      return jsonResponse(500, { error: "MLG bulk deduct not configured on server" }, req.headers.get("Origin"));
    }

    const body = await req.json();
    const case_id = body?.case_id as string | undefined;
    const member_ids = body?.member_ids as string[] | undefined;
    if (!case_id || !Array.isArray(member_ids) || member_ids.length === 0) {
      return jsonResponse(400, { error: "case_id and member_ids[] required" }, req.headers.get("Origin"));
    }

    const res = await fetch(mlgUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mlg-Internal-Key": internalKey,
      },
      body: JSON.stringify({ case_id, member_ids }),
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    if (!res.ok) {
      if (isVercelDeny(res.status, parsed, text)) {
        const fallback = await runEdgeBulkDeduct(case_id, member_ids, claims);
        return jsonResponse(200, { ...fallback, upstream_fallback: "vercel_denied_legacy" }, req.headers.get("Origin"));
      }

      const upstreamError =
        (parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
          (nestedMessage((parsed as Record<string, unknown>).error) ||
            nestedMessage((parsed as Record<string, unknown>).message))) ||
        text.trim() ||
        `Upstream bulk deduct failed (${res.status})`;

      return jsonResponse(
        res.status,
        {
          success: false,
          error: upstreamError,
          upstream_status: res.status,
          upstream_body: text,
        },
        req.headers.get("Origin"),
      );
    }

    return new Response(JSON.stringify(parsed), {
      status: res.status,
      headers: { ...buildCorsHeaders(req.headers.get("Origin")), "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    const lower = msg.toLowerCase();
    if (msg === "Forbidden") {
      return jsonResponse(
        403,
        {
          error: "Forbidden",
          role: resolvedRole,
          allowed_roles: ["super_admin", "chairperson", "treasurer", "secretary"],
        },
        req.headers.get("Origin"),
      );
    }
    if (
      lower.includes("missing bearer token") ||
      lower.includes("jwt") ||
      lower.includes("signature") ||
      lower.includes("exp") ||
      lower.includes("app_jwt_secret")
    ) {
      return jsonResponse(401, { error: msg }, req.headers.get("Origin"));
    }
    return jsonResponse(500, { error: msg }, req.headers.get("Origin"));
  }
});
