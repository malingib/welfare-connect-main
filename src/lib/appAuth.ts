const APP_TOKEN_KEY = "app_token";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const MEMBER_SESSION_KEYS = [
  "member_user_id",
  "member_member_id",
  "member_name",
  "member_phone_number",
  "member_login_time",
];

export function getSupabaseBaseUrl(value: string | null | undefined = SUPABASE_URL): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";

  try {
    const parsed = new URL(raw.replace(/\/+$/, ""));
    const host = parsed.hostname.toLowerCase();
    const isAllowedHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host.endsWith(".supabase.co") ||
      host.endsWith(".supabase.com");

    return isAllowedHost ? parsed.origin : "";
  } catch {
    return "";
  }
}

export function buildSupabaseFunctionUrl(functionName: string): string {
  const baseUrl = getSupabaseBaseUrl();
  if (!baseUrl) {
    throw new Error(
      "Supabase project URL is missing or invalid. Use the project URL such as https://<project-ref>.supabase.co, not the root dashboard URL."
    );
  }

  const safeFunctionName = String(functionName ?? "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+/, "/");

  if (!safeFunctionName) {
    throw new Error("Supabase function name is missing.");
  }

  return `${baseUrl}/functions/v1/${safeFunctionName}`;
}

export function getAppToken(): string | null {
  return localStorage.getItem(APP_TOKEN_KEY) || localStorage.getItem("token");
}

export function setAppToken(token: string): void {
  localStorage.setItem(APP_TOKEN_KEY, token);
  // Backward compatibility for existing guards that still read `token`.
  localStorage.setItem("token", token);
}

export function clearAppToken(): void {
  localStorage.removeItem(APP_TOKEN_KEY);
  localStorage.removeItem("token");
}

export function clearMemberSession(): void {
  clearAppToken();
  for (const key of MEMBER_SESSION_KEYS) {
    localStorage.removeItem(key);
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isAppTokenExpired(token: string | null): boolean {
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  if (!payload) return true;
  const exp = Number(payload.exp || 0);
  if (!exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return exp <= now;
}

/**
 * Audit stamp for transaction metadata: links a human-initiated write to the
 * current login session (sid) and actor (sub). The DB audit trigger copies
 * these into audit_logs. Returns {} when no valid session exists.
 */
export function auditStamp(): Record<string, string> {
  const token = getAppToken();
  if (!token || isAppTokenExpired(token)) return {};
  const payload = decodeJwtPayload(token);
  if (!payload) return {};
  const stamp: Record<string, string> = {};
  if (payload.sid) stamp.session_id = String(payload.sid);
  if (payload.sub) stamp.actor_user_id = String(payload.sub);
  return stamp;
}

export function normalizePhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.length === 9 && digits.startsWith("7")) return `254${digits}`;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  return digits;
}

async function readFunctionErrorMessage(context: unknown): Promise<string> {
  if (!context || typeof context !== "object") return "";
  const cloneFn = (context as { clone?: unknown }).clone;
  if (typeof cloneFn !== "function") return "";

  try {
    const cloned = (context as { clone: () => Response }).clone();
    const rawText = (await cloned.text().catch(() => "")).trim();
    if (!rawText) return "";

    try {
      const payload = JSON.parse(rawText) as Record<string, unknown>;
      const errorValue = payload?.error || payload?.message;
      const message =
        typeof errorValue === "string"
          ? errorValue.trim()
          : errorValue && typeof errorValue === "object"
            ? JSON.stringify(errorValue)
            : String(errorValue || "").trim();
      if (message) return message;
    } catch {
      // Non-JSON payloads can still carry useful text (e.g. gateway/internal errors).
    }

    return rawText;
  } catch {
    return "";
  }
}

export async function invokeWithAppToken<T = unknown>(
  functionName: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const token = getAppToken();
  if (!token || isAppTokenExpired(token)) {
    clearMemberSession();
    throw new Error("Session expired. Please login again.");
  }

  const baseUrl = getSupabaseBaseUrl(SUPABASE_URL);
  if (!baseUrl || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Missing or invalid Supabase configuration. Use the project URL like https://<project-ref>.supabase.co, not the root dashboard URL."
    );
  }

  const functionUrl = buildSupabaseFunctionUrl(functionName);

  const response = await fetch(functionUrl, {
    method: "POST",
    credentials: "omit",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "x-app-token": token,
    },
    body: JSON.stringify(body ?? {}),
  });

  const responseText = await response.text().catch(() => "");
  const responseContext = new Response(responseText, {
    status: response.status,
    headers: response.headers,
  });

  if (!response.ok) {
    const backendMessage = await readFunctionErrorMessage(responseContext);
    const combinedAuthMessage = ` ${backendMessage || responseText}`.toLowerCase();
    const isSessionExpired =
      response.status === 401 &&
      /session expired|jwt expired|invalid token|missing bearer token|unauthorized or invalid request|signature verification|verification failed/.test(combinedAuthMessage);
    if (isSessionExpired) {
      clearMemberSession();
      throw new Error("Session expired. Please login again.");
    }

    if (
      response.status === 401 &&
      !backendMessage &&
      /unexpected end of json input/i.test(responseText)
    ) {
      throw new Error("Unauthorized request to function. Please log in again and retry.");
    }

    if (
      response.status >= 500 &&
      !backendMessage &&
      /unexpected end of json input/i.test(responseText)
    ) {
      throw new Error(`Server error in ${functionName}. Please try again shortly.`);
    }

    if (
      /unexpected end of json input/i.test(responseText) ||
      /unexpected end of json input/i.test(backendMessage)
    ) {
      throw new Error(`Server error in ${functionName}. The function returned an empty or invalid response.`);
    }

    throw new Error(backendMessage || responseText || "Request failed");
  }

  if (!responseText) {
    return undefined as T;
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new Error(`Server error in ${functionName}. The function returned an invalid JSON response.`);
  }
}
