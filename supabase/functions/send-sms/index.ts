import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { requirePrivilegedRole, verifyAppJwtFromRequest } from "../_shared/app_jwt.ts"
import { isSmsFailure, isValidSmsPhoneNumber, sendSmsMessage, summarizeSmsFailure } from "../_shared/sms.ts"

type RecipientData = {
  phoneNumber: string;
  name?: string;
  memberNumber?: string;
  memberId?: string;
  amount?: string;
  caseNumber?: string;
  deadline?: string;
  unpaid?: string;
  due?: string;
  ref?: string;
  senderName?: string;
};

function resolveTags(text: string, data: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(data)) {
    result = result.replaceAll(`{${key}}`, value || '');
    result = result.replaceAll(`[${key}]`, value || '');
  }
  return result;
}

type BuildResult = {
  context: Record<string, string>;
  skip: boolean;
  skipReason?: string;
};

async function buildRecipientContext(
  supabase: ReturnType<typeof createClient>,
  recipient: RecipientData,
  triggerKey?: string,
): Promise<BuildResult> {
  const ctx: Record<string, string> = {
    name: recipient.name || 'Member',
    memberNumber: recipient.memberNumber || '',
    amount: recipient.amount || '',
    caseNumber: recipient.caseNumber || '',
    deadline: recipient.deadline || '',
    ref: recipient.ref || '',
    senderName: recipient.senderName || '',
    unpaid: recipient.unpaid || '',
    due: recipient.due || '',
    balance: '',
  };

  let skip = false;
  let skipReason = '';

  if (recipient.memberId) {
    const { data: member } = await supabase
      .from('members')
      .select('name, member_number, phone_number, wallet_balance')
      .eq('id', recipient.memberId)
      .single();
    if (member) {
      if (!recipient.name) ctx.name = member.name || 'Member';
      if (!recipient.memberNumber) ctx.memberNumber = member.member_number || '';
      ctx.balance = String(member.wallet_balance ?? '');
    }

    // Fetch unpaid case obligations + total due in parallel
    const [oblResult, dueResult] = await Promise.all([
      supabase.rpc('get_member_unpaid_case_obligations', { p_member_id: recipient.memberId }),
      supabase.rpc('get_member_total_due', { p_member_id: recipient.memberId }),
    ]);
    const unpaidList = Array.isArray(oblResult.data) ? oblResult.data : [];
    ctx.unpaid = String(unpaidList.length);

    const dueRow = Array.isArray(dueResult.data) && dueResult.data.length > 0 ? dueResult.data[0] : null;
    ctx.due = dueRow?.total_due ? String(dueRow.total_due) : '';

    // For case-related triggers, fill case details from first obligation
    if (triggerKey === 'case_due' || triggerKey === 'overdue_reminder' || triggerKey === 'amount_due' || triggerKey === 'case_opened') {
      if (unpaidList.length > 0) {
        const ob = unpaidList[0];
        ctx.caseNumber = ob.case_number || '';
        ctx.amount = String(ob.contribution_per_member || 0);
        ctx.deadline = ob.case_date?.slice(0, 10) || '';
      } else if (!recipient.caseNumber && !recipient.amount) {
        skip = true;
        skipReason = 'No unpaid obligations for this member';
      }
    }

    // For renewal_reminder, skip if no expiry date
    if (triggerKey === 'renewal_reminder') {
      const { data: memberFull } = await supabase
        .from('members')
        .select('expiry_date')
        .eq('id', recipient.memberId)
        .single();
      if (memberFull?.expiry_date) {
        ctx.deadline = String(memberFull.expiry_date).slice(0, 10);
      } else if (!recipient.deadline) {
        skip = true;
        skipReason = 'No expiry date set for this member';
      }
    }

    // For welcome_member, skip if already welcomed
    if (triggerKey === 'welcome_member') {
      const { data: existing } = await supabase
        .from('audit_logs')
        .select('id')
        .eq('table_name', 'sms')
        .contains('metadata', { trigger_key: 'welcome_member', phone_number: recipient.phoneNumber })
        .limit(1);
      if (existing?.length) {
        skip = true;
        skipReason = 'Welcome message already sent to this member';
      }
    }

    // For payment_received, fetch recent transaction if amount is empty
    if (triggerKey === 'payment_received' && !ctx.balance && !ctx.amount) {
      const { data: lastTx } = await supabase
        .from('transactions')
        .select('amount')
        .eq('member_id', recipient.memberId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastTx) {
        ctx.amount = String(lastTx.amount || 0);
      }
    }
  }

  return { context: ctx, skip, skipReason };
}

