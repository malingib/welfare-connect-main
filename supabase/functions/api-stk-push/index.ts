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

function firstNonEmpty(...values: Array<unknown>): string {
  for (const value of values) {
    const v = String(value ?? "").trim();
    if (v.length > 0) return v;
  }
  return "";
}

async function parseResponseBody(response: Response): Promise<Record<string, unknown> | null> {
  const rawText = (await response.text().catch(() => "")).trim();
  if (!rawText) return null;

  try {
    return JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    return { raw: rawText };
  }
}

function mpesaErrorMessage(
  fallback: string,
  response: Response,
  payload: Record<string, unknown> | null,
): string {
  const message = firstNonEmpty(
    payload?.errorMessage,
    payload?.error_description,
    payload?.ResponseDescription,
    payload?.raw,
    response.statusText,
  );
  return `${fallback} (${response.status}${message ? `: ${message}` : ""})`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return jsonResponse(req, 405, { error: "Method not allowed" });

  try {
    const claims = await verifyAppJwtFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const role = String(claims.role || "").toLowerCase();
    if (role !== "member") {
      requireFinanceRole(role);
    }

    const memberId =
      role === "member"
        ? String(claims.member_id || claims.sub || "")
        : String(body?.memberId || claims.member_id || "");
    if (!memberId) return jsonResponse(req, 400, { error: "memberId is required" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: settings, error: settingsError } = await supabase
      .from("settings")
      .select("mpesa_consumer_key, mpesa_consumer_secret, mpesa_passkey, mpesa_shortcode, mpesa_env")
      .single();

    if (settingsError) {
      console.warn("settings lookup warning:", settingsError.message);
    }

    // Primary source: settings table. Fallback: Edge secrets.
    const consumerKey = firstNonEmpty(
      settings?.mpesa_consumer_key,
      Deno.env.get("MPESA_CONSUMER_KEY"),
    );
    const consumerSecret = firstNonEmpty(
      settings?.mpesa_consumer_secret,
      Deno.env.get("MPESA_CONSUMER_SECRET"),
    );
    const passkey = firstNonEmpty(
      settings?.mpesa_passkey,
      Deno.env.get("MPESA_PASSKEY"),
    );
    const shortcode = firstNonEmpty(
      settings?.mpesa_shortcode,
      Deno.env.get("MPESA_SHORTCODE"),
      "174379",
    );
    const env = firstNonEmpty(
      settings?.mpesa_env,
      Deno.env.get("MPESA_ENV"),
      "sandbox",
    ).toLowerCase() === "production" ? "production" : "sandbox";

    if (!consumerKey || !consumerSecret || !passkey) {
      return jsonResponse(req, 500, {
        error: "M-Pesa credentials are incomplete (need consumer key, consumer secret, and passkey in settings or Edge secrets)",
      });
    }

    const phone = String(body?.phone || "");
    const amount = Math.floor(Number(body?.amount || 0));
    const accountReference = String(body?.accountReference || `WELFARE-${memberId}`);
    const transactionDesc = String(body?.transactionDesc || "Welfare Society Payment");
    if (!phone || amount <= 0) return jsonResponse(req, 400, { error: "phone and positive amount required" });

    const auth = btoa(`${consumerKey}:${consumerSecret}`);
    const tokenUrl = `${env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke"}/oauth/v1/generate?grant_type=client_credentials&_=${Date.now()}`;
    const tokenResp = await fetch(
      tokenUrl,
      { 
        headers: { Authorization: `Basic ${auth}`, "Cache-Control": "no-cache" },
        cache: "no-store"
      },
    );
    const tokenJson = await parseResponseBody(tokenResp);
    if (!tokenResp.ok) {
      return jsonResponse(req, 502, {
        error: mpesaErrorMessage("Failed to get M-Pesa access token", tokenResp, tokenJson),
      });
    }
    const accessToken = String(tokenJson?.access_token || "");
    if (!accessToken) {
      return jsonResponse(req, 502, { error: "M-Pesa access token response did not include an access token" });
    }

    const ts = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const password = btoa(`${shortcode}${passkey}${ts}`);
    const clean = phone.replace(/\D/g, "");
    const formattedPhone = clean.startsWith("254")
      ? clean
      : clean.startsWith("0")
          ? `254${clean.slice(1)}`
          : clean;

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: formattedPhone,
      PartyB: shortcode,
      PhoneNumber: formattedPhone,
      AccountReference: accountReference,
      TransactionDesc: transactionDesc,
      CallBackURL: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mpesa-callback`,
    };

    const stkResp = await fetch(
      `${env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke"}/mpesa/stkpush/v1/processrequest`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const stkJson = await parseResponseBody(stkResp);
    if (!stkResp.ok) {
      return jsonResponse(req, 502, {
        error: mpesaErrorMessage("STK push failed", stkResp, stkJson),
      });
    }
    if (!stkJson?.CheckoutRequestID) {
      return jsonResponse(req, 502, { error: "M-Pesa STK response did not include a checkout request ID" });
    }

    await supabase.from("transactions").insert({
      member_id: memberId,
      amount,
      transaction_type: "wallet_funding",
      payment_method: "mpesa",
      reference: stkJson.CheckoutRequestID,
      mpesa_reference: stkJson.CheckoutRequestID,
      status: "pending",
      description: transactionDesc,
      metadata: {
        checkout_request_id: stkJson.CheckoutRequestID,
        merchant_request_id: stkJson.MerchantRequestID,
        phone: formattedPhone,
        initiated_at: new Date().toISOString(),
        source: "api-stk-push",
      },
    });

    return jsonResponse(req, 200, stkJson);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Request failed";
    const lower = msg.toLowerCase();

    if (lower.includes("forbidden")) {
      return jsonResponse(req, 403, { error: msg });
    }

    if (
      lower.includes("missing bearer token") ||
      lower.includes("jwt") ||
      lower.includes("unauthorized") ||
      lower.includes("signature verification") ||
      lower.includes("verification failed")
    ) {
      return jsonResponse(req, 401, { error: msg });
    }

    return jsonResponse(req, 500, { error: msg });
  }
});
