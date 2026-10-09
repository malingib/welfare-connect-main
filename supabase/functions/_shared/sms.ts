export type SmsRecipient = {
  phoneNumber: string;
  name?: string | null;
  memberId?: string | null;
  memberNumber?: string | null;
  triggerKey?: string | null;
};

export type SmsSendResult = {
  ok: boolean;
  status: 'sent' | 'delivered' | 'failed';
  provider: 'mobiwave' | 'legacy';
  providerMessageId: string | null;
  raw: unknown;
  phoneNumber: string;
};

export function normalizePhoneNumber(phoneNumber: string): string {
  const digits = String(phoneNumber || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith('7')) return `254${digits}`;
  return digits;
}

export function isValidSmsPhoneNumber(phoneNumber: string): boolean {
  // Kenyan mobile numbers in E.164-without-plus form: 254 + (7|1) + 8 digits.
  // Previously anything non-empty was attempted and rejected by the provider
  // (e.g. '114366708'), producing confusing SMS_FAILED rows.
  return /^254(7|1)\d{8}$/.test(normalizePhoneNumber(phoneNumber));
}

function readProviderMessage(response: unknown, fallback: string): string {
  if (!response || typeof response !== 'object') return fallback;

  const queue: unknown[] = [response];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    for (const [key, raw] of Object.entries(current as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (
        typeof raw === 'string' &&
        ['message', 'error', 'error_message', 'description', 'response-description', 'responsedescription'].includes(lowerKey)
      ) {
        const trimmed = raw.trim();
        if (trimmed) return trimmed;
      }
      if (raw && typeof raw === 'object') {
        queue.push(raw);
      }
    }
  }

  return fallback;
}

function findStatusValue(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;

  const queue: unknown[] = [value];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    for (const [key, raw] of Object.entries(current as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (typeof raw === 'string') {
        const lowerValue = raw.toLowerCase();
        if (['status', 'state', 'delivery_status', 'message_status'].includes(lowerKey)) {
          return lowerValue;
        }
        if (/(delivered|failed|error|sent|queued|accepted|rejected|success)/.test(lowerValue)) {
          return lowerValue;
        }
      } else if (raw && typeof raw === 'object') {
        queue.push(raw);
      }
    }
  }

  return null;
}

function inferSmsStatus(response: unknown, ok: boolean): 'sent' | 'delivered' | 'failed' {
  const statusValue = findStatusValue(response);
  if (!statusValue) {
    return ok ? 'sent' : 'failed';
  }

  if (/failed|error|rejected|undelivered|cancelled|canceled|voided/.test(statusValue)) {
    return 'failed';
  }

  if (/delivered/.test(statusValue)) {
    return 'delivered';
  }

  if (/sent|queued|accepted|success|processing|pending/.test(statusValue)) {
    return 'sent';
  }

  return ok ? 'sent' : 'failed';
}

function extractProviderMessageId(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;

  const queue: unknown[] = [response];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    for (const [key, raw] of Object.entries(current as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (typeof raw === 'string' && ['uid', 'id', 'sms_id', 'message_id', 'reference'].includes(lowerKey)) {
        const trimmed = raw.trim();
        if (trimmed) return trimmed;
      }
      if (raw && typeof raw === 'object') {
        queue.push(raw);
      }
    }
  }

  return null;
}

export function resolveSmsProvider() {
  const mobiwaveToken = Deno.env.get('SMS_MOBIWAVE_TOKEN') || Deno.env.get('SMS_BEARER_TOKEN') || '';
  const senderId = Deno.env.get('SMS_SENDER_ID') || Deno.env.get('SMS_SHORTCODE') || 'WELFARE';
  const mobiwaveBaseUrl = Deno.env.get('SMS_MOBIWAVE_BASE_URL') || 'https://sms.mobiwave.co.ke/api/v3';

  const legacyApiKey = Deno.env.get('SMS_API_KEY') || '';
  const legacyPartnerId = Deno.env.get('SMS_PARTNER_ID') || '';
  const legacyShortcode = Deno.env.get('SMS_SHORTCODE') || 'WELFARE';
  const legacyBaseUrl = Deno.env.get('SMS_BASE_URL') || 'https://sms.textsms.co.ke/api/services';

  return {
    mobiwaveToken,
    senderId,
    mobiwaveBaseUrl,
    legacyApiKey,
    legacyPartnerId,
    legacyShortcode,
    legacyBaseUrl,
  };
}

