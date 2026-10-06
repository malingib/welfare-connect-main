import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requirePrivilegedRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";
import { sendSmsMessage } from "../_shared/sms.ts";

const originHeaders = (origin: string | null) => buildCorsHeaders(origin);
const normalizePhone = (value: unknown) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("7")) return `254${digits}`;
  return digits;
};

async function nextMemberNumber(supabase: ReturnType<typeof createClient>) {
  const [{ data: settings }, { data: members }, { data: reservedApplications }] = await Promise.all([
    supabase.from("settings").select("member_id_start").limit(1).maybeSingle(),
    supabase.from("members").select("member_number"),
    supabase.from("membership_applications").select("payment_reference").in("status", ["payment_pending", "activated"]),
  ]);
  const start = Math.max(Number(settings?.member_id_start || 1), 1);
  const highest = [...(members || []).map((member) => member.member_number), ...(reservedApplications || []).map((application) => application.payment_reference)].reduce((max, value) => {
    const raw = String(value || "").trim();
    if (!/^\d+$/.test(raw)) return max;
    return Math.max(max, Number(raw));
  }, start - 1);
  return String(highest + 1);
}

function response(origin: string | null, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: { ...originHeaders(origin), "Content-Type": "application/json" } });
}

async function notifyApplicant(phone: string, message: string) {
  try { await sendSmsMessage([phone], message); } catch (error) { console.error("application SMS failed", error); }
}

serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: originHeaders(origin) });
  if (req.method !== "POST") return response(origin, 405, { error: "Method not allowed" });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "submit").trim().toLowerCase();
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  try {
    if (action === "submit") {
      const phone = normalizePhone(body.phone_number);
      const dob = String(body.date_of_birth || "").trim();
      const age = dob ? Math.floor((Date.now() - new Date(dob).getTime()) / 31557600000) : -1;
      if (!body.full_name || !body.national_id_number || !dob || !phone || !body.next_of_kin || body.declaration_accepted !== true) {
        return response(origin, 400, { error: "Complete all required fields and accept the declaration." });
      }
      if (!/^254(7|1)\d{8}$/.test(phone)) return response(origin, 400, { error: "Enter a valid Kenyan mobile number." });
      if (age < 18) return response(origin, 400, { error: "Applicant must be at least 18 years old." });
      if (age > 75) return response(origin, 400, { error: "Applicants above 75 years are not eligible for admission." });
      if (body.residence_status === "resident" && !body.village) return response(origin, 400, { error: "Select a Malanga village." });
      if (body.residence_status === "non_resident" && !body.current_location) return response(origin, 400, { error: "Enter your current residence/location." });

      const { data: existing } = await supabase.from("membership_applications")
        .select("id, status").eq("national_id_number", String(body.national_id_number).trim()).in("status", ["pending_review", "approved", "payment_pending"]).maybeSingle();
      if (existing) return response(origin, 409, { error: "An application for this National ID is already under review or awaiting payment." });

      const reference = `APP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const { data: application, error } = await supabase.from("membership_applications").insert({
        application_reference: reference,
        full_name: String(body.full_name).trim(), national_id_number: String(body.national_id_number).trim(),
        date_of_birth: dob, gender: String(body.gender || "").trim(), phone_number: phone,
        alternative_phone_number: body.alternative_phone_number ? normalizePhone(body.alternative_phone_number) : null,
        email_address: body.email_address || null, residence_status: body.residence_status,
        village: body.village || null, current_location: body.current_location || null,
        dependants: Array.isArray(body.dependants) ? body.dependants : [], next_of_kin: body.next_of_kin,
        declaration_accepted: true, status: "pending_review", payment_status: "not_required",
      }).select("id, application_reference, status, application_date").single();
      if (error) throw error;

      await notifyApplicant(phone, `Malanga Welfare: Application ${reference} received successfully and is awaiting Welfare Committee review.`);
      await supabase.from("notifications").insert({ role: "admin", title: "New Membership Application", message: `New membership application ${reference} is awaiting review.`, category: "registration_submitted", data: { application_id: application.id, application_reference: reference } });
      return response(origin, 200, { success: true, application });
    }

    const claims = await verifyAppJwtFromRequest(req);
    requirePrivilegedRole(claims.role);

    if (action === "list") {
      const { data, error } = await supabase.from("membership_applications").select("*").order("application_date", { ascending: false }).limit(500);
      if (error) throw error;
      return response(origin, 200, { applications: data || [] });
    }

    if (action === "review") {
      const id = String(body.application_id || "").trim();
      const decision = String(body.decision || "").trim().toLowerCase();
      if (!id || !["approve", "reject"].includes(decision)) return response(origin, 400, { error: "application_id and approve/reject decision are required" });
      const { data: application, error: loadError } = await supabase.from("membership_applications").select("*").eq("id", id).single();
      if (loadError || !application) return response(origin, 404, { error: "Application not found" });
      const approved = decision === "approve";
      const { data: settings } = await supabase.from("settings").select("registration_fee, paybill_number, mpesa_shortcode").limit(1).maybeSingle();
      const paymentReference = approved ? await nextMemberNumber(supabase) : null;
      const paybill = String(settings?.paybill_number || settings?.mpesa_shortcode || "").trim() || "not configured";
      const registrationFee = Number(settings?.registration_fee || 0);
      const update = { status: approved ? "payment_pending" : "rejected", payment_status: approved ? "pending" : "not_required", payment_reference: paymentReference, reviewed_at: new Date().toISOString(), reviewed_by: String(claims.sub || ""), review_reason: String(body.reason || "").trim() || null, updated_at: new Date().toISOString() };
      const { data: updated, error } = await supabase.from("membership_applications").update(update).eq("id", id).select("*").single();
      if (error) throw error;
      const message = approved
        ? `Malanga Welfare: Application approved. Pay KES ${registrationFee} via Paybill ${paybill}, Account ${paymentReference}.`
        : `Malanga Welfare: Your membership application was not approved. ${update.review_reason || "Please contact the Welfare Committee."}`;
      await notifyApplicant(application.phone_number, message);
      await supabase.from("notifications").insert({ role: "admin", title: approved ? "Application Approved" : "Application Rejected", message: `${application.application_reference} was ${approved ? "approved" : "rejected"}.`, category: approved ? "registration_approved" : "registration_rejected", data: { application_id: id } });
      return response(origin, 200, { success: true, application: updated });
    }

    if (action === "confirm_payment") {
      const id = String(body.application_id || "").trim();
      const { data: application, error: loadError } = await supabase.from("membership_applications").select("*").eq("id", id).single();
      if (loadError || !application) return response(origin, 404, { error: "Application not found" });
      if (application.status !== "payment_pending") return response(origin, 400, { error: "Application is not awaiting payment" });
      const { data: settings } = await supabase.from("settings").select("registration_fee").limit(1).maybeSingle();
      const age = Math.floor((Date.now() - new Date(application.date_of_birth).getTime()) / 31557600000);
      const probationEnd = new Date(Date.now() + (age <= 50 ? 90 : 180) * 86400000).toISOString().slice(0, 10);
      const memberNumber = String(application.payment_reference || await nextMemberNumber(supabase));
      const { data: memberResult, error: memberError } = await supabase.rpc("insert_member", {
        p_member_number: memberNumber, p_name: application.full_name, p_gender: application.gender,
        p_date_of_birth: application.date_of_birth, p_national_id_number: application.national_id_number,
        p_phone_number: application.phone_number, p_email_address: application.email_address,
        p_residence: application.residence_status === "resident" ? application.village : application.current_location,
        p_next_of_kin: application.next_of_kin, p_wallet_balance: 0, p_is_active: true,
        p_registration_date: new Date().toISOString().slice(0, 10), p_dependants: application.dependants,
        p_pin: null, p_registration_fee: Number(settings?.registration_fee || 0), p_fee_paid: true,
      });
      if (memberError || !memberResult?.success) throw memberError || new Error(memberResult?.message || "Member activation failed");
      await supabase.from("members").update({ status: "probation", is_active: true, probation_end_date: probationEnd, dependants: application.dependants, updated_at: new Date().toISOString() }).eq("id", memberResult.id);
      const { data: updated, error } = await supabase.from("membership_applications").update({ status: "activated", payment_status: "verified", activated_member_id: memberResult.id, activated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
      if (error) throw error;
      await notifyApplicant(application.phone_number, `Malanga Welfare: Payment confirmed. You are now a member. Membership Number: ${memberNumber}. Probation ends ${probationEnd}.`);
      return response(origin, 200, { success: true, application: updated, member_number: memberNumber, probation_end_date: probationEnd });
    }

    return response(origin, 400, { error: "Unsupported action" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return response(origin, message === "Forbidden" ? 403 : 500, { error: message });
  }
});
