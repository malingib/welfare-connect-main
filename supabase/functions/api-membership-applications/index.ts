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

function renderTemplate(template: string, values: Record<string, unknown>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

async function notifyApplicant(
  supabase: ReturnType<typeof createClient>,
  phone: string,
  triggerKey: string,
  fallback: string,
  values: Record<string, unknown> = {},
) {
  try {
    const { data: template } = await supabase
      .from("sms_templates")
      .select("raw_template")
      .eq("trigger_key", triggerKey)
      .maybeSingle();
    const rawTemplate = String((template as { raw_template?: unknown } | null)?.raw_template || "").trim();
    await sendSmsMessage([phone], renderTemplate(rawTemplate || fallback, values));
  } catch (error) {
    console.error("application SMS failed", error);
  }
}

async function generatePaymentCode(supabase: ReturnType<typeof createClient>) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `REG-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const { data } = await supabase.from("membership_applications").select("id").eq("payment_code", code).maybeSingle();
    if (!data) return code;
  }
  throw new Error("Could not generate a unique payment code");
}

function response(origin: string | null, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: { ...originHeaders(origin), "Content-Type": "application/json" } });
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

      const nationalId = String(body.national_id_number).trim();
      const [{ data: existing }, { data: existingMember }] = await Promise.all([
        supabase.from("membership_applications")
          .select("id, status").eq("national_id_number", nationalId).in("status", ["pending_review", "approved", "payment_pending", "activated"]).maybeSingle(),
        supabase.from("members").select("id").eq("national_id_number", nationalId).maybeSingle(),
      ]);
      if (existing || existingMember) return response(origin, 409, { error: "A membership application or member already exists for this National ID." });

      const reference = `APP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const { data: application, error } = await supabase.from("membership_applications").insert({
        application_reference: reference,
        full_name: String(body.full_name).trim(), national_id_number: nationalId,
        date_of_birth: dob, gender: String(body.gender || "").trim(), phone_number: phone,
        alternative_phone_number: body.alternative_phone_number ? normalizePhone(body.alternative_phone_number) : null,
        email_address: body.email_address || null, residence_status: body.residence_status,
        village: body.village || null, current_location: body.current_location || null,
        dependants: Array.isArray(body.dependants) ? body.dependants : [], next_of_kin: body.next_of_kin,
        declaration_accepted: true, status: "pending_review", payment_status: "not_required",
      }).select("id, application_reference, status, application_date").single();
      if (error) throw error;

      await notifyApplicant(supabase, phone, "registration_submitted", `Malanga Welfare: Application ${reference} received successfully and is awaiting Welfare Committee review.`, { reference });
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
      if (application.status !== "pending_review") return response(origin, 400, { error: "Only applications pending review can be reviewed" });
      const approved = decision === "approve";
      const { data: settings } = await supabase.from("settings").select("registration_fee, paybill_number, mpesa_shortcode").limit(1).maybeSingle();
      const paymentCode = approved ? await generatePaymentCode(supabase) : null;
      const paybill = String(settings?.paybill_number || settings?.mpesa_shortcode || "").trim() || "not configured";
      const registrationFee = Number(settings?.registration_fee || 0);
      const paymentExpiresAt = approved ? new Date(Date.now() + 7 * 86400000).toISOString() : null;
      const update = { status: approved ? "payment_pending" : "rejected", payment_status: approved ? "pending" : "not_required", payment_reference: null, payment_code: paymentCode, payment_expires_at: paymentExpiresAt, reviewed_at: new Date().toISOString(), reviewed_by: String(claims.sub || ""), review_reason: String(body.reason || "").trim() || null, updated_at: new Date().toISOString() };
      const { data: updated, error } = await supabase.from("membership_applications").update(update).eq("id", id).select("*").single();
      if (error) throw error;
      const message = approved
        ? `Malanga Welfare: Your membership application has been approved. Pay KES ${registrationFee} via Paybill ${paybill}, account ${paymentCode} within one week. Your member number will be issued after payment is verified.`
        : `Malanga Welfare: Your membership application was not approved. ${update.review_reason || "Please contact the Welfare Committee."}`;
      await notifyApplicant(supabase, application.phone_number, approved ? "registration_approved" : "registration_rejected", message, {
        amount: registrationFee,
        paybill,
        paymentCode,
        deadline: paymentExpiresAt ? paymentExpiresAt.slice(0, 10) : "",
      });
      await supabase.from("notifications").insert({ role: "admin", title: approved ? "Application Approved" : "Application Rejected", message: `${application.application_reference} was ${approved ? "approved" : "rejected"}.`, category: approved ? "registration_approved" : "registration_rejected", data: { application_id: id } });
      return response(origin, 200, { success: true, application: updated });
    }

    if (action === "confirm_payment") {
      const id = String(body.application_id || "").trim();
      const { data: application, error: loadError } = await supabase.from("membership_applications").select("*").eq("id", id).single();
      if (loadError || !application) return response(origin, 404, { error: "Application not found" });
      if (application.status !== "payment_pending") return response(origin, 400, { error: "Application is not awaiting payment" });
      if (!["received", "verified"].includes(String(application.payment_status)) || !application.payment_receipt) {
        return response(origin, 400, { error: "No verified payment receipt is linked to this application" });
      }
      const { data: memberResult, error: memberError } = await supabase.rpc("activate_membership_application", { p_application_id: id });
      if (memberError || !memberResult?.success) throw memberError || new Error(memberResult?.message || "Member activation failed");
      const { data: updated, error } = await supabase.from("membership_applications").select("*").eq("id", id).single();
      if (error) throw error;
      const { data: activatedMember } = await supabase.from("members").select("probation_end_date").eq("id", memberResult.id).maybeSingle();
      const { data: activationTemplate } = await supabase.from("sms_templates").select("raw_template").eq("trigger_key", "registration_activated").maybeSingle();
      const activationMessage = renderTemplate(
        String(activationTemplate?.raw_template || "Malanga Welfare: Congratulations {name}. Your membership is now active. Your member number is {memberNumber}."),
        { name: application.full_name, memberNumber: memberResult.member_number },
      );
      const { error: activationNotificationError } = await supabase.from("notifications").insert({
        member_id: memberResult.id,
        role: "member",
        title: "Membership Activated",
        message: activationMessage,
        category: "registration_activated",
        data: { source: "membership_application", application_id: id },
      });
      if (activationNotificationError) console.error("Could not queue membership activation SMS:", activationNotificationError.message);

      const { error: whatsappNotificationError } = await supabase.from("notifications").insert({
        member_id: memberResult.id,
        role: "member",
        title: "Members WhatsApp Group Invitation",
        message: "Your members WhatsApp group invitation is ready.",
        category: "whatsapp_group_invite",
        data: { source: "membership_application", application_id: id, use_current_whatsapp_group_link: true },
      });
      if (whatsappNotificationError) console.error("Could not queue WhatsApp group invitation:", whatsappNotificationError.message);
      return response(origin, 200, { success: true, application: updated, member_number: memberResult.member_number, probation_end_date: activatedMember?.probation_end_date || null });
    }

    return response(origin, 400, { error: "Unsupported action" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return response(origin, message === "Forbidden" ? 403 : 500, { error: message });
  }
});
