enum AdminRole {
  superAdmin,
  chairperson,
  treasurer,
  secretary,
  unknown,
}

AdminRole normalizeAdminRole(String? role) {
  switch ((role ?? '').trim().toLowerCase()) {
    case 'super_admin':
      return AdminRole.superAdmin;
    case 'chairperson':
      return AdminRole.chairperson;
    case 'treasurer':
      return AdminRole.treasurer;
    case 'secretary':
      return AdminRole.secretary;
    default:
      return AdminRole.unknown;
  }
}

bool canAccessAdminPath(String path, String? role) {
  final normalized = normalizeAdminRole(role);
  if (normalized == AdminRole.unknown) return false;

  final memberRoles = {
    AdminRole.superAdmin,
    AdminRole.chairperson,
    AdminRole.secretary
  };
  final txRoles = {
    AdminRole.superAdmin,
    AdminRole.treasurer,
    AdminRole.secretary
  };
  final financeRoles = {AdminRole.superAdmin, AdminRole.treasurer};
  final reportsRoles = {
    AdminRole.superAdmin,
    AdminRole.chairperson,
    AdminRole.treasurer,
    AdminRole.secretary
  };
  final settingsRoles = {AdminRole.superAdmin};
  final usersRoles = {AdminRole.superAdmin};

  if (path == '/admin/dashboard') return true;
  if (path == '/admin/members' ||
      path == '/admin/cases' ||
      path == '/admin/applications') {
    return memberRoles.contains(normalized);
  }
  if (path == '/admin/transactions' || path == '/admin/suspense-queue') {
    return txRoles.contains(normalized);
  }
  if (path == '/admin/accounts') return financeRoles.contains(normalized);
  if (path == '/admin/reports' ||
      path == '/admin/fiscal-reports' ||
      path == '/admin/compliance-reports') {
    return reportsRoles.contains(normalized);
  }
  if (path == '/admin/users') return usersRoles.contains(normalized);
  if (path == '/admin/settings') return settingsRoles.contains(normalized);

  return true;
}
