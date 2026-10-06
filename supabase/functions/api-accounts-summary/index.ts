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

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (!["GET", "POST"].includes(req.method)) return jsonResponse(req, 405, { error: "Method not allowed" });

  try {
    const claims = await verifyAppJwtFromRequest(req);
    requireFinanceRole(claims.role);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: summaryRows, error: summaryErr } = await supabase.rpc("get_accounts_summary");
    if (summaryErr) throw summaryErr;

    const row = Array.isArray(summaryRows) ? summaryRows[0] : summaryRows;
    if (!row || typeof row !== "object") {
      throw new Error("get_accounts_summary returned no data");
    }

    const r = row as Record<string, unknown>;

    return jsonResponse(req, 200, {
      accounts: {
        active_members: toNum(r.active_members),
        total_members: toNum(r.total_members),
        wallet_balance_total: toNum(r.total_wallet_balance),
        contributions_total: toNum(r.contributions_total),
        wallet_funding_total: toNum(r.wallet_funding_total),
        refunds_total: toNum(r.refunds_total),
        suspense_pending_count: toNum(r.suspense_pending_count),
        suspense_pending_amount: toNum(r.suspense_pending_amount),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return jsonResponse(req, msg === "Forbidden" ? 403 : 401, { error: msg });
  }
});
