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
    const [byId, byMemberNumber] = await Promise.all([
      supabase.from("members").select("id").eq("id", selector).maybeSingle(),
      supabase.from("members").select("id").eq("member_number", selector).maybeSingle(),
    ]);

    if (byId.data?.id) {
      return String(byId.data.id);
    }
    if (byId.error && !isInvalidUuidError(byId.error)) {
      throw byId.error;
    }

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
    requireMemberManagementRole(claims.role);

    const body: Record<string, unknown> = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const url = new URL(req.url);

    const selectors = Array.from(
      new Set(
        [
          url.searchParams.get("member_id"),
          body.member_id,
          url.searchParams.get("member_number"),
          body.member_number,
        ]
          .map(normalizeCandidate)
          .filter((v): v is string => v != null),
      ),
    );

    if (selectors.length === 0) {
      return jsonResponse(req, 400, { error: "member_id or member_number is required" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const memberId = await resolveMemberId(supabase, selectors);
    if (!memberId) {
      return jsonResponse(req, 404, { error: "Member not found" });
    }

    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("id, member_number, name, phone_number, email_address, wallet_balance, is_active, status, probation_end_date, created_at")
      .eq("id", memberId)
      .maybeSingle();

    if (memberErr || !member) {
      return jsonResponse(req, 404, { error: "Member not found" });
    }

    const [{ data: cases, error: casesErr }, { data: transactions, error: txErr }] = await Promise.all([
      supabase
        .from("cases")
        .select("id, case_number, case_type, contribution_per_member, expected_amount, actual_amount, is_active, is_finalized, created_at")
        .eq("affected_member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("transactions")
        .select("id, amount, transaction_type, payment_method, mpesa_reference, reference, description, status, created_at, case_id")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(40),
    ]);

    if (casesErr) throw casesErr;
    if (txErr) throw txErr;

    return jsonResponse(req, 200, {
      member,
      cases: cases || [],
      transactions: transactions || [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return jsonResponse(req, msg === "Forbidden" ? 403 : 401, { error: msg });
  }
});
