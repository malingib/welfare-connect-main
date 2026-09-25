import { jwtVerify, SignJWT } from "https://esm.sh/jose@5.9.6";

export type AppJwtPayload = {
  sub?: string;
  role?: string;
  member_id?: string;
  member_number?: string;
  sid?: string;
};

const ADMIN_ROLES = new Set(["super_admin", "chairperson", "treasurer", "secretary"]);
const MEMBER_MANAGEMENT_ROLES = new Set(["super_admin", "chairperson", "secretary"]);
const FINANCE_ROLES = new Set(["super_admin", "treasurer"]);
const SUPER_ADMIN_ROLE = "super_admin";

export function normalizeRole(role: string | undefined): string {
  return String(role || "").toLowerCase().trim();
}

export async function verifyAppJwtFromRequest(req: Request): Promise<AppJwtPayload> {
  const appTokenHeader = req.headers.get("x-app-token") || "";
  if (appTokenHeader) {
    const appJwtSecret = Deno.env.get("APP_JWT_SECRET");
    if (!appJwtSecret) {
      throw new Error("APP_JWT_SECRET is not configured");
    }
    const verified = await jwtVerify(appTokenHeader, new TextEncoder().encode(appJwtSecret));
    return verified.payload as AppJwtPayload;
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    throw new Error("Missing bearer token");
  }

  const appJwtSecret = Deno.env.get("APP_JWT_SECRET");
  if (!appJwtSecret) {
    throw new Error("APP_JWT_SECRET is not configured");
  }

  const verified = await jwtVerify(token, new TextEncoder().encode(appJwtSecret));
  return verified.payload as AppJwtPayload;
}

export async function signAppJwt(payload: AppJwtPayload, expiresIn: string = "5m"): Promise<string> {
  const appJwtSecret = Deno.env.get("APP_JWT_SECRET");
  if (!appJwtSecret) {
    throw new Error("APP_JWT_SECRET is not configured");
  }

  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(appJwtSecret));
}

export function requirePrivilegedRole(role: string | undefined): void {
  if (!ADMIN_ROLES.has(normalizeRole(role))) {
    throw new Error("Forbidden");
  }
}

export function requireMemberManagementRole(role: string | undefined): void {
  if (!MEMBER_MANAGEMENT_ROLES.has(normalizeRole(role))) {
    throw new Error("Forbidden");
  }
}

export function requireFinanceRole(role: string | undefined): void {
  if (!FINANCE_ROLES.has(normalizeRole(role))) {
    throw new Error("Forbidden");
  }
}

export function requireSuperAdminRole(role: string | undefined): void {
  if (normalizeRole(role) !== SUPER_ADMIN_ROLE) {
    throw new Error("Forbidden");
  }
}
