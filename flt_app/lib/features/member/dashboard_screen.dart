import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/services/live_data_service.dart';
import '../auth/auth_controller.dart';
import 'member_shell.dart';

class MemberDashboardScreen extends ConsumerStatefulWidget {
  const MemberDashboardScreen({super.key});

  @override
  ConsumerState<MemberDashboardScreen> createState() =>
      _MemberDashboardScreenState();
}

class _MemberDashboardScreenState extends ConsumerState<MemberDashboardScreen> {
  final LiveDataService _service = LiveDataService();
  late Future<MemberWalletSnapshot> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<MemberWalletSnapshot> _load() async {
    final auth = ref.read(authControllerProvider);
    if ((auth.memberId ?? '').isEmpty || (auth.appToken ?? '').isEmpty) {
      throw Exception('Missing member session');
    }
    return _service.fetchMemberWalletData(
      memberId: auth.memberId!,
      appToken: auth.appToken!,
    );
  }

  @override
  Widget build(BuildContext context) {
    final money = NumberFormat.currency(locale: 'en_KE', symbol: 'KES ');
    final auth = ref.watch(authControllerProvider);

    return MemberShell(
      title: 'Dashboard',
      subtitle: auth.memberName ?? 'Member portal',
      currentIndex: 0,
      body: FutureBuilder<MemberWalletSnapshot>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text('Failed to load dashboard: ${snapshot.error}'),
              ),
            );
          }

          final data = snapshot.data!;
          return RefreshIndicator(
            onRefresh: () async => setState(() => _future = _load()),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    _tile('Wallet Balance', money.format(data.walletBalance)),
                    _tile('Unpaid Cases', '${data.unpaidCasesCount}'),
                    _tile('Arrears Total', money.format(data.arrearsTotal)),
                    _tile('Penalty Total', money.format(data.penaltyTotal)),
                  ],
                ),
                const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: [
                        _action(context, 'Wallet', '/member/wallet'),
                        _action(context, 'Cases', '/member/cases'),
                        _action(
                            context, 'Transactions', '/member/transactions'),
                        _action(context, 'Payments', '/member/payments'),
                        _action(context, 'Dependants', '/member/dependants'),
                        _action(context, 'Report', '/member/report'),
                        _action(context, 'Profile', '/member/summary'),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Recent Activity',
                          style: TextStyle(
                              fontWeight: FontWeight.w700, fontSize: 16),
                        ),
                        const SizedBox(height: 8),
                        if (data.recentTransactions.isEmpty)
                          const Text('No transactions found.')
                        else
                          ...data.recentTransactions.take(5).map((tx) {
                            final date =
                                DateTime.tryParse('${tx['created_at']}');
                            return ListTile(
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              title: Text(
                                '${tx['description'] ?? tx['transaction_type'] ?? '-'}',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              subtitle: Text(date == null
                                  ? '${tx['transaction_type'] ?? '-'}'
                                  : DateFormat('MMM d, yyyy • h:mm a')
                                      .format(date.toLocal())),
                              trailing: ConstrainedBox(
                                constraints:
                                    const BoxConstraints(maxWidth: 112),
                                child: FittedBox(
                                  fit: BoxFit.scaleDown,
                                  alignment: Alignment.centerRight,
                                  child: Text(
                                    money.format(_toDouble(tx['amount']).abs()),
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w700),
                                  ),
                                ),
                              ),
                            );
                          }),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _tile(String label, String value) {
    return SizedBox(
      width: 220,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(color: Colors.black54)),
              const SizedBox(height: 6),
              Text(value,
                  style: const TextStyle(
                      fontWeight: FontWeight.bold, fontSize: 18)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _action(BuildContext context, String label, String route) {
    return OutlinedButton(
      onPressed: () => context.go(route),
      child: Text(label),
    );
  }

  double _toDouble(dynamic value) {
    if (value == null) return 0;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString()) ?? 0;
  }
}
