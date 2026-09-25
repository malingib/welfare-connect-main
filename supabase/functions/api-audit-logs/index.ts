import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { requirePrivilegedRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";

function jsonResponse(status: number, payload: Record<string, unknown>, origin?: string | null) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...buildCorsHeaders(origin), "Content-Type": "application/json" },
  });
}

const AUDIT_LOG_COLUMNS =
  "id, user_id, member_id, action, table_name, record_id, status, metadata, timestamp, created_at";

serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" }, origin);

  try {
    const claims = await verifyAppJwtFromRequest(req);
    requirePrivilegedRole(claims.role);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(500, Math.max(1, Number(body.limit || 100) || 100));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data, error } = await supabase
      .from("audit_logs")
      .select(AUDIT_LOG_COLUMNS)
      .order("timestamp", { ascending: false })
      .limit(limit);

    if (error) throw error;

    const logs = (data || []) as Record<string, unknown>[];
    const isUuid = (v: unknown) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ""));

    // Performer (who did it): explicit user_id, else the LOGIN record itself.
    // Subject (who it was done to): explicit member_id, else members record / metadata.
    const performerUserIds = new Set<string>();
    const subjectMemberIds = new Set<string>();
    for (const r of logs) {
      const table = String(r.table_name || "");
      const recordId = String(r.record_id || "");
      const action = String(r.action || "");
      const meta = (r.metadata || {}) as Record<string, unknown>;
      const userId = String(r.user_id || "");
      if (userId) performerUserIds.add(userId);
      if (action.startsWith("LOGIN") && table === "users" && isUuid(recordId)) {
        performerUserIds.add(recordId);
      }
      const memberId = String(r.member_id || "");
      if (memberId) subjectMemberIds.add(memberId);
      if (table === "members" && isUuid(recordId)) subjectMemberIds.add(recordId);
      const metaMember = String(meta.member_id || "");
      if (isUuid(metaMember)) subjectMemberIds.add(metaMember);
    }

    const userLookup = new Map<string, { username: string; name: string; role: string }>();
    for (let i = 0; i < Array.from(performerUserIds).length; i += 120) {
      const chunk = Array.from(performerUserIds).slice(i, i + 120);
      const { data: users, error: usersErr } = await supabase
        .from("users")
        .select("id, username, name, role")
        .in("id", chunk);
      if (usersErr) throw usersErr;
      for (const u of (users || []) as Record<string, string>[]) {
        userLookup.set(String(u.id), {
          username: String(u.username || ""),
          name: String(u.name || ""),
          role: String(u.role || ""),
        });
      }
    }

    const memberLookup = new Map<string, { member_number: string; name: string }>();
    for (let i = 0; i < Array.from(subjectMemberIds).length; i += 120) {
      const chunk = Array.from(subjectMemberIds).slice(i, i + 120);
      const { data: members, error: membersErr } = await supabase
        .from("members")
        .select("id, member_number, name")
        .in("id", chunk);
      if (membersErr) throw membersErr;
      for (const m of (members || []) as Record<string, string>[]) {
        memberLookup.set(String(m.id), {
          member_number: String(m.member_number || ""),
          name: String(m.name || ""),
        });
      }
    }

    const enriched = logs.map((row) => {
      const table = String(row.table_name || "");
      const recordId = String(row.record_id || "");
      const action = String(row.action || "");
      const meta = (row.metadata || {}) as Record<string, unknown>;
      const userId = String(row.user_id || "");
      let performer = userId ? userLookup.get(userId) : undefined;
      if (!performer && action.startsWith("LOGIN") && table === "users" && isUuid(recordId)) {
        performer = userLookup.get(recordId);
      }
      let performerMember: { member_number: string; name: string } | undefined;
      if (!performer && action.startsWith("LOGIN") && table === "members" && isUuid(recordId)) {
        performerMember = memberLookup.get(recordId);
      }
      const subjectId =
        String(row.member_id || "") ||
        (table === "members" && isUuid(recordId) ? recordId : "") ||
        (isUuid(String(meta.member_id || "")) ? String(meta.member_id) : "");
      const subject = subjectId ? memberLookup.get(subjectId) : undefined;
      const role = String(meta.performed_by_role || meta.actor_role || "");
      const subjectLabel = subject
        ? `${subject.name || "Member"}${subject.member_number ? ` (#${subject.member_number})` : ""}`
        : null;
      if (performer) {
        return {
          ...row,
          actor_kind: "user",
          actor_name: performer.name || performer.username || "Unknown user",
          actor_detail: [performer.username ? `@${performer.username}` : null, performer.role || null]
            .filter(Boolean)
            .join(" · "),
          subject_label: subjectLabel,
          member_number: subject?.member_number || null,
          member_name: subject?.name || null,
        };
      }
      if (performerMember) {
        return {
          ...row,
          actor_kind: "member",
          actor_name: performerMember.name || "Unknown member",
          actor_detail: performerMember.member_number ? `#${performerMember.member_number}` : null,
          subject_label: null,
          member_number: performerMember.member_number || null,
          member_name: performerMember.name || null,
        };
      }
      return {
        ...row,
        actor_kind: "system",
        actor_name: "System",
        actor_detail: role ? `by ${role}` : "automated",
        subject_label: subjectLabel,
        member_number: subject?.member_number || null,
        member_name: subject?.name || null,
      };
    });

    const withSession = enriched.map((row) => ({
      ...row,
      session_id: String(((row.metadata || {}) as Record<string, unknown>).session_id || "") || null,
    }));

    return jsonResponse(200, { logs: withSession }, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Forbidden" ? 403 : 500;
    return jsonResponse(status, { error: message }, origin);
  }
});
