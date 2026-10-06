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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return jsonResponse(req, 405, { error: "Method not allowed" });

  try {
    const claims = await verifyAppJwtFromRequest(req);
    requirePrivilegedRole(claims.role);

    const body = await req.json().catch(() => ({}));
    const memberId = String(body?.member_id || "").trim();
    const feeType = String(body?.fee_type || "").trim().toLowerCase();
    const amount = Number(body?.amount || 0);
    const reference = body?.reference == null ? null : String(body.reference);
    const description = body?.description == null ? null : String(body.description);

    if (!memberId) return jsonResponse(req, 400, { error: "member_id is required" });
    if (!["registration", "renewal", "penalty"].includes(feeType)) {
      return jsonResponse(req, 400, { error: "fee_type must be one of registration/renewal/penalty" });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonResponse(req, 400, { error: "amount must be greater than zero" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data, error } = await supabase.rpc("collect_member_fee", {
      p_member_id: memberId,
      p_fee_type: feeType,
      p_amount: amount,
      p_reference: reference,
      p_description: description,
      p_actor: claims?.sub ? String(claims.sub) : null,
    });

    if (error) throw error;

    return jsonResponse(req, 200, {
      success: true,
      result: data || null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    const status = msg === "Forbidden" ? 403 : msg.toLowerCase().includes("token") ? 401 : 500;
    return jsonResponse(req, status, { error: msg });
  }
});

