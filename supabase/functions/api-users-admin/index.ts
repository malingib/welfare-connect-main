import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import bcryptjs from "https://esm.sh/bcryptjs@2.4.3";

import { corsFor } from "../_shared/cors.ts";
import { requireSuperAdminRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

type Json = Record<string, unknown>;

const ALLOWED_ROLES = new Set(["super_admin", "chairperson", "treasurer", "secretary", "member"]);

function jsonResponse(req: Request, status: number, payload: Json) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsFor(req), "Content-Type": "application/json" },
  });
}

function normalizeRole(role: unknown): string {
  return String(role || "").trim().toLowerCase();
}

function normalizeUsername(username: unknown): string {
  return String(username || "").trim().toLowerCase();
}

function nestedAudit(
  supabase: ReturnType<typeof createClient>,
  claims: { sub?: string; role?: string; sid?: string },
  action: string,
  metadata: Record<string, unknown>,
) {
  return supabase.from("audit_logs").insert({
    action,
    table_name: "users",
    user_id: String(claims.sub || "") || null,
    status: "success",
    metadata: { ...metadata, session_id: claims.sid || null },
  });
}

function randomPassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => chars[b % chars.length]).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return jsonResponse(req, 405, { error: "Method not allowed" });

  try {
    const claims = await verifyAppJwtFromRequest(req);
    requireSuperAdminRole(claims.role);

    const body = await req.json().catch(() => ({})) as Json;
    const action = String(body.action || "").trim().toLowerCase();

    if (!action) return jsonResponse(req, 400, { error: "action is required" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    if (action === "list") {
      const { data, error } = await supabase
        .from("users")
        .select("id, username, name, email, role, member_id, is_active, created_at, updated_at")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return jsonResponse(req, 200, { users: data || [] });
    }

    if (action === "update_status") {
      const userId = String(body.user_id || "").trim();
      const isActive = body.is_active;

      if (!userId || typeof isActive !== "boolean") {
        return jsonResponse(req, 400, { error: "user_id and boolean is_active are required" });
      }

      if (String(claims.sub || "") === userId && isActive === false) {
        return jsonResponse(req, 400, { error: "You cannot deactivate your own account" });
      }

      const { error } = await supabase
        .from("users")
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq("id", userId);

      if (error) throw error;
      try {
        await nestedAudit(supabase, claims, "USER_STATUS_UPDATE", { target_user_id: userId, is_active: isActive });
      } catch { /* audit must not block admin action */ }
      return jsonResponse(req, 200, { success: true });
    }

    if (action === "update_role") {
      const userId = String(body.user_id || "").trim();
      const role = normalizeRole(body.role);

      if (!userId || !ALLOWED_ROLES.has(role)) {
        return jsonResponse(req, 400, { error: "Valid user_id and role are required" });
      }

      if (String(claims.sub || "") === userId && role !== "super_admin") {
        return jsonResponse(req, 400, { error: "You cannot downgrade your own role" });
      }

      const { error } = await supabase
        .from("users")
        .update({ role, updated_at: new Date().toISOString() })
        .eq("id", userId);

      if (error) throw error;
      try {
        await nestedAudit(supabase, claims, "USER_ROLE_UPDATE", { target_user_id: userId, role });
      } catch { /* audit must not block admin action */ }
      return jsonResponse(req, 200, { success: true });
    }

    if (action === "reset_password") {
      const userId = String(body.user_id || "").trim();
      if (!userId) return jsonResponse(req, 400, { error: "user_id is required" });

      const incoming = String(body.new_password || "").trim();
      const nextPassword = incoming || randomPassword(12);
      if (nextPassword.length < 6) {
        return jsonResponse(req, 400, { error: "new_password must be at least 6 characters" });
      }

      const passwordHash = await bcryptjs.hash(nextPassword, 12);
      const { error } = await supabase
        .from("users")
        .update({ password: passwordHash, updated_at: new Date().toISOString() })
        .eq("id", userId);

      if (error) throw error;

      try {
        await nestedAudit(supabase, claims, "USER_PASSWORD_RESET", { target_user_id: userId });
      } catch { /* audit must not block admin action */ }
      return jsonResponse(req, 200, {
        success: true,
        temporary_password: incoming ? null : nextPassword,
      });
    }

    if (action === "create") {
      const username = normalizeUsername(body.username);
      const role = normalizeRole(body.role || "member");
      const name = String(body.name || "").trim();
      const password = String(body.password || "");
      const email = String(body.email || "").trim() || null;
      const memberId = String(body.member_id || "").trim() || null;
      const isActive = body.is_active === false ? false : true;

      if (!username || !password || password.length < 6 || !name) {
        return jsonResponse(req, 400, { error: "username, name, and password (min 6 chars) are required" });
      }
      if (!ALLOWED_ROLES.has(role)) {
        return jsonResponse(req, 400, { error: "Invalid role" });
      }

      const { data: existing, error: checkError } = await supabase
        .from("users")
        .select("id")
        .ilike("username", username)
        .limit(1);

      if (checkError) throw checkError;
      if ((existing || []).length > 0) {
        return jsonResponse(req, 409, { error: "Username already exists" });
      }

      const passwordHash = await bcryptjs.hash(password, 12);
      const insertPayload: Json = {
        username,
        name,
        password: passwordHash,
        role,
        is_active: isActive,
        email,
      };
      if (memberId) insertPayload.member_id = memberId;

      const { data, error } = await supabase
        .from("users")
        .insert(insertPayload)
        .select("id, username, name, email, role, member_id, is_active")
        .single();

      if (error) throw error;

      try {
        await nestedAudit(supabase, claims, "USER_CREATE", {
          target_user_id: (data as Record<string, unknown>)?.id || null,
          username: (data as Record<string, unknown>)?.username || null,
          role: (data as Record<string, unknown>)?.role || null,
        });
      } catch { /* audit must not block admin action */ }
      return jsonResponse(req, 200, {
        success: true,
        user: data,
      });
    }

    if (action === "delete_member_links") {
      const memberId = String(body.member_id || "").trim();
      if (!memberId) return jsonResponse(req, 400, { error: "member_id is required" });

      const { data: usersData, error: usersError } = await supabase
        .from("users")
        .select("id")
        .eq("member_id", memberId);

      if (usersError) throw usersError;

      const userIds = (usersData || []).map((u) => u.id);
      if (userIds.length > 0) {
        const { error: credsError } = await supabase
          .from("user_credentials")
          .delete()
          .in("user_id", userIds);
        if (credsError) throw credsError;

        const { error: deleteUsersError } = await supabase
          .from("users")
          .delete()
          .in("id", userIds);
        if (deleteUsersError) throw deleteUsersError;
      }

      try {
        await nestedAudit(supabase, claims, "USER_DELETE_MEMBER_LINKS", {
          member_id: memberId,
          deleted_user_count: userIds.length,
        });
      } catch { /* audit must not block admin action */ }
      return jsonResponse(req, 200, { success: true, deleted_user_count: userIds.length });
    }

    return jsonResponse(req, 400, { error: "Unsupported action" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    const status = msg === "Forbidden" ? 403 : msg.toLowerCase().includes("token") ? 401 : 500;
    return jsonResponse(req, status, { error: msg });
  }
});
