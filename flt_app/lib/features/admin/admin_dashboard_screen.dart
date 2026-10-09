import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/services/live_data_service.dart';
import '../auth/auth_controller.dart';
import 'admin_shell.dart';

class AdminDashboardScreen extends ConsumerStatefulWidget {
  const AdminDashboardScreen({super.key});

  @override
  ConsumerState<AdminDashboardScreen> createState() =>
      _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends ConsumerState<AdminDashboardScreen> {
  final _service = LiveDataService();
  late Future<AdminDashboardSnapshot> _future;
  ProviderSubscription<AuthState>? _authSub;
  String? _lastToken;

  @override
  void initState() {
    super.initState();
    _lastToken = ref.read(authControllerProvider).appToken;
    _future = _loadDashboard();
    _authSub = ref.listenManual<AuthState>(authControllerProvider, (_, next) {
      final token = next.appToken;
      if (token == null || token.isEmpty || token == _lastToken) return;
      _lastToken = token;
      if (!mounted) return;
      setState(() => _future = _loadDashboard());
    });
  }

  @override
  void dispose() {
    _authSub?.close();
    super.dispose();
  }

  Future<void> _refresh() async {
    setState(() => _future = _loadDashboard());
    await _future;
  }

  Future<AdminDashboardSnapshot> _loadDashboard() {
    final token = ref.read(authControllerProvider).appToken;
    return _service.fetchAdminDashboard(appToken: token);
  }

  @override
  Widget build(BuildContext context) {
    final money = NumberFormat.currency(
      locale: 'en_KE',
      symbol: 'KES ',
      decimalDigits: 2,
    );

    return AdminShell(
      title: 'Admin Dashboard',
      route: '/admin/dashboard',
      actions: [
        IconButton(
          onPressed: () => context.go('/admin/settings'),
          icon: const Icon(Icons.settings),
        ),
        IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh)),
      ],
      body: FutureBuilder<AdminDashboardSnapshot>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text(snapshot.error.toString()));
          }

          final data = snapshot.data!;
          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF0F172A), Color(0xFF1F3556)],
                  ),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Operations Overview',
                      style: TextStyle(
                        color: Colors.white70,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      '${data.totalMembers} members • ${data.activeCases} active cases',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      'Contributions total: ${money.format(data.totalContributions)}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Suspense total: ${money.format(data.pendingSuspenseTotal)}',
                      style: const TextStyle(
                        color: Color(0xFFBFDBFE),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                crossAxisSpacing: 10,
                mainAxisSpacing: 10,
                physics: const NeverScrollableScrollPhysics(),
                childAspectRatio: 1.45,
                children: [
                  _StatTile(
                    title: 'Total Members',
                    value: '${data.totalMembers}',
                    icon: Icons.group,
                    tint: const Color(0xFFDBEAFE),
                  ),
                  _StatTile(
                    title: 'Active Cases',
                    value: '${data.activeCases}',
                    icon: Icons.assignment_turned_in,
                    tint: const Color(0xFFDCFCE7),
                  ),
                  _StatTile(
                    title: 'Suspense Amount',
                    value: money.format(data.pendingSuspenseTotal),
                    icon: Icons.account_balance_wallet,
                    tint: const Color(0xFFFFEDD5),
                  ),
                  _StatTile(
                    title: 'Suspense Items',
                    value: '${data.pendingSuspenseCount}',
                    icon: Icons.pending_actions,
                    tint: const Color(0xFFF1F5F9),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Recent Activity',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                  TextButton(
                    onPressed: () => context.go('/admin/transactions'),
                    child: const Text('View ledger'),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              ...data.recentActivity.map((a) {
                final createdAt = DateTime.tryParse('${a['created_at']}');
                final amount = (a['amount'] as num?)?.toDouble() ?? 0;
                return Card(
                  margin: const EdgeInsets.only(bottom: 10),
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                    side: const BorderSide(color: Color(0xFFE2E8F0)),
                  ),
                  child: ListTile(
                    title: Text(
                      '${a['description'] ?? a['transaction_type'] ?? 'Activity'}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(createdAt == null
                        ? '-'
                        : DateFormat('MMM d, yyyy • h:mm a')
                            .format(createdAt.toLocal())),
                    trailing: Text(
                      money.format(amount.abs()),
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                );
              }),
            ],
          );
        },
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color tint;

  const _StatTile({
    required this.title,
    required this.value,
    required this.icon,
    required this.tint,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: tint,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 18, color: const Color(0xFF1F3556)),
          ),
          Text(
            value,
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          Text(
            title,
            style: const TextStyle(
              color: Color(0xFF64748B),
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
