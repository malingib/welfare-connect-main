import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requirePrivilegedRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts";
import { isSmsFailure, sendSmsMessage, summarizeSmsFailure } from "../_shared/sms.ts";

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
  supabase: any,
  phone: string,
  triggerKey: string,
  fallback: string,
  values: Record<string, unknown> = {},
) {
  let message = fallback;
  try {
    const { data: template } = await supabase
      .from("sms_templates")
      .select("raw_template")
      .eq("trigger_key", triggerKey)
      .maybeSingle();
    const rawTemplate = String((template as { raw_template?: unknown } | null)?.raw_template || "").trim();
    message = renderTemplate(rawTemplate || fallback, values);
    const results = await sendSmsMessage([phone], message);
    const failed = results.some(isSmsFailure);
    await supabase.from("audit_logs").insert({
      action: failed ? "SMS_FAILED" : "SMS_SENT",
      table_name: "sms",
      status: failed ? "error" : "success",
      metadata: {
        source: "membership_application",
        trigger_key: triggerKey,
        phone_number: phone,
        message,
        provider_message_id: results[0]?.providerMessageId || null,
        provider_response: results[0]?.raw || null,
        error: failed ? summarizeSmsFailure(results) : null,
      },
    });
    return { sent: !failed, message, error: failed ? summarizeSmsFailure(results) : null };
  } catch (error) {
    console.error("application SMS failed", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await supabase.from("audit_logs").insert({
      action: "SMS_FAILED",
      table_name: "sms",
      status: "error",
      metadata: { source: "membership_application", trigger_key: triggerKey, phone_number: phone, message, error: errorMessage },
    });
    return { sent: false, message, error: errorMessage };
  }
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

    if (action === "match_suspense_payment") {
      const suspenseId = String(body.suspense_id || "").trim();
      const applicationId = String(body.application_id || "").trim();
      if (!suspenseId || !applicationId) return response(origin, 400, { error: "suspense_id and application_id are required" });

      const [{ data: suspense, error: suspenseError }, { data: application, error: applicationError }, { data: settings }] = await Promise.all([
        supabase.from("wrong_mpesa_transactions").select("id, amount, mpesa_receipt_number, phone_number, status").eq("id", suspenseId).single(),
        supabase.from("membership_applications").select("*").eq("id", applicationId).single(),
        supabase.from("settings").select("registration_fee").limit(1).maybeSingle(),
      ]);
      if (suspenseError || !suspense) return response(origin, 404, { error: "Suspense payment not found" });
      if (applicationError || !application) return response(origin, 404, { error: "Application not found" });
      if (!["pending", "PENDING_REVIEW"].includes(String(suspense.status))) return response(origin, 400, { error: "Suspense payment is no longer pending" });
      if (!["pending_review", "payment_pending"].includes(String(application.status))) return response(origin, 400, { error: "Application is no longer awaiting payment" });

      const expectedAmount = Number(settings?.registration_fee || 0);
      if (!expectedAmount || Number(suspense.amount || 0) !== expectedAmount) {
        return response(origin, 400, { error: `Payment amount does not match the registration fee of KES ${expectedAmount.toLocaleString("en-KE")}.` });
      }
      const receipt = String(suspense.mpesa_receipt_number || "").trim().toUpperCase();
      if (!receipt) return response(origin, 400, { error: "Suspense payment has no M-Pesa receipt" });

      const { data: existingTransaction } = await supabase.from("transactions").select("id").eq("mpesa_reference", receipt).maybeSingle();
      if (existingTransaction) return response(origin, 409, { error: "This M-Pesa receipt has already been processed" });

      const { error: paymentUpdateError } = await supabase.from("membership_applications").update({
        status: "payment_pending",
        payment_status: "received",
        payment_received_at: new Date().toISOString(),
        payment_receipt: receipt,
        payment_amount: Number(suspense.amount),
        payment_phone_number: suspense.phone_number || null,
        payment_metadata: { source: "suspense_registration_match", suspense_id: suspenseId, matched_by: String(claims.sub || "") },
        updated_at: new Date().toISOString(),
      }).eq("id", applicationId).in("status", ["pending_review", "payment_pending"]);
      if (paymentUpdateError) throw paymentUpdateError;

      const { data: activationResult, error: activationError } = await supabase.rpc("activate_membership_application", { p_application_id: applicationId });
      if (activationError || !activationResult?.success) throw activationError || new Error(activationResult?.message || "Membership activation failed");

      const { data: activatedMember } = await supabase.from("members").select("id, name, member_number, phone_number, probation_end_date").eq("id", activationResult.id).single();
      const { data: activationTemplate } = await supabase.from("sms_templates").select("raw_template").eq("trigger_key", "registration_activated").maybeSingle();
      const activationMessage = String(activationTemplate?.raw_template || "Malanga Welfare: Congratulations {name}. Your membership is now active. Your member number is {memberNumber}.")
        .replaceAll("{name}", String(activatedMember?.name || application.full_name))
        .replaceAll("{memberNumber}", String(activatedMember?.member_number || activationResult.member_number))
        .replaceAll("{phoneNumber}", String(activatedMember?.phone_number || application.phone_number))
        .replaceAll("{portalLink}", "https://malangawelfare.org/login?role=member");
      const activationNotification = await supabase.from("notifications").insert({ member_id: activationResult.id, role: "member", title: "Membership Activated", message: activationMessage, category: "registration_activated", event_key: `application:${applicationId}:registration_activated`, data: { source: "suspense_registration_match", application_id: applicationId, suspense_id: suspenseId, sms_delivery_mode: "immediate" } }).select("id").single();
      const { data: whatsappSettings } = await supabase.from("settings").select("whatsapp_group_link").limit(1).maybeSingle();
      const whatsappLink = String(whatsappSettings?.whatsapp_group_link || Deno.env.get("WHATSAPP_GROUP_LINK") || "").trim();
      const whatsappMessage = whatsappLink ? String((await supabase.from("sms_templates").select("raw_template").eq("trigger_key", "whatsapp_group_invite").maybeSingle()).data?.raw_template || "Malanga Welfare: Join the members WhatsApp group here: {whatsappLink}. Please do not share this link publicly.").replaceAll("{whatsappLink}", whatsappLink) : "";
      const whatsappNotification = await supabase.from("notifications").insert({ member_id: activationResult.id, role: "member", title: "Members WhatsApp Group Invitation", message: "Your members WhatsApp group invitation is ready.", category: "whatsapp_group_invite", event_key: `application:${applicationId}:whatsapp_group_invite`, data: { source: "suspense_registration_match", application_id: applicationId, use_current_whatsapp_group_link: true, sms_delivery_mode: "immediate" } }).select("id").single();
      try {
        const results = await sendSmsMessage([String(activatedMember?.phone_number || application.phone_number)], activationMessage);
        const activationSmsSent = results.length > 0 && results.every((result) => !isSmsFailure(result));
        if (activationSmsSent && activationNotification.data?.id) await supabase.from("notifications").update({ sms_sent_at: new Date().toISOString() }).eq("id", activationNotification.data.id);
        await Promise.all(results.map((result) => supabase.from("audit_logs").insert({ action: isSmsFailure(result) ? "SMS_FAILED" : "SMS_SENT", table_name: "sms", status: isSmsFailure(result) ? "error" : "success", metadata: { source: "suspense_registration_match", trigger_key: "registration_activated", application_id: applicationId, suspense_id: suspenseId, member_number: activatedMember?.member_number || activationResult.member_number, provider: result.provider, provider_message_id: result.providerMessageId, provider_response: result.raw } })));
        if (whatsappMessage && whatsappNotification.data?.id) {
          const whatsappResults = await sendSmsMessage([String(activatedMember?.phone_number || application.phone_number)], whatsappMessage);
          const whatsappSent = whatsappResults.length > 0 && whatsappResults.every((result) => !isSmsFailure(result));
          if (whatsappSent) await supabase.from("notifications").update({ sms_sent_at: new Date().toISOString() }).eq("id", whatsappNotification.data.id);
          await Promise.all(whatsappResults.map((result) => supabase.from("audit_logs").insert({ action: isSmsFailure(result) ? "SMS_FAILED" : "SMS_SENT", table_name: "sms", status: isSmsFailure(result) ? "error" : "success", metadata: { source: "suspense_registration_match", trigger_key: "whatsapp_group_invite", application_id: applicationId, provider: result.provider, provider_message_id: result.providerMessageId, provider_response: result.raw } })));
        }
      } catch (smsError) {
        console.error("Registration activation SMS failed after suspense match", smsError);
      }

      const { error: suspenseUpdateError } = await supabase.from("wrong_mpesa_transactions").update({ status: "matched", matched_member_id: activationResult.id, matched_at: new Date().toISOString(), notes: `Matched to membership application ${application.application_reference} by admin ${String(claims.sub || "")}` }).eq("id", suspenseId);
      if (suspenseUpdateError) throw suspenseUpdateError;
      return response(origin, 200, { success: true, member_number: activatedMember?.member_number || activationResult.member_number, application: application.application_reference });
    }

    if (action === "edit") {
      const id = String(body.application_id || "").trim();
      if (!id) return response(origin, 400, { error: "application_id is required" });

      const { data: existing, error: loadError } = await supabase
        .from("membership_applications")
        .select("id, status")
        .eq("id", id)
        .single();
      if (loadError || !existing) return response(origin, 404, { error: "Application not found" });

      const fullName = String(body.full_name || "").trim();
      const nationalId = String(body.national_id_number || "").trim();
      const dateOfBirth = String(body.date_of_birth || "").trim();
      const phone = normalizePhone(body.phone_number);
      const residenceStatus = String(body.residence_status || "").trim();
      if (!fullName || !nationalId || !dateOfBirth || !phone || !["resident", "non_resident"].includes(residenceStatus)) {
        return response(origin, 400, { error: "Complete all required application fields." });
      }
      if (!/^254(7|1)\d{8}$/.test(phone)) return response(origin, 400, { error: "Enter a valid Kenyan mobile number." });
      if (residenceStatus === "resident" && !String(body.village || "").trim()) {
        return response(origin, 400, { error: "Select a Malanga village." });
      }
      if (residenceStatus === "non_resident" && !String(body.current_location || "").trim()) {
        return response(origin, 400, { error: "Enter the applicant's current location." });
      }

      const { data: updated, error } = await supabase
        .from("membership_applications")
        .update({
          full_name: fullName,
          national_id_number: nationalId,
          date_of_birth: dateOfBirth,
          gender: String(body.gender || "").trim(),
          phone_number: phone,
          alternative_phone_number: body.alternative_phone_number ? normalizePhone(body.alternative_phone_number) : null,
          email_address: String(body.email_address || "").trim() || null,
          residence_status: residenceStatus,
          village: residenceStatus === "resident" ? String(body.village || "").trim() : null,
          current_location: residenceStatus === "non_resident" ? String(body.current_location || "").trim() : null,
          review_reason: String(body.review_reason || "").trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return response(origin, 200, { success: true, application: updated });
    }

    if (action === "delete") {
      const id = String(body.application_id || "").trim();
      if (!id) return response(origin, 400, { error: "application_id is required" });

      const { error } = await supabase.from("membership_applications").delete().eq("id", id);
      if (error) throw error;
      return response(origin, 200, { success: true });
    }

    if (action === "review") {
      const id = String(body.application_id || "").trim();
      const decision = String(body.decision || "").trim().toLowerCase();
      if (!id || !["approve", "reject"].includes(decision)) return response(origin, 400, { error: "application_id and approve/reject decision are required" });
      const approved = decision === "approve";
      const { data: settings } = await supabase.from("settings").select("registration_fee, paybill_number, mpesa_shortcode").limit(1).maybeSingle();
      const { data: reviewResult, error: reviewError } = await supabase.rpc("review_membership_application", {
        p_application_id: id,
        p_decision: decision,
        p_reviewed_by: String(claims.sub || ""),
        p_reason: String(body.reason || "").trim() || null,
      });
      if (reviewError) throw reviewError;
      if (!reviewResult?.success) {
        return response(origin, reviewResult?.already_processed ? 409 : 400, { error: reviewResult?.message || "Application review failed" });
      }
      const paybill = String(settings?.paybill_number || settings?.mpesa_shortcode || "").trim() || "not configured";
      const registrationFee = Number(settings?.registration_fee || 0);
      const paymentCode = String(reviewResult.payment_code || "");
      const paymentExpiresAt = reviewResult.payment_expires_at ? String(reviewResult.payment_expires_at) : null;
      const message = approved
        ? `Malanga Welfare: Your membership application has been approved. Pay KES ${registrationFee} via Paybill ${paybill}, account ${paymentCode} within one week. Your member number will be issued after payment is verified.`
        : `Malanga Welfare: Your membership application was not approved. ${String(body.reason || "").trim() || "Please contact the Welfare Committee."}`;
      const smsResult = await notifyApplicant(supabase, String(reviewResult.phone_number || ""), approved ? "registration_approved" : "registration_rejected", message, {
        amount: registrationFee,
        paybill,
        paymentCode,
        deadline: paymentExpiresAt ? paymentExpiresAt.slice(0, 10) : "",
      });
      const eventKey = `application:${id}:registration_${approved ? "approved" : "rejected"}`;
      const { error: notificationError } = await supabase.from("notifications").insert({
        role: "admin",
        title: approved ? "Application Approved" : "Application Rejected",
        message: `${reviewResult.application_reference} was ${approved ? "approved" : "rejected"}.`,
        category: approved ? "registration_approved" : "registration_rejected",
        event_key: eventKey,
        sms_sent_at: smsResult.sent ? new Date().toISOString() : null,
        data: { application_id: id, sms_delivery_mode: "immediate", sms_error: smsResult.error },
      });
      if (notificationError && notificationError.code !== "23505") console.error("Could not record review notification:", notificationError.message);
      return response(origin, 200, { success: true, sms_sent: smsResult.sent, application: reviewResult });
    }

    if (action === "resend_sms") {
      const id = String(body.application_id || "").trim();
      const requestedTrigger = String(body.trigger_key || "registration_approved").trim();
      if (!id || !["registration_approved", "registration_rejected"].includes(requestedTrigger)) {
        return response(origin, 400, { error: "application_id and a supported trigger_key are required" });
      }
      const { data: application, error: loadError } = await supabase
        .from("membership_applications")
        .select("id, application_reference, full_name, phone_number, status, payment_code, payment_expires_at, review_reason")
        .eq("id", id)
        .single();
      if (loadError || !application) return response(origin, 404, { error: "Application not found" });

      const { data: settings } = await supabase.from("settings").select("registration_fee, paybill_number, mpesa_shortcode").limit(1).maybeSingle();
      const approved = requestedTrigger === "registration_approved";
      if (approved && !application.payment_code) return response(origin, 400, { error: "This application has no payment code to resend" });
      const paybill = String(settings?.paybill_number || settings?.mpesa_shortcode || "").trim() || "not configured";
      const registrationFee = Number(settings?.registration_fee || 0);
      const message = approved
        ? `Malanga Welfare: Your membership application has been approved. Pay KES ${registrationFee} via Paybill ${paybill}, account ${application.payment_code} within one week. Your member number will be issued after payment is verified.`
        : `Malanga Welfare: Your membership application was not approved. ${application.review_reason || "Please contact the Welfare Committee."}`;
      const smsResult = await notifyApplicant(supabase, application.phone_number, requestedTrigger, message, {
        amount: registrationFee,
        paybill,
        paymentCode: application.payment_code || "",
        deadline: application.payment_expires_at ? String(application.payment_expires_at).slice(0, 10) : "",
      });
      await supabase.from("audit_logs").insert({
        action: smsResult.sent ? "SMS_RESENT" : "SMS_RESEND_FAILED",
        table_name: "sms",
        status: smsResult.sent ? "success" : "error",
        metadata: { source: "membership_application_manual_resend", trigger_key: requestedTrigger, application_id: id, phone_number: application.phone_number, error: smsResult.error },
      });
      return response(origin, smsResult.sent ? 200 : 502, { success: smsResult.sent, sms_sent: smsResult.sent, error: smsResult.error || null });
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
      const { data: activatedMember } = await supabase.from("members").select("probation_end_date, phone_number").eq("id", memberResult.id).maybeSingle();
      const { data: activationTemplate } = await supabase.from("sms_templates").select("raw_template").eq("trigger_key", "registration_activated").maybeSingle();
      const activationMessage = renderTemplate(
        String(activationTemplate?.raw_template || "Malanga Welfare: Congratulations {name}. Your membership is now active. Your member number is {memberNumber}."),
        { name: application.full_name, memberNumber: memberResult.member_number },
      );
      const activationSms = await notifyApplicant(supabase, String(activatedMember?.phone_number || application.phone_number), "registration_activated", activationMessage, {
        name: application.full_name,
        memberNumber: memberResult.member_number,
        phoneNumber: activatedMember?.phone_number || application.phone_number,
        portalLink: "https://malangawelfare.org/login?role=member",
      });
      const { error: activationNotificationError } = await supabase.from("notifications").insert({
        member_id: memberResult.id,
        role: "member",
        title: "Membership Activated",
        message: activationMessage,
        category: "registration_activated",
        event_key: `application:${id}:registration_activated`,
        sms_sent_at: activationSms.sent ? new Date().toISOString() : null,
        data: { source: "membership_application", application_id: id, sms_delivery_mode: "immediate", sms_error: activationSms.error },
      });
      if (activationNotificationError) console.error("Could not queue membership activation SMS:", activationNotificationError.message);

      const { data: whatsappSettings } = await supabase.from("settings").select("whatsapp_group_link").limit(1).maybeSingle();
      const whatsappLink = String(whatsappSettings?.whatsapp_group_link || Deno.env.get("WHATSAPP_GROUP_LINK") || "").trim();
      const whatsappSms = whatsappLink
        ? await notifyApplicant(supabase, String(activatedMember?.phone_number || application.phone_number), "whatsapp_group_invite", "Malanga Welfare: Join the members WhatsApp group here: {whatsappLink}. Please do not share this link publicly.", { whatsappLink })
        : { sent: false, error: "WhatsApp group link is not configured" };
      const { error: whatsappNotificationError } = await supabase.from("notifications").insert({
        member_id: memberResult.id,
        role: "member",
        title: "Members WhatsApp Group Invitation",
        message: "Your members WhatsApp group invitation is ready.",
        category: "whatsapp_group_invite",
        event_key: `application:${id}:whatsapp_group_invite`,
        sms_sent_at: whatsappSms.sent ? new Date().toISOString() : null,
        data: { source: "membership_application", application_id: id, use_current_whatsapp_group_link: true, sms_delivery_mode: "immediate", sms_error: whatsappSms.error },
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