function toRecipient(input: unknown): RecipientData | null {
  if (!input) return null;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed ? { phoneNumber: trimmed } : null;
  }
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const phoneNumber = String(obj.phoneNumber || obj.phone_number || '').trim();
    if (!phoneNumber) return null;
    return {
      phoneNumber,
      name: String(obj.name || '').trim() || undefined,
      memberNumber: String(obj.memberNumber || obj.member_number || '').trim() || undefined,
      memberId: String(obj.memberId || obj.member_id || obj.id || '').trim() || undefined,
      amount: String(obj.amount || '').trim() || undefined,
      caseNumber: String(obj.caseNumber || obj.case_number || '').trim() || undefined,
      deadline: String(obj.deadline || '').trim() || undefined,
      unpaid: String(obj.unpaid || '').trim() || undefined,
      due: String(obj.due || '').trim() || undefined,
      ref: String(obj.ref || obj.mpesaRef || obj.mpesa_reference || obj.receipt || '').trim() || undefined,
      senderName: String(obj.senderName || obj.sender_name || obj.sender || '').trim() || undefined,
    };
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const claims = await verifyAppJwtFromRequest(req)
    requirePrivilegedRole(claims.role)

    const body = await req.json();
    const rawRecipients = Array.isArray(body?.recipients)
      ? body.recipients
      : body?.phoneNumbers
        ? body.phoneNumbers
        : body?.phoneNumber
          ? [body.phoneNumber]
          : [];
    const message = String(body?.message || '').trim();
    const triggerKey = String(body?.triggerKey || body?.trigger_key || 'manual_custom').trim();
    const source = String(body?.source || body?.origin || 'admin_dashboard').trim();
    const tableName = String(body?.tableName || body?.table_name || 'sms').trim();

    if (!rawRecipients.length || !message) {
      return new Response(
        JSON.stringify({ error: 'At least one recipient and a message are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const parsed = rawRecipients.map(toRecipient).filter(Boolean) as RecipientData[];

    if (!parsed.length) {
      return new Response(
        JSON.stringify({ error: 'At least one valid recipient phone number is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Prefer the admin-editable template stored in sms_templates so edits made
    // in Settings actually affect what gets sent. Fall back to the client
    // message (manual_custom always uses the client message).
    let effectiveMessage = message;
    if (triggerKey && triggerKey !== 'manual_custom') {
      try {
        const { data: tpl } = await supabase
          .from('sms_templates')
          .select('raw_template')
          .eq('trigger_key', triggerKey)
          .maybeSingle();
        const dbTemplate = String((tpl as { raw_template?: unknown } | null)?.raw_template || '').trim();
        if (dbTemplate) effectiveMessage = dbTemplate;
      } catch {
        // Fall through to the client-supplied message.
      }
    }

    const skipped: Array<{ phoneNumber: string; reason: string; name?: string }> = [];
    const recipients: RecipientData[] = [];
    for (const recipient of parsed) {
      // Reject malformed numbers up front instead of letting the provider fail
      // them (previously produced cryptic SMS_FAILED rows, e.g. '114366708').
      if (!isValidSmsPhoneNumber(recipient.phoneNumber)) {
        skipped.push({ phoneNumber: recipient.phoneNumber, reason: 'Invalid phone number', name: recipient.name });
        continue;
      }
      recipients.push(recipient);
    }

    type SendOutcome = {
      phoneNumber: string;
      message: string;
      result: Awaited<ReturnType<typeof sendSmsMessage>>[0];
      recipient: RecipientData;
    };
    const allResults: SendOutcome[] = [];

    // Process recipients with bounded concurrency. The old strictly-sequential
    // loop (2 RPCs + lookups + provider HTTP call per recipient) could not
    // finish large blasts (e.g. 988 recipients) inside the function time limit,
    // producing partial sends. Personalised tags still require one provider
    // call per recipient, so we parallelise with a cap instead of one bulk call.
    const CONCURRENCY = 10;
    async function processRecipient(recipient: RecipientData): Promise<void> {
      const built = await buildRecipientContext(supabase, recipient, triggerKey);
      if (built.skip) {
        skipped.push({ phoneNumber: recipient.phoneNumber, reason: built.skipReason || 'Skipped', name: recipient.name });
        return;
      }
      const personalMessage = resolveTags(effectiveMessage, built.context);
      const results = await sendSmsMessage([recipient.phoneNumber], personalMessage);
      if (!results[0]) {
        skipped.push({ phoneNumber: recipient.phoneNumber, reason: 'Provider returned no result', name: recipient.name });
        return;
      }
      allResults.push({ phoneNumber: recipient.phoneNumber, message: personalMessage, result: results[0], recipient });
    }
    for (let i = 0; i < recipients.length; i += CONCURRENCY) {
      await Promise.all(recipients.slice(i, i + CONCURRENCY).map(processRecipient));
    }

    // Batch the audit/notification writes instead of one round-trip per row.
    const auditRows = allResults.map(({ phoneNumber, message: personalMessage, result }) => {
      const isSuccess = !isSmsFailure(result);
      return {
        action: isSmsFailure(result) ? 'SMS_FAILED' : result.status === 'delivered' ? 'SMS_DELIVERED' : 'SMS_SENT',
        table_name: tableName,
        status: isSuccess ? 'success' : 'error',
        user_id: claims.sub || null,
        metadata: {
          source,
          trigger_key: triggerKey,
          provider: result.provider,
          phone_number: phoneNumber,
          message: personalMessage,
          provider_message_id: result.providerMessageId,
          provider_response: result.raw,
        },
      };
    });
    const notificationRows = allResults
      .filter(({ result, recipient }) => !isSmsFailure(result) && recipient?.memberId)
      .map(({ phoneNumber, message: personalMessage, recipient }) => ({
        member_id: recipient.memberId,
        user_id: claims.sub || null,
        role: 'member',
        title: triggerKey === 'overdue_reminder' ? 'Malipo Yamechelewa' : triggerKey === 'case_due' ? 'Malipo Yanakaribia' : triggerKey === 'amount_due' ? 'Deni' : triggerKey === 'welcome_member' ? 'Karibu' : triggerKey === 'payment_received' ? 'Malipo Yamepokelewa' : triggerKey === 'payment_failed' ? 'Malipo Yameshindikana' : 'Ujumbe',
        message: personalMessage,
        category: triggerKey,
        data: { sms: true, phone: phoneNumber, trigger_key: triggerKey },
      }));
    const WRITE_BATCH = 200;
    for (let i = 0; i < auditRows.length; i += WRITE_BATCH) {
      const chunk = auditRows.slice(i, i + WRITE_BATCH);
      if (chunk.length) await supabase.from("audit_logs").insert(chunk);
    }
    for (let i = 0; i < notificationRows.length; i += WRITE_BATCH) {
      const chunk = notificationRows.slice(i, i + WRITE_BATCH);
      if (chunk.length) await supabase.from("notifications").insert(chunk);
    }

    const results = allResults.map(r => r.result);
    const delivered = results.filter((r) => r.status === 'delivered').length;
    const failed = results.filter(isSmsFailure).length;
    const sent = results.length - failed;
    const success = failed === 0;
    const errorMessage = summarizeSmsFailure(results);
    const skippedSummary: Record<string, number> = {};
    for (const s of skipped) skippedSummary[s.reason] = (skippedSummary[s.reason] || 0) + 1;

    return new Response(
      JSON.stringify({
        success,
        sent,
        delivered,
        failed,
        skipped: skipped.length,
        ...(skipped.length ? { skippedDetails: skipped, skippedSummary } : {}),
        recipients: allResults.length + skipped.length,
        results,
        ...(success ? {} : { error: errorMessage || 'One or more SMS messages failed' }),
      }),
      {
        status: success ? 200 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Error in send-sms function:', error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'An error occurred while sending SMS',
        details: String(error)
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
