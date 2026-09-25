import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { normalizeRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

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

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" }, req.headers.get("Origin"));

  try {
    const claims = await verifyAppJwtFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const limitRaw = Number(body?.limit ?? 20);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(100, Math.trunc(limitRaw)))
      : 20;

    const role = normalizeRole(claims.role);
    const userId = String(claims.sub || "").trim();
    const memberId = String(claims.member_id || "").trim();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Role-targeted + direct user/member-targeted notifications.
    // Members should NOT match by role — role.eq.member would return every
    // notification since all are inserted with role='member'.  Only admins
    // match by role so they can receive admin-role notifications.
    const orClauses: string[] = [];
    const isMemberRole = role === 'member';
    if (role && !isMemberRole) orClauses.push(`role.eq.${role}`);
    if (userId) orClauses.push(`user_id.eq.${userId}`);
    if (memberId) orClauses.push(`member_id.eq.${memberId}`);
    if (orClauses.length === 0) {
      return jsonResponse(200, { success: true, unread_count: 0, notifications: [] }, req.headers.get("Origin"));
    }

    const baseQuery = supabase
      .from("notifications")
      .select("id,title,message,category,is_read,created_at,data")
      .or(orClauses.join(","));

    const { data, error } = await baseQuery
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    const notifications = Array.isArray(data) ? data : [];
    const unreadCount = notifications.filter((n: any) => !n?.is_read).length;

    return jsonResponse(200, {
      success: true,
      unread_count: unreadCount,
      notifications,
    }, req.headers.get("Origin"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    const lowered = msg.toLowerCase();
    if (lowered.includes("forbidden")) return jsonResponse(403, { error: "Forbidden" }, req.headers.get("Origin"));
    if (lowered.includes("jwt") || lowered.includes("jws") || lowered.includes("token") || lowered.includes("bearer")) {
      return jsonResponse(401, { error: msg }, req.headers.get("Origin"));
    }
    return jsonResponse(500, { error: msg }, req.headers.get("Origin"));
  }
});
