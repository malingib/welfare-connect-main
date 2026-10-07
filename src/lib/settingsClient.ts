import { invokeWithAppToken } from '@/lib/appAuth';
import { supabase } from '@/integrations/supabase/client';
import { logSystemEvent } from '@/lib/systemLog';

export interface SafeSettings {
  registration_fee: number;
  renewal_fee: number;
  penalty_amount: number;
  paybill_number: string | null;
  organization_name: string;
  organization_email: string | null;
  organization_phone: string | null;
  whatsapp_group_link: string | null;
  member_id_start: number;
  case_id_start: number;
  mpesa_shortcode: string | null;
  mpesa_initiator_name: string | null;
  mpesa_env: 'sandbox' | 'production';
}

const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;
const API_RETRY_BACKOFF_MS = 2 * 60 * 1000;

let cache: { value: SafeSettings | null; expiresAt: number } | null = null;
let inFlight: Promise<SafeSettings | null> | null = null;
let apiRetryAfter = 0;
let directReadAllowed = true;
let warnedApiFailure = false;
let warnedDirectReadFailure = false;

function readFromCache(): SafeSettings | null | undefined {
  if (!cache) return undefined;
  if (Date.now() > cache.expiresAt) return undefined;
  return cache.value;
}

function writeCache(value: SafeSettings | null) {
  cache = { value, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS };
}

export async function fetchSafeSettings(): Promise<SafeSettings | null> {
  const cached = readFromCache();
  if (cached !== undefined) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const now = Date.now();
    if (now >= apiRetryAfter) {
      try {
        const res = await invokeWithAppToken<{ settings: SafeSettings | null }>('api-settings', {
          action: 'get',
        });
        const value = res.settings || null;
        writeCache(value);
        warnedApiFailure = false;
        return value;
      } catch (error) {
        apiRetryAfter = Date.now() + API_RETRY_BACKOFF_MS;
        void logSystemEvent({
          action: 'SETTINGS_API_FETCH_FAILED',
          tableName: 'settings',
          status: 'warning',
          metadata: {
            source: 'fetchSafeSettings',
            error: error instanceof Error ? error.message : String(error),
          },
        });
        if (!warnedApiFailure) {
          console.warn('api-settings failed; retrying later and using fallback/defaults.', error);
          warnedApiFailure = true;
        }
      }
    }

    if (directReadAllowed) {
      const { data, error: dbError } = await (supabase as any)
        .from('settings')
        .select('registration_fee, renewal_fee, penalty_amount, paybill_number, organization_name, organization_email, organization_phone, whatsapp_group_link, member_id_start, case_id_start, mpesa_shortcode, mpesa_initiator_name, mpesa_env')
        .limit(1)
        .maybeSingle();

      if (dbError) {
        // When anonymous role lacks permission, stop retrying direct reads for this session.
        const dbStatus = Number((dbError as any).status || 0);
        const dbCode = String((dbError as any).code || '');
        const dbMessage = String((dbError as any).message || '');
        const deniedByRole =
          dbCode === '42501' ||
          dbCode.startsWith('PGRST') ||
          dbStatus === 401 ||
          dbStatus === 403 ||
          /permission denied|not permitted|unauthorized|forbidden/i.test(dbMessage);

        if (deniedByRole) {
          directReadAllowed = false;
          void logSystemEvent({
            action: 'SETTINGS_DIRECT_READ_DENIED',
            tableName: 'settings',
            status: 'warning',
            metadata: {
              source: 'fetchSafeSettings',
              code: dbCode || null,
              status: dbStatus || null,
              message: dbMessage || null,
            },
          });
          if (!warnedDirectReadFailure) {
            console.warn('Direct settings read is not permitted for this role; using defaults.');
            warnedDirectReadFailure = true;
          }
          writeCache(null);
          return null;
        }
        throw dbError;
      }

      const value = (data || null) as SafeSettings | null;
      writeCache(value);
      warnedDirectReadFailure = false;
      return value;
    }

    writeCache(null);
    return null;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
