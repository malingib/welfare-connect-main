import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requirePrivilegedRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

function response(origin: string | null, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...buildCorsHeaders(origin), "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(origin) });
  if (req.method !== "POST") return response(origin, 405, { error: "Method not allowed" });

  try {
    const claims = await verifyAppJwtFromRequest(req);
    requirePrivilegedRole(claims.role);

    const body = await req.json().catch(() => ({}));
    const memberId = String(body.member_id || "").trim();
    if (!memberId) return response(origin, 400, { error: "member_id is required" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Keep the same deletion safeguards as the existing database routine.
    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id, wallet_balance")
      .eq("id", memberId)
      .single();
    if (memberError || !member) return response(origin, 404, { error: "Member not found" });

    if (Number(member.wallet_balance || 0) !== 0) {
      return response(origin, 400, {
        success: false,
        message: "Cannot delete member with non-zero balance. Please settle or transfer funds first.",
      });
    }

    const { count: caseCount, error: caseError } = await supabase
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("affected_member_id", memberId);
    if (caseError) throw caseError;

    if ((caseCount || 0) > 0) {
      const { error: inactiveError } = await supabase
        .from("members")
        .update({ is_active: false, status: "inactive" })
        .eq("id", memberId);
      if (inactiveError) throw inactiveError;
      return response(origin, 200, {
        success: true,
        message: "Member has associated cases. Marked as inactive instead of deleting.",
      });
    }

    // Remove dependent records that use restrictive foreign keys before the
    // member row. This is required for members with historical transactions
    // or a linked member login account.
    const { data: linkedUsers, error: linkedUsersError } = await supabase
      .from("users")
      .select("id")
      .eq("member_id", memberId);
    if (linkedUsersError) throw linkedUsersError;

    const linkedUserIds = (linkedUsers || []).map((user) => String(user.id)).filter(Boolean);
    if (linkedUserIds.length) {
      const { error: credentialsError } = await supabase
        .from("user_credentials")
        .delete()
        .in("user_id", linkedUserIds);
      if (credentialsError) throw credentialsError;

      const { error: usersError } = await supabase
        .from("users")
        .delete()
        .in("id", linkedUserIds);
      if (usersError) throw usersError;
    }

    const { error: transactionsError } = await supabase
      .from("transactions")
      .delete()
      .eq("member_id", memberId);
    if (transactionsError) throw transactionsError;

    const { error: dependantsError } = await supabase
      .from("dependants")
      .delete()
      .eq("member_id", memberId);
    if (dependantsError) throw dependantsError;

    const { error: deleteError } = await supabase.from("members").delete().eq("id", memberId);
    if (deleteError) throw deleteError;
    return response(origin, 200, { success: true, message: "Member deleted successfully" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return response(origin, message === "Forbidden" ? 403 : 500, { error: message });
  }
});
