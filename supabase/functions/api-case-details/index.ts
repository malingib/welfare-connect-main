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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (!["GET", "POST"].includes(req.method)) return jsonResponse(req, 405, { error: "Method not allowed" });

  try {
    const claims = await verifyAppJwtFromRequest(req);
    const role = String(claims.role || "").toLowerCase();
    if (role !== "member") {
      requireMemberManagementRole(role);
    }
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const caseRefRaw = url.searchParams.get("case_id") || String((body as any).case_id || "");
    const caseRef = caseRefRaw.trim();
    if (!caseRef) return jsonResponse(req, 400, { error: "case_id is required" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: c, error: cErr } = await supabase
      .from("cases")
      .select(
        "id, case_number, case_type, affected_member_id, dependant_id, contribution_per_member, expected_amount, actual_amount, start_date, end_date, is_active, is_finalized, description, created_at, updated_at",
      )
      .or(`id.eq.${caseRef},case_number.eq.${caseRef}`)
      .maybeSingle();

    if (cErr || !c) return jsonResponse(req, 404, { error: "Case not found" });

    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .select("id, member_id, amount, transaction_type, status, created_at")
      .eq("case_id", c.id)
      .in("transaction_type", ["contribution", "contribution_refund", "case_wallet_deduction", "case_wallet_refund"])
      .order("created_at", { ascending: false });
    if (txErr) throw txErr;

    const completed = (tx || []).filter((t: any) => !t.status || t.status === "completed");
    const contributions = completed
      .filter((t: any) => ["contribution", "case_wallet_deduction"].includes(t.transaction_type))
      .reduce((sum: number, t: any) => sum + Math.abs(Number(t.amount) || 0), 0);
    const refunds = completed
      .filter((t: any) => ["contribution_refund", "case_wallet_refund"].includes(t.transaction_type))
      .reduce((sum: number, t: any) => sum + Math.max(Number(t.amount) || 0, 0), 0);
    const net = Math.max(0, contributions - refunds);

    let paid: boolean | null = null;
    if (role === "member" && claims.member_id) {
      paid = completed.some((t: any) =>
        String(t.member_id) === String(claims.member_id) &&
        ["contribution", "case_wallet_deduction"].includes(t.transaction_type),
      );
    }

    return jsonResponse(req, 200, {
      case: {
        ...c,
        actual_amount: net,
        paid,
      },
      transactions: completed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return jsonResponse(req, msg === "Forbidden" ? 403 : 401, { error: msg });
  }
});
