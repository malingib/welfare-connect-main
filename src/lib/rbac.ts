import { UserRole } from './types';

export const ADMIN_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.CHAIRPERSON,
  UserRole.TREASURER,
  UserRole.SECRETARY,
];

// Treat chairperson as secretary-equivalent for backward compatibility.
export const MEMBER_MANAGEMENT_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.CHAIRPERSON,
  UserRole.SECRETARY,
];

export const FINANCE_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.TREASURER,
];

export const TRANSACTION_VIEW_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.TREASURER,
  UserRole.SECRETARY,
];

export const REPORTS_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.CHAIRPERSON,
  UserRole.TREASURER,
  UserRole.SECRETARY,
];

export const COMPLIANCE_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.CHAIRPERSON,
  UserRole.TREASURER,
  UserRole.SECRETARY,
];

export const SETTINGS_ROLES: UserRole[] = [UserRole.SUPER_ADMIN];
export const USER_MANAGEMENT_ROLES: UserRole[] = [UserRole.SUPER_ADMIN];

const ROUTE_ACCESS_RULES: Array<{ matcher: RegExp; roles: UserRole[] }> = [
  { matcher: /^\/dashboard$/, roles: ADMIN_ROLES },
  { matcher: /^\/members$/, roles: MEMBER_MANAGEMENT_ROLES },
  { matcher: /^\/applications$/, roles: MEMBER_MANAGEMENT_ROLES },
  { matcher: /^\/members\/new$/, roles: MEMBER_MANAGEMENT_ROLES },
  { matcher: /^\/members\/[^/]+$/, roles: MEMBER_MANAGEMENT_ROLES },
  { matcher: /^\/cases$/, roles: MEMBER_MANAGEMENT_ROLES },
  { matcher: /^\/cases\/new$/, roles: MEMBER_MANAGEMENT_ROLES },
  { matcher: /^\/cases\/[^/]+$/, roles: MEMBER_MANAGEMENT_ROLES },
  { matcher: /^\/cases\/[^/]+\/edit$/, roles: MEMBER_MANAGEMENT_ROLES },
  { matcher: /^\/transactions$/, roles: TRANSACTION_VIEW_ROLES },
  { matcher: /^\/accounts$/, roles: FINANCE_ROLES },
  { matcher: /^\/reports$/, roles: REPORTS_ROLES },
  { matcher: /^\/reports\/fiscal$/, roles: FINANCE_ROLES },
  { matcher: /^\/reports\/compliance$/, roles: COMPLIANCE_ROLES },
  { matcher: /^\/users$/, roles: USER_MANAGEMENT_ROLES },
  { matcher: /^\/settings$/, roles: SETTINGS_ROLES },
];

export function normalizeRole(role: string | null | undefined): UserRole | null {
  if (!role) return null;
  return role.toLowerCase() as UserRole;
}

export function getAllowedRolesForPath(pathname: string): UserRole[] {
  const match = ROUTE_ACCESS_RULES.find((rule) => rule.matcher.test(pathname));
  return match?.roles || ADMIN_ROLES;
}

export function canAccessPath(pathname: string, role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return getAllowedRolesForPath(pathname).includes(role);
}