export async function sendSmsMessage(
  phoneNumbers: string[],
  message: string,
): Promise<SmsSendResult[]> {
  const provider = resolveSmsProvider();
  const recipients = phoneNumbers
    .map(normalizePhoneNumber)
    .filter((phoneNumber) => phoneNumber.length > 0);

  if (recipients.length === 0) {
    return [];
  }

  if (provider.mobiwaveToken) {
    const response = await fetch(`${provider.mobiwaveBaseUrl}/sms/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.mobiwaveToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        recipient: recipients.join(','),
        sender_id: provider.senderId,
        type: 'plain',
        message,
      }),
    });

    const raw = await response.json().catch(() => ({}));
    const responseStatus = String((raw as any)?.status || '').toLowerCase();
    const ok = response.ok && (!responseStatus || responseStatus === 'success');
    const status = inferSmsStatus(raw, ok);
    const providerMessageId = extractProviderMessageId(raw);

    return recipients.map((phoneNumber) => ({
      ok,
      status,
      provider: 'mobiwave',
      providerMessageId,
      raw,
      phoneNumber,
    }));
  }

  if (!provider.legacyApiKey || !provider.legacyPartnerId) {
    throw new Error('SMS service is not properly configured');
  }

  const results: SmsSendResult[] = [];
  for (const phoneNumber of recipients) {
    const response = await fetch(`${provider.legacyBaseUrl}/sendsms/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apikey: provider.legacyApiKey,
        partnerID: provider.legacyPartnerId,
        mobile: phoneNumber,
        message,
        shortcode: provider.legacyShortcode,
        pass_type: 'plain',
      }),
    });

    const raw = await response.json().catch(() => ({}));
    const legacyResponse = Array.isArray((raw as any)?.responses) ? (raw as any).responses[0] : null;
    const ok = response.ok && legacyResponse && Number(legacyResponse['respose-code'] || 0) === 200;
    const status = inferSmsStatus(raw, ok);
    const providerMessageId = extractProviderMessageId(raw);

    results.push({
      ok,
      status,
      provider: 'legacy',
      providerMessageId,
      raw,
      phoneNumber,
    });
  }

  return results;
}

export function summarizeSmsFailure(results: SmsSendResult[]): string {
  const failed = results.filter(isSmsFailure);
  if (failed.length === 0) return '';

  const messages = failed
    .map((result) => readProviderMessage(result.raw, 'Provider marked message as failed'))
    .filter(Boolean);
  const uniqueMessages = [...new Set(messages)];

  return uniqueMessages.length
    ? uniqueMessages.join('; ')
    : `${failed.length} SMS recipient${failed.length === 1 ? '' : 's'} failed`;
}

export function isSmsFailure(result: SmsSendResult): boolean {
  return !result.ok || result.status === 'failed';
}

export function isSmsQuotaFailure(result: SmsSendResult): boolean {
  const raw = JSON.stringify(result.raw || {}).toLowerCase();
  return raw.includes('exceeded your sending limit') || raw.includes('sending limit') || raw.includes('insufficient balance') || raw.includes('insufficient credits');
}

export async function fetchSmsBalance(): Promise<{ balance: number | null; raw: unknown | null }> {
  const provider = resolveSmsProvider();
  if (!provider.mobiwaveToken) {
    return { balance: null, raw: null };
  }

  const response = await fetch(`${provider.mobiwaveBaseUrl}/balance`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${provider.mobiwaveToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((raw as any)?.message || 'Failed to fetch SMS balance');
  }

  const balanceCandidates = [
    (raw as any)?.balance,
    (raw as any)?.data?.balance,
    (raw as any)?.data?.sms_unit,
    (raw as any)?.data?.units,
    (raw as any)?.data?.sms_balance,
  ];

  const numericBalance = balanceCandidates.find((candidate) => {
    const value = Number(candidate);
    return Number.isFinite(value);
  });

  return {
    balance: Number.isFinite(Number(numericBalance)) ? Number(numericBalance) : null,
    raw,
  };
}
