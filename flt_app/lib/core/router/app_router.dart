import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/login_screen.dart';
import '../../features/admin/admin_dashboard_screen.dart';
import '../../features/admin/admin_members_screen.dart';
import '../../features/admin/admin_cases_screen.dart';
import '../../features/admin/admin_transactions_screen.dart';
import '../../features/admin/admin_settings_screen.dart';
import '../../features/admin/suspense_queue_screen.dart';
import '../../features/admin/admin_reports_screen.dart';
import '../../features/admin/admin_users_screen.dart';
import '../../features/admin/admin_member_details_screen.dart';
import '../../features/admin/admin_case_details_screen.dart';
import '../../features/admin/admin_accounts_screen.dart';
import '../../features/admin/admin_fiscal_reports_screen.dart';
import '../../features/admin/admin_compliance_reports_screen.dart';
import '../../features/member/wallet_screen.dart';
import '../../features/member/dashboard_screen.dart';
import '../../features/member/summary_screen.dart';
import '../../features/member/cases_screen.dart';
import '../../features/member/payments_screen.dart';
import '../../features/member/transactions_screen.dart';
import '../../features/member/report_screen.dart';
import '../../features/member/dependants_screen.dart';
import '../../features/auth/auth_controller.dart';
import '../auth/role_access.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authControllerProvider);

  return GoRouter(
    initialLocation: '/login',
    debugLogDiagnostics: kDebugMode,
    redirect: (context, state) {
      final isLoggedIn = authState.isAuthenticated;
      final isLoginRoute = state.matchedLocation == '/login';
      final isAdminRoute = state.matchedLocation.startsWith('/admin');

      if (!isLoggedIn) {
        return isLoginRoute ? null : '/login';
      }

      if (isLoginRoute) {
        return authState.isAdmin ? '/admin/dashboard' : '/member/dashboard';
      }

      if (isAdminRoute && !authState.isAdmin) {
        return '/member/dashboard';
      }
      if (isAdminRoute &&
          !canAccessAdminPath(state.matchedLocation, authState.role)) {
        return '/admin/dashboard';
      }

      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(
          path: '/admin/dashboard',
          builder: (context, state) => const AdminDashboardScreen()),
      GoRoute(
          path: '/admin/suspense-queue',
          builder: (context, state) => const SuspenseQueueScreen()),
      GoRoute(
          path: '/admin/members',
          builder: (context, state) => const AdminMembersScreen()),
      GoRoute(
          path: '/admin/cases',
          builder: (context, state) => const AdminCasesScreen()),
      GoRoute(
          path: '/admin/transactions',
          builder: (context, state) => const AdminTransactionsScreen()),
      GoRoute(
          path: '/admin/settings',
          builder: (context, state) => const AdminSettingsScreen()),
      GoRoute(
          path: '/admin/reports',
          builder: (context, state) => const AdminReportsScreen()),
      GoRoute(
          path: '/admin/users',
          builder: (context, state) => const AdminUsersScreen()),
      GoRoute(
          path: '/admin/accounts',
          builder: (context, state) => const AdminAccountsScreen()),
      GoRoute(
          path: '/admin/fiscal-reports',
          builder: (context, state) => const AdminFiscalReportsScreen()),
      GoRoute(
          path: '/admin/compliance-reports',
          builder: (context, state) => const AdminComplianceReportsScreen()),
      GoRoute(
          path: '/admin/members/:memberId',
          builder: (context, state) => AdminMemberDetailsScreen(
              memberId: state.pathParameters['memberId'] ?? '')),
      GoRoute(
          path: '/admin/cases/:caseId',
          builder: (context, state) => AdminCaseDetailsScreen(
              caseId: state.pathParameters['caseId'] ?? '')),
      GoRoute(
          path: '/member/dashboard',
          builder: (context, state) => const MemberDashboardScreen()),
      GoRoute(
          path: '/member/wallet',
          builder: (context, state) => const WalletScreen()),
      GoRoute(
          path: '/member/cases',
          builder: (context, state) => const CasesScreen()),
      GoRoute(
          path: '/member/payments',
          builder: (context, state) => const PaymentsScreen()),
      GoRoute(
          path: '/member/transactions',
          builder: (context, state) => const MemberTransactionsScreen()),
      GoRoute(
          path: '/member/summary',
          builder: (context, state) => const MemberSummaryScreen()),
      GoRoute(
          path: '/member/report',
          builder: (context, state) => const MemberReportScreen()),
      GoRoute(
          path: '/member/dependants',
          builder: (context, state) => const DependantsScreen()),
      GoRoute(
          path: '/transactions', redirect: (_, __) => '/member/transactions'),
      GoRoute(
          path: '/member/transaction',
          redirect: (_, __) => '/member/transactions'),
    ],
    errorBuilder: (context, state) => Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 64, color: Colors.red),
            const SizedBox(height: 16),
            Text('Page not found',
                style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 8),
            Text(state.error?.toString() ?? 'Unknown error'),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => context.go(
                authState.isAuthenticated
                    ? (authState.isAdmin
                        ? '/admin/dashboard'
                        : '/member/dashboard')
                    : '/login',
              ),
              child: const Text('Go Home'),
            ),
          ],
        ),
      ),
    ),
  );
});
