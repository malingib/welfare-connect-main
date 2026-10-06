import { invokeWithAppToken } from '@/lib/appAuth';
import { UserRole } from '@/lib/types';

export interface AdminUserRow {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: UserRole;
  member_id: string | null;
  phone_number?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const res = await invokeWithAppToken<{ users: AdminUserRow[] }>('api-users-admin', {
    action: 'list',
  });
  return res.users || [];
}

export async function updateAdminUserStatus(userId: string, isActive: boolean): Promise<void> {
  await invokeWithAppToken('api-users-admin', {
    action: 'update_status',
    user_id: userId,
    is_active: isActive,
  });
}

export async function updateAdminUserRole(userId: string, role: UserRole): Promise<void> {
  await invokeWithAppToken('api-users-admin', {
    action: 'update_role',
    user_id: userId,
    role,
  });
}

export async function resetAdminUserPassword(userId: string): Promise<string | null> {
  const res = await invokeWithAppToken<{ temporary_password?: string | null }>('api-users-admin', {
    action: 'reset_password',
    user_id: userId,
  });
  return res.temporary_password ?? null;
}

export async function createManagedUser(payload: {
  username: string;
  password: string;
  name: string;
  email?: string | null;
  role: UserRole;
  member_id?: string | null;
  is_active?: boolean;
}): Promise<AdminUserRow> {
  const res = await invokeWithAppToken<{ user: AdminUserRow }>('api-users-admin', {
    action: 'create',
    ...payload,
  });
  return res.user;
}

export async function deleteMemberUserLinks(memberId: string): Promise<number> {
  const res = await invokeWithAppToken<{ deleted_user_count?: number }>('api-users-admin', {
    action: 'delete_member_links',
    member_id: memberId,
  });
  return Number(res.deleted_user_count || 0);
}
