import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireMemberManagementRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

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
  if (!["GET", "POST"].includes(req.method)) return jsonResponse(405, { error: "Method not allowed" }, origin);

  try {
    const claims = await verifyAppJwtFromRequest(req);
    requireMemberManagementRole(claims.role);

    const body: Record<string, unknown> = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const url = new URL(req.url);

    const search = String(url.searchParams.get("search") ?? body.search ?? "").trim();
    const status = String(url.searchParams.get("status") ?? body.status ?? "all").trim().toLowerCase();
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? body.limit ?? 100), 1), 300);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? body.offset ?? 0), 0);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const fetchLimit = limit + 1;

    let query = supabase
      .from("members")
      .select("id, member_number, name, phone_number, wallet_balance, is_active, status, probation_end_date, created_at, residence")
      .order("created_at", { ascending: false })
      .range(offset, offset + fetchLimit - 1);

    if (search) {
      query = query.or(
        `member_number.ilike.%${search}%,name.ilike.%${search}%,phone_number.ilike.%${search}%`,
      );
    }

    if (status !== "all") {
      if (status === "probation") {
        query = (query as any).in("status", ["probation", "probabation"]);
      } else if (status === "deceased") {
        query = (query as any).in("status", ["deceased", "deaceased"]);
      } else {
        query = query.eq("status", status);
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    const hasMore = (data?.length || 0) > limit;
    const members = hasMore ? (data || []).slice(0, limit) : (data || []);

    return jsonResponse(200, {
      members,
      total: offset + members.length + (hasMore ? 1 : 0),
      limit,
      offset,
      has_more: hasMore,
    }, origin);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return jsonResponse(msg === "Forbidden" ? 403 : 401, { error: msg }, origin);
  }
});
