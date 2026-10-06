import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsFor } from "../_shared/cors.ts";
import { requireMemberManagementRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

function jsonResponse(req: Request, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsFor(req), "Content-Type": "application/json" },
  });
}

function normalizeCandidate(value: unknown): string | null {
  const v = String(value ?? "").trim();
  return v.length > 0 ? v : null;
}

function isInvalidUuidError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = String(error.message || "").toLowerCase();
  return error.code === "22P02" || msg.includes("invalid input syntax for type uuid");
}

async function resolveMemberId(
  supabase: ReturnType<typeof createClient>,
  selectors: string[],
): Promise<string | null> {
  for (const selector of selectors) {
    const byId = await supabase
      .from("members")
      .select("id")
      .eq("id", selector)
      .maybeSingle();
    if (byId.data?.id) {
      return String(byId.data.id);
    }
    if (byId.error && !isInvalidUuidError(byId.error)) {
      throw byId.error;
    }

    const byMemberNumber = await supabase
      .from("members")
      .select("id")
      .eq("member_number", selector)
      .maybeSingle();
    if (byMemberNumber.error) {
      throw byMemberNumber.error;
    }
    if (byMemberNumber.data?.id) {
      return String(byMemberNumber.data.id);
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (!["GET", "POST"].includes(req.method)) return jsonResponse(req, 405, { error: "Method not allowed" });

  try {
    const claims = await verifyAppJwtFromRequest(req);
    const role = String(claims.role || "").toLowerCase();
    if (role !== "member") {
      requireMemberManagementRole(role);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: cases, error: caseError } = await supabase
      .from("cases")
      .select("id, case_number, case_type, contribution_per_member, expected_amount, actual_amount, is_active, is_finalized, created_at")
      .order("created_at", { ascending: false });
    if (caseError) throw caseError;

    let memberCount = 0;
    const { count } = await supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);
    memberCount = count || 0;

    let paidCaseIds = new Set<string>();
    if (role === "member" && (cases || []).length > 0) {
      const selectors = Array.from(
        new Set(
          [claims.member_id, claims.sub, (claims as { member_number?: string }).member_number]
            .map(normalizeCandidate)
            .filter((v): v is string => v != null),
        ),
      );
      const resolvedMemberId = selectors.length > 0
        ? await resolveMemberId(supabase, selectors)
        : null;

      if (!resolvedMemberId) {
        return jsonResponse(req, 404, { error: "Member not found" });
      }

      const ids = (cases || []).map((c: any) => c.id);
      const { data: tx } = await supabase
        .from("transactions")
        .select("case_id, status")
        .eq("member_id", resolvedMemberId)
        .in("case_id", ids)
        .in("transaction_type", ["contribution", "case_wallet_deduction"]);
      paidCaseIds = new Set(
        (tx || []).filter((t: any) => !t.status || t.status === "completed").map((t: any) => String(t.case_id)),
      );
    }

    const mapped = (cases || []).map((c: any) => ({
      ...c,
      expected_amount:
        c.expected_amount ?? ((Number(c.contribution_per_member) || 0) * memberCount),
      paid: role === "member" ? paidCaseIds.has(String(c.id)) : null,
    }));

    return jsonResponse(req, 200, { cases: mapped });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return jsonResponse(req, msg === "Forbidden" ? 403 : 401, { error: msg });
  }
});
