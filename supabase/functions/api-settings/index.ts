import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { requirePrivilegedRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

const SENSITIVE_FIELDS = new Set([
  "mpesa_consumer_key",
  "mpesa_consumer_secret",
  "mpesa_passkey",
  "mpesa_initiator_password",
]);

function jsonResponse(status: number, payload: Record<string, unknown>, origin?: string | null) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...buildCorsHeaders(origin), "Content-Type": "application/json" },
  });
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

function toPositiveNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const anyErr = error as Record<string, unknown>;
    const msg = String(anyErr.message || anyErr.error || anyErr.details || "").trim();
    if (msg) return msg;
  }
  return "Error";
}

function buildSettingsPayload(input: Record<string, unknown>, existing: Record<string, any> | null) {
  const payload: Record<string, unknown> = {
    registration_fee: Number(input.registration_fee ?? existing?.registration_fee ?? 500),
    renewal_fee: Number(input.renewal_fee ?? existing?.renewal_fee ?? 200),
    penalty_amount: Number(input.penalty_amount ?? existing?.penalty_amount ?? 300),
    paybill_number: toNullableString(input.paybill_number ?? existing?.paybill_number),
    organization_name: String(input.organization_name ?? existing?.organization_name ?? "Welfare Society").trim() || "Welfare Society",
    organization_email: toNullableString(input.organization_email ?? existing?.organization_email),
    organization_phone: toNullableString(input.organization_phone ?? existing?.organization_phone),
    member_id_start: toPositiveNumber(input.member_id_start ?? existing?.member_id_start, 1),
    case_id_start: toPositiveNumber(input.case_id_start ?? existing?.case_id_start, 1),
    mpesa_shortcode: toNullableString(input.mpesa_shortcode ?? existing?.mpesa_shortcode),
    mpesa_initiator_name: toNullableString(input.mpesa_initiator_name ?? existing?.mpesa_initiator_name),
    mpesa_env: String(input.mpesa_env ?? existing?.mpesa_env ?? "sandbox") === "production" ? "production" : "sandbox",
  };

  for (const field of SENSITIVE_FIELDS) {
    const incoming = toNullableString(input[field]);
    if (incoming) {
      payload[field] = incoming;
      continue;
    }
    if (existing && typeof existing[field] !== "undefined") {
      payload[field] = existing[field];
    }
  }

  return payload;
}

function sanitizeSettings(row: Record<string, any>) {
  return {
    id: row.id,
    registration_fee: row.registration_fee,
    renewal_fee: row.renewal_fee,
    penalty_amount: row.penalty_amount,
    paybill_number: row.paybill_number,
    organization_name: row.organization_name,
    organization_email: row.organization_email,
    organization_phone: row.organization_phone,
    member_id_start: row.member_id_start,
    case_id_start: row.case_id_start,
    mpesa_shortcode: row.mpesa_shortcode,
    mpesa_initiator_name: row.mpesa_initiator_name,
    mpesa_env: row.mpesa_env,
    mpesa_consumer_key: null,
    mpesa_consumer_secret: null,
    mpesa_passkey: null,
    mpesa_initiator_password: null,
    has_mpesa_consumer_key: !!row.mpesa_consumer_key,
    has_mpesa_consumer_secret: !!row.mpesa_consumer_secret,
    has_mpesa_passkey: !!row.mpesa_passkey,
    has_mpesa_initiator_password: !!row.mpesa_initiator_password,
  };
}

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const corsHeaders = buildCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!["GET", "POST"].includes(req.method)) {
    return jsonResponse(405, { error: "Method not allowed" }, origin);
  }

  try {
    const claims = await verifyAppJwtFromRequest(req);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const fetchExisting = async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("*")
        .order("id", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as Record<string, any> | null;
    };

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String((body as Record<string, unknown>).action || "get").toLowerCase();

    if (req.method === "GET" || action === "get") {
      const existing = await fetchExisting();
      return jsonResponse(200, {
        settings: existing ? sanitizeSettings(existing) : null,
      }, origin);
    }

    if (action !== "update") {
      return jsonResponse(400, { error: "Unsupported action" }, origin);
    }
    requirePrivilegedRole(claims.role);

    const updateInput = ((body as Record<string, unknown>).settings || {}) as Record<string, unknown>;
    const existing = await fetchExisting();
    const payload = buildSettingsPayload(updateInput, existing);

    if (existing?.id) {
      const { error } = await supabase
        .from("settings")
        .update(payload)
        .eq("id", existing.id);

      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("settings")
        .insert(payload);

      if (error) throw error;
    }

    const saved = await fetchExisting();
    await supabase.from("audit_logs").insert({
      action: "SETTINGS_UPDATE",
      table_name: "settings",
      status: "success",
      user_id: String((claims as any)?.sub || "") || null,
      metadata: {
        actor_role: claims.role || null,
        session_id: (claims as any)?.sid || null,
        updated_at: new Date().toISOString(),
      },
    });

    return jsonResponse(200, {
      success: true,
      settings: saved ? sanitizeSettings(saved) : null,
    }, origin);
  } catch (e) {
    const msg = getErrorMessage(e);
    const status = msg === "Forbidden" ? 403 : msg.toLowerCase().includes("token") ? 401 : 500;
    return jsonResponse(status, { error: msg }, origin);
  }
});
