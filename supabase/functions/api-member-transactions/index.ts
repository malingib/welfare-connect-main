import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtVerify } from "https://esm.sh/jose@5.9.6";
import { corsFor } from "../_shared/cors.ts";
const FINANCE_ROLES = new Set(["super_admin", "treasurer"]);

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

async function verifyToken(req: Request) {
  const appTokenHeader = req.headers.get("x-app-token") || "";
  if (appTokenHeader) {
    const appJwtSecret = Deno.env.get("APP_JWT_SECRET");
    if (!appJwtSecret) throw new Error("APP_JWT_SECRET is not configured");
    const verified = await jwtVerify(appTokenHeader, new TextEncoder().encode(appJwtSecret));
    return verified.payload as { role?: string; member_id?: string; sub?: string; member_number?: string };
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) throw new Error("Missing bearer token");

  const appJwtSecret = Deno.env.get("APP_JWT_SECRET");
  if (!appJwtSecret) throw new Error("APP_JWT_SECRET is not configured");

  const verified = await jwtVerify(token, new TextEncoder().encode(appJwtSecret));
  return verified.payload as { role?: string; member_id?: string; sub?: string; member_number?: string };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsFor(req) });
  }

  if (!["GET", "POST"].includes(req.method)) {
    return jsonResponse(req, 405, { error: "Method not allowed" });
  }

  try {
    const claims = await verifyToken(req);
    const role = String(claims.role || "").toLowerCase();
    if (role !== "member" && !FINANCE_ROLES.has(role)) {
      throw new Error("Forbidden");
    }
    const url = new URL(req.url);
    const body: Record<string, unknown> = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const requestedMemberId = normalizeCandidate(url.searchParams.get("member_id") ?? body["member_id"]);
    const selectors = Array.from(
      new Set(
        (role === "member"
          ? [claims.member_id, claims.sub, claims.member_number, requestedMemberId]
          : [requestedMemberId, claims.member_id, claims.sub])
          .map(normalizeCandidate)
          .filter((v): v is string => v != null),
      ),
    );

    if (selectors.length === 0) {
      return jsonResponse(req, 400, { error: "member_id is required" });
    }

    const page = Math.max(Number(url.searchParams.get("page") || body["page"] || 1), 1);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get("page_size") || body["page_size"] || 20), 1), 100);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const resolvedMemberId = await resolveMemberId(supabase, selectors);
    if (!resolvedMemberId) {
      return jsonResponse(req, 404, { error: "Member not found" });
    }

    const { data, error, count } = await supabase
      .from("transactions")
      .select("id, member_id, case_id, amount, transaction_type, payment_method, mpesa_reference, reference, description, status, created_at", { count: "exact" })
      .eq("member_id", resolvedMemberId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw error;
    }

    return jsonResponse(req, 200, {
      page,
      page_size: pageSize,
      total: count || 0,
      has_more: (count || 0) > to + 1,
      transactions: data || [],
    });
  } catch (error) {
    console.error("api-member-transactions error:", error);
    const msg = error instanceof Error ? error.message : "Unauthorized or invalid request";
    if (msg === "Forbidden") return jsonResponse(req, 403, { error: msg });
    return jsonResponse(req, 401, { error: "Unauthorized or invalid request" });
  }
});
