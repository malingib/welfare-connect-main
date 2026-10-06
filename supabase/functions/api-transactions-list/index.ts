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
  if (!["GET", "POST"].includes(req.method)) return jsonResponse(req, 405, { error: "Method not allowed" });

  try {
    const claims = await verifyAppJwtFromRequest(req);
    requireFinanceRole(claims.role);

    const body: Record<string, unknown> = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const url = new URL(req.url);

    const page = Math.max(Number(url.searchParams.get("page") ?? body.page ?? 1), 1);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get("page_size") ?? body.page_size ?? 30), 1), 200);
    const from = (page - 1) * pageSize;
    const fetchLimit = pageSize + 1;
    const to = from + fetchLimit - 1;

    const search = String(url.searchParams.get("search") ?? body.search ?? "").trim();
    const type = String(url.searchParams.get("type") ?? body.type ?? "all").trim();
    const status = String(url.searchParams.get("status") ?? body.status ?? "all").trim();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    let query = supabase
      .from("transactions")
      .select(
        "id, member_id, case_id, amount, transaction_type, payment_method, mpesa_reference, reference, description, status, created_at, members(name, member_number)",
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (type !== "all" && type.length > 0) {
      query = query.eq("transaction_type", type);
    }

    if (status !== "all" && status.length > 0) {
      query = query.eq("status", status);
    }

    if (search.length > 0) {
      query = query.or(
        `reference.ilike.%${search}%,mpesa_reference.ilike.%${search}%,description.ilike.%${search}%`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    const txList = data || [];
    const hasMore = txList.length > pageSize;
    const transactions = txList.slice(0, pageSize).map((tx: any) => ({
      ...tx,
      member_name: tx.members?.name ?? null,
      member_number: tx.members?.member_number ?? null,
      members: undefined,
    }));

    return jsonResponse(req, 200, {
      transactions,
      total: from + transactions.length + (hasMore ? 1 : 0),
      page,
      page_size: pageSize,
      has_more: hasMore,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return jsonResponse(req, msg === "Forbidden" ? 403 : 401, { error: msg });
  }
});
