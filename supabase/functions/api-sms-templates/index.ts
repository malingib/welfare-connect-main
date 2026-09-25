import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requirePrivilegedRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const corsHeaders = buildCorsHeaders(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const method = req.method;

  // GET — list all templates (no auth required, templates are public)
  if (method === "GET") {
    const { data, error } = await supabase
      .from("sms_templates")
      .select("trigger_key, label, description, category, raw_template, is_active, updated_at")
      .order("category")
      .order("label");

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ templates: data || [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // POST — list templates (no auth) or update a single template (requires admin auth + trigger_key)
  if (method === "POST") {
    const body = await req.json().catch(() => ({}));
    const triggerKey = String(body.trigger_key || "").trim();

    // No trigger_key → list all templates (read-only, no auth needed)
    if (!triggerKey) {
      const { data, error } = await supabase
        .from("sms_templates")
        .select("trigger_key, label, description, category, raw_template, is_active, updated_at")
        .order("category")
        .order("label");

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ templates: data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Has trigger_key → update (requires admin auth)
    try {
      const claims = await verifyAppJwtFromRequest(req);
      requirePrivilegedRole(claims.role);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unauthorized";
      return new Response(JSON.stringify({ error: msg }), {
        status: msg === "Forbidden" ? 403 : 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const updates: Record<string, unknown> = {};
    if (body.label !== undefined) updates.label = String(body.label).trim();
    if (body.description !== undefined) updates.description = String(body.description).trim();
    if (body.raw_template !== undefined) updates.raw_template = String(body.raw_template).trim();
    if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);

    if (Object.keys(updates).length === 0) {
      return new Response(JSON.stringify({ error: "No fields to update" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("sms_templates")
      .update(updates)
      .eq("trigger_key", triggerKey)
      .select("trigger_key, label, description, category, raw_template, is_active, updated_at")
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ template: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
