import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsFor } from "../_shared/cors.ts";
import { verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsFor(req), "Content-Type": "application/json" },
    });
  }

  try {
    const claims = await verifyAppJwtFromRequest(req);
    const body = await req.json();
    const notificationId = String(body.notification_id || "").trim();
    const markAll = Boolean(body.mark_all);

    if (!notificationId && !markAll) {
      return new Response(JSON.stringify({ error: "Provide notification_id or mark_all=true" }), {
        status: 400,
        headers: { ...corsFor(req), "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const now = new Date().toISOString();
    const query = supabase.from("notifications").update({ is_read: true, read_at: now });

    if (notificationId) {
      query.eq("id", notificationId);
    } else if (markAll) {
      if (claims.member_id) {
        query.eq("member_id", claims.member_id);
      } else if (claims.sub) {
        query.eq("user_id", claims.sub);
      } else {
        query.eq("role", claims.role || "member");
      }
      query.eq("is_read", false);
    }

    const { error } = await query;
    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsFor(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsFor(req), "Content-Type": "application/json" },
    });
  }
});
