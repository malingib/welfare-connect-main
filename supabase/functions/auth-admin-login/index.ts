import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import bcryptjs from "https://esm.sh/bcryptjs@2.4.3";
import { SignJWT } from "https://esm.sh/jose@5.9.6";
import { buildCorsHeaders } from "../_shared/cors.ts";

const ADMIN_ROLES = new Set(["super_admin", "chairperson", "treasurer", "secretary"]);

function jsonResponse(status: number, payload: Record<string, unknown>, origin?: string | null) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...buildCorsHeaders(origin), "Content-Type": "application/json" },
  });
}

function normalizeRole(role: unknown): string {
  return String(role || "").toLowerCase().trim();
}

serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, origin);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const appJwtSecret = Deno.env.get("APP_JWT_SECRET");
    if (!appJwtSecret) {
      return jsonResponse(500, { error: "Server auth secret not configured" }, origin);
    }

    const { username, password } = await req.json();
    if (!username || !password) {
      return jsonResponse(400, { error: "Username and password are required" }, origin);
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, username, name, email, password, role, member_id, is_active")
      .eq("username", String(username))
      .maybeSingle();

    if (userError || !user) {
      return jsonResponse(401, { error: "Invalid credentials" }, origin);
    }

    if (!user.is_active) {
      return jsonResponse(403, { error: "Account is inactive" }, origin);
    }

    const role = normalizeRole(user.role);
    if (!ADMIN_ROLES.has(role)) {
      return jsonResponse(403, { error: "This account is not allowed in admin login" }, origin);
    }

    const storedPassword = String(user.password || "");
    // Only bcrypt hashes are accepted. Legacy plaintext comparison has been
    // removed. Any account still storing a non-bcrypt password must be
    // re-hashed (see README migration snippet) before it can log in.
    if (!storedPassword.startsWith("$2")) {
      await supabase.from("audit_logs").insert({
        action: "LOGIN_BLOCKED_UNHASHED_PASSWORD",
        table_name: "users",
        record_id: user.id,
        user_id: user.id,
        status: "failed",
      }).throwOnError();
      return jsonResponse(403, {
        error: "Password reset required. Contact an administrator.",
      }, origin);
    }
    const passwordValid = await bcryptjs.compare(String(password), storedPassword);

    if (!passwordValid) {
      await supabase.from("audit_logs").insert({
        action: "LOGIN_FAILED",
        table_name: "users",
        record_id: user.id,
        user_id: user.id,
        status: "failed",
      }).throwOnError();

      return jsonResponse(401, { error: "Invalid credentials" }, origin);
    }

    const sessionId = crypto.randomUUID();
    const token = await new SignJWT({
      role,
      member_id: user.member_id ?? null,
      sid: sessionId,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(new TextEncoder().encode(appJwtSecret));

    await supabase.from("audit_logs").insert({
      action: "LOGIN",
      table_name: "users",
      record_id: user.id,
      user_id: user.id,
      status: "success",
      metadata: { session_id: sessionId },
    }).throwOnError();

    return jsonResponse(200, {
      app_token: token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        member_id: user.member_id,
        is_active: user.is_active,
      },
    }, origin);
  } catch (error) {
    console.error("auth-admin-login error:", error);
    return jsonResponse(500, { error: "Internal server error" }, origin);
  }
});
