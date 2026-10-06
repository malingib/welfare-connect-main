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

const toNum = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (!['GET', 'POST'].includes(req.method)) return jsonResponse(req, 405, { error: "Method not allowed" });

  try {
    const claims = await verifyAppJwtFromRequest(req);
    requirePrivilegedRole(claims.role);

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const days = Math.min(Math.max(Number(body?.days || 90), 7), 3650);
    const latePaymentRowLimit = Math.min(Math.max(Number(body?.late_payment_limit || 1000), 100), 5000);
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const [
      { data: statusRows, error: statusErr },
      { data: metricsRow, error: metricsErr },
      { data: transitions, error: transitionsErr },
      { data: reinstatements, error: reinstatementsErr },
      { data: unpaidRows, error: unpaidErr },
      { data: defaultStreakRows, error: defaultStreakErr },
      { data: latePaymentRows, error: latePaymentErr },
      { data: latePaymentAggregateRow, error: latePaymentAggregateErr },
    ] = await Promise.all([
      supabase.from('v_member_status_distribution').select('status, member_count'),
      supabase.from('v_member_discipline_metrics').select(
        'active_count, inactive_count, probation_count, deceased_count, auto_inactive_total, reinstatement_total, reinstatement_penalty_total',
      ).limit(1).maybeSingle(),
      supabase
        .from('member_status_transitions')
        .select('id, member_id, from_status, to_status, reason, performed_by_role, created_at, details')
        .gte('created_at', fromDate)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('member_reinstatement_events')
        .select('id, member_id, penalty_transaction_id, unpaid_case_count_at_check, unpaid_total_at_check, probation_end_date, performed_by_role, created_at')
        .gte('created_at', fromDate)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('v_member_unpaid_obligations_summary')
        .select('member_id, member_number, name, status, unpaid_case_count, unpaid_total')
        .order('unpaid_total', { ascending: false })
        .limit(500),
      supabase
        .from('member_default_streaks')
        .select('member_id, current_streak, last_defaulted, updated_at, last_case_id')
        .order('updated_at', { ascending: false })
        .limit(1000),
      supabase
        .from('transactions')
        .select('id, member_id, case_id, amount, transaction_type, status, description, created_at, metadata')
        .in('transaction_type', ['arrears', 'late_payment'])
        .gte('created_at', fromDate)
        .in('status', ['completed', 'success'])
        .order('created_at', { ascending: false })
        .limit(latePaymentRowLimit),
      supabase.rpc('get_late_payment_aggregate', { p_from_date: fromDate }),
    ]);

    if (statusErr) throw statusErr;
    if (metricsErr) throw metricsErr;
    if (transitionsErr) throw transitionsErr;
    if (reinstatementsErr) throw reinstatementsErr;
    if (unpaidErr) throw unpaidErr;
    if (defaultStreakErr) throw defaultStreakErr;
    if (latePaymentErr) throw latePaymentErr;
    if (latePaymentAggregateErr) throw latePaymentAggregateErr;

    const caseIds = Array.from(new Set(
      (latePaymentRows || []).map((row: any) => row.case_id).filter(Boolean),
    ));
    const caseLookup = new Map<string, string>();
    if (caseIds.length > 0) {
      const { data: caseRows, error: casesErr } = await supabase
        .from('cases')
        .select('id, case_number')
        .in('id', caseIds);
      if (casesErr) throw casesErr;
      for (const c of caseRows || []) {
        caseLookup.set(c.id, c.case_number);
      }
    }
    const memberIds = Array.from(new Set([
      ...(transitions || []).map((row: any) => row.member_id).filter(Boolean),
      ...(reinstatements || []).map((row: any) => row.member_id).filter(Boolean),
      ...(unpaidRows || []).map((row: any) => row.member_id).filter(Boolean),
      ...(defaultStreakRows || []).map((row: any) => row.member_id).filter(Boolean),
      ...(latePaymentRows || []).map((row: any) => row.member_id).filter(Boolean),
    ]));

    const memberLookup = new Map<string, { member_number: string; name: string; status: string }>();
    if (memberIds.length > 0) {
      const chunkSize = 120;
      for (let i = 0; i < memberIds.length; i += chunkSize) {
        const chunk = memberIds.slice(i, i + chunkSize);
        const { data: members, error: membersErr } = await supabase
          .from('members')
          .select('id, member_number, name, status')
          .in('id', chunk);
        if (membersErr) throw membersErr;
        for (const m of members || []) {
          memberLookup.set(m.id, {
            member_number: m.member_number,
            name: m.name,
            status: m.status,
          });
        }
      }
    }

    const status_distribution = (statusRows || []).reduce((acc: Record<string, number>, row: any) => {
      acc[String(row.status || 'unknown')] = toNum(row.member_count);
      return acc;
    }, {});

    const transitionsWithMember = (transitions || []).map((row: any) => ({
      ...row,
      member_number: memberLookup.get(row.member_id)?.member_number || null,
      member_name: memberLookup.get(row.member_id)?.name || null,
    }));

    const reinstatementsWithMember = (reinstatements || []).map((row: any) => ({
      ...row,
      member_number: memberLookup.get(row.member_id)?.member_number || null,
      member_name: memberLookup.get(row.member_id)?.name || null,
    }));

    const defaultStreaksWithMember = (defaultStreakRows || []).map((row: any) => ({
      ...row,
      member_number: memberLookup.get(row.member_id)?.member_number || null,
      member_name: memberLookup.get(row.member_id)?.name || null,
      member_status: memberLookup.get(row.member_id)?.status || null,
    }));

    const default_outcomes = {
      streak_0: defaultStreaksWithMember.filter((row: any) => toNum(row.current_streak) === 0).length,
      streak_1: defaultStreaksWithMember.filter((row: any) => toNum(row.current_streak) === 1).length,
      streak_ge_2: defaultStreaksWithMember.filter((row: any) => toNum(row.current_streak) >= 2).length,
      members_tracked: defaultStreaksWithMember.length,
    };

    const late_payments = (latePaymentRows || []).map((row: any) => ({
      ...row,
      member_number: memberLookup.get(row.member_id)?.member_number || null,
      member_name: memberLookup.get(row.member_id)?.name || null,
      member_status: memberLookup.get(row.member_id)?.status || null,
      case_number: caseLookup.get(String(row.case_id || '')) || String(row?.metadata?.paid_case_number || ''),
    }));

    const sampledTotal = late_payments.reduce((sum: number, row: any) => sum + Math.abs(toNum(row.amount)), 0);
    const aggregateRow = Array.isArray(latePaymentAggregateRow) ? latePaymentAggregateRow[0] : latePaymentAggregateRow;
    const fullTotal = toNum((aggregateRow as any)?.late_payment_total);
    const fullCount = toNum((aggregateRow as any)?.late_payment_count);

    const late_payment_metrics = {
      late_payment_count: fullCount,
      late_payment_total: fullTotal,
    };
    const late_payment_sample_metrics = {
      late_payment_count: late_payments.length,
      late_payment_total: sampledTotal,
    };
    const late_payment_scope = {
      from_date: fromDate,
      row_limit: latePaymentRowLimit,
      sampled_row_count: late_payments.length,
      full_row_count: fullCount,
      sample_truncated: fullCount > late_payments.length,
    };

    return jsonResponse(req, 200, {
      days,
      status_distribution,
      default_outcomes,
      late_payment_metrics,
      late_payment_sample_metrics,
      late_payment_scope,
      metrics: {
        active_count: toNum((metricsRow as any)?.active_count),
        inactive_count: toNum((metricsRow as any)?.inactive_count),
        probation_count: toNum((metricsRow as any)?.probation_count),
        deceased_count: toNum((metricsRow as any)?.deceased_count),
        auto_inactive_total: toNum((metricsRow as any)?.auto_inactive_total),
        reinstatement_total: toNum((metricsRow as any)?.reinstatement_total),
        reinstatement_penalty_total: toNum((metricsRow as any)?.reinstatement_penalty_total),
      },
      transitions: transitionsWithMember,
      reinstatements: reinstatementsWithMember,
      unpaid_obligations: unpaidRows || [],
      default_streaks: defaultStreaksWithMember,
      late_payments,
    });
  } catch (e) {
    console.error("api-discipline-report error:", e);
    let msg = "Error";
    if (e instanceof Error && e.message) {
      msg = e.message;
    } else if (typeof e === "object" && e !== null) {
      try {
        msg = JSON.stringify(e);
      } catch {
        msg = "Error";
      }
    }
    const status = msg === "Forbidden" ? 403 : msg.toLowerCase().includes("token") ? 401 : 500;
    return jsonResponse(req, status, { error: msg });
  }
});
