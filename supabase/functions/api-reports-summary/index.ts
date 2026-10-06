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

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const [
      { count: totalMembers, error: membersCountErr },
      { count: activeMembers, error: activeMembersErr },
      { count: totalCases, error: casesCountErr },
      { count: activeCases, error: activeCasesErr },
      { count: totalTransactions, error: txCountErr },
      { count: defaulters, error: defaultersErr },
      { data: monthAgg, error: monthAggErr },
      { data: suspenseAgg, error: suspenseAggErr },
      { data: statusRows, error: statusRowsErr },
      { data: disciplineMetrics, error: disciplineMetricsErr },
      { count: monthlyAutoInactive, error: monthlyAutoInactiveErr },
      { count: monthlyReinstatements, error: monthlyReinstatementsErr },
    ] = await Promise.all([
      supabase.from("members").select("id", { count: "exact", head: true }),
      supabase.from("members").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("cases").select("id", { count: "exact", head: true }),
      supabase.from("cases").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("transactions").select("id", { count: "exact", head: true }),
      supabase.from("members").select("id", { count: "exact", head: true }).lt("wallet_balance", 0),
      supabase.rpc("get_monthly_inflow_total", { p_start: startOfMonth }),
      supabase.rpc("get_suspense_pending_summary"),
      supabase
        .from("v_member_status_distribution")
        .select("status, member_count"),
      supabase
        .from("v_member_discipline_metrics")
        .select(
          "active_count, inactive_count, probation_count, deceased_count, auto_inactive_total, reinstatement_total, reinstatement_penalty_total",
        )
        .limit(1)
        .maybeSingle(),
      supabase
        .from("member_status_transitions")
        .select("id", { count: "exact", head: true })
        .eq("reason", "auto_inactive_two_consecutive_defaults")
        .gte("created_at", startOfMonth),
      supabase
        .from("member_reinstatement_events")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startOfMonth),
    ]);

    if (membersCountErr) throw membersCountErr;
    if (activeMembersErr) throw activeMembersErr;
    if (casesCountErr) throw casesCountErr;
    if (activeCasesErr) throw activeCasesErr;
    if (txCountErr) throw txCountErr;
    if (defaultersErr) throw defaultersErr;
    if (monthAggErr) throw monthAggErr;
    if (suspenseAggErr) throw suspenseAggErr;
    if (statusRowsErr) throw statusRowsErr;
    if (disciplineMetricsErr) throw disciplineMetricsErr;
    if (monthlyAutoInactiveErr) throw monthlyAutoInactiveErr;
    if (monthlyReinstatementsErr) throw monthlyReinstatementsErr;

    const monthRow = Array.isArray(monthAgg) ? monthAgg[0] : monthAgg;
    const monthlyCollection = toNum((monthRow as Record<string, unknown> | null | undefined)?.total);

    const suspenseRow = Array.isArray(suspenseAgg) ? suspenseAgg[0] : suspenseAgg;
    const sr = suspenseRow as Record<string, unknown> | null | undefined;
    const suspensePendingCount = toNum(sr?.pending_count);
    const suspensePendingAmount = toNum(sr?.pending_amount);

    const statusDistribution = (statusRows || []).reduce((acc: Record<string, number>, row: any) => {
      const key = String(row?.status || "unknown");
      acc[key] = toNum(row?.member_count);
      return acc;
    }, {});

    return jsonResponse(req, 200, {
      report: {
        total_members: totalMembers || 0,
        active_members: activeMembers || 0,
        total_cases: totalCases || 0,
        active_cases: activeCases || 0,
        total_transactions: totalTransactions || 0,
        defaulter_count: defaulters || 0,
        monthly_collection: monthlyCollection,
        suspense_pending_count: suspensePendingCount,
        suspense_pending_amount: suspensePendingAmount,
        status_distribution: statusDistribution,
        discipline: {
          active_count: toNum((disciplineMetrics as any)?.active_count),
          inactive_count: toNum((disciplineMetrics as any)?.inactive_count),
          probation_count: toNum((disciplineMetrics as any)?.probation_count),
          deceased_count: toNum((disciplineMetrics as any)?.deceased_count),
          auto_inactive_total: toNum((disciplineMetrics as any)?.auto_inactive_total),
          reinstatement_total: toNum((disciplineMetrics as any)?.reinstatement_total),
          reinstatement_penalty_total: toNum((disciplineMetrics as any)?.reinstatement_penalty_total),
          monthly_auto_inactive: monthlyAutoInactive || 0,
          monthly_reinstatements: monthlyReinstatements || 0,
        },
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return jsonResponse(req, msg === "Forbidden" ? 403 : 401, { error: msg });
  }
});
