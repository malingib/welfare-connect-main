import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsFor } from "../_shared/cors.ts";
import { requirePrivilegedRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

function jsonResponse(req: Request, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsFor(req), "Content-Type": "application/json" },
  });
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizePhone(phone: unknown): string | null {
  const p = normalizeString(phone);
  if (!p) return null;
  const digits = p.replaceAll(/\D/g, "");
  if (digits.length < 9) return null;
  return digits.startsWith("254") ? p : `254${digits}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return jsonResponse(req, 405, { error: "Method not allowed" });

  try {
    const claims = await verifyAppJwtFromRequest(req);
    requirePrivilegedRole(claims.role);

    const body: Record<string, unknown> = await req.json().catch(() => ({}));
    const members: unknown[] = Array.isArray(body.members) ? body.members : [];

    if (members.length === 0) {
      return jsonResponse(req, 400, { error: "No members provided" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: settings } = await supabase
      .from("settings")
      .select("member_id_start, case_id_start")
      .limit(1)
      .single();

    const results = {
      processed: 0,
      created: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const m of members) {
      if (!(m && typeof m === "object")) {
        results.skipmed++;
        continue;
      }

      const member = m as Record<string, unknown>;
      const name = normalizeString(member.name);
      const phone = normalizePhone(member.phone_number);
      const email = normalizeString(member.email);
      const residence = normalizeString(member.residence);

      if (!name || !phone) {
        results.errors.push(`Row skipped: missing name or phone`);
        results.skipped++;
        continue;
      }

      try {
        const existingCount = await supabase
          .from("members")
          .select("id", { count: "exact", head: true })
          .eq("phone_number", phone);

        if (existingCount.count && existingCount.count > 0) {
          results.skipped++;
          continue;
        }

        const { error: insertErr } = await supabase.from("members").insert({
          name,
          phone_number: phone,
          email_address: email || null,
          residence: residence || null,
        });

        if (insertErr) throw insertErr;
        results.created++;
      } catch (e) {
        results.errors.push(`Failed to create ${name}: ${e instanceof Error ? e.message : "Unknown error"}`);
      }
      results.processed++;
    }

    return jsonResponse(req, 200, results);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return jsonResponse(req, msg === "Forbidden" ? 403 : 401, { error: msg });
  }
});