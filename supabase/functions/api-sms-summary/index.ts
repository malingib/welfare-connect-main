import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { requirePrivilegedRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";
import { fetchSmsBalance } from "../_shared/sms.ts";

function jsonResponse(status: number, payload: Record<string, unknown>, origin?: string | null) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...buildCorsHeaders(origin), "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const corsHeaders = buildCorsHeaders(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" }, origin);

  try {
    const claims = await verifyAppJwtFromRequest(req);
    requirePrivilegedRole(claims.role);

    const body = await req.json().catch(() => ({}));
    const page = Math.max(1, Number(body.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(body.page_size || 20)));
    const offset = (page - 1) * pageSize;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const smsQuery = () => supabase.from("audit_logs").select("id", { count: "exact", head: true }).eq("table_name", "sms");

    const [sentCount, deliveredCount, failedCount, recentRows, totalCount, balanceResult] = await Promise.all([
      smsQuery().eq("action", "SMS_SENT"),
      smsQuery().eq("action", "SMS_DELIVERED"),
      smsQuery().eq("action", "SMS_FAILED"),
      supabase
        .from("audit_logs")
        .select("action, status, metadata, timestamp")
        .eq("table_name", "sms")
        .order("timestamp", { ascending: false })
        .range(offset, offset + pageSize - 1),
      smsQuery(),
      fetchSmsBalance().catch((error) => ({ balance: null, raw: { error: error instanceof Error ? error.message : String(error) } })),
    ]);

    return jsonResponse(200, {
      sent: sentCount.count || 0,
      delivered: deliveredCount.count || 0,
      failed: failedCount.count || 0,
      balance: balanceResult.balance,
      recent: recentRows.data || [],
      total: totalCount.count || 0,
      page,
      page_size: pageSize,
    }, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lowered = message.toLowerCase();
    const status = message === "Forbidden" ? 403 : lowered.includes("jwt") || lowered.includes("jws") || lowered.includes("token") ? 401 : 500;
    return jsonResponse(status, { error: message }, origin);
  }
});
