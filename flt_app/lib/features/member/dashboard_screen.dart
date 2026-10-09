import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/services/live_data_service.dart';
import '../../core/widgets/async_error_view.dart';
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
      currentIndex: -1,
      body: FutureBuilder<MemberWalletSnapshot>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return AsyncErrorView(
                error: snapshot.error,
                onRetry: () => setState(() => _future = _load()));
          }

          final data = snapshot.data!;
          final name = (auth.memberName ?? '').trim().split(' ').first;
          return RefreshIndicator(
            onRefresh: () async => setState(() => _future = _load()),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 28),
              children: [
                Text(
                  name.isEmpty ? 'Welcome back' : 'Hello, $name',
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: 4),
                Text('Here’s your membership at a glance',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        )),
                const SizedBox(height: 20),
                _balancePanel(context, money.format(data.walletBalance)),
                const SizedBox(height: 24),
                Text('Your account',
                    style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 12),
                _accountFacts(context, data, money),
                const SizedBox(height: 26),
                Text('Quick access',
                    style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 12),
                _quickAccess(context),
                const SizedBox(height: 28),
                Row(
                  children: [
                    Expanded(
                      child: Text('Recent activity',
                          style: Theme.of(context).textTheme.titleLarge),
                    ),
                    TextButton.icon(
                      onPressed: () => context.go('/member/transactions'),
                      icon: const Icon(Icons.arrow_forward, size: 18),
                      label: const Text('All activity'),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                if (data.recentTransactions.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 20),
                    child: Text('No transactions found.',
                        style: Theme.of(context).textTheme.bodyMedium),
                  )
                else
                  ...data.recentTransactions.take(5).map((tx) {
                    final date = DateTime.tryParse('${tx['created_at']}');
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: CircleAvatar(
                        backgroundColor:
                            Theme.of(context).colorScheme.secondaryContainer,
                        foregroundColor:
                            Theme.of(context).colorScheme.onSecondaryContainer,
                        child: const Icon(Icons.receipt_long_outlined),
                      ),
                      title: Text(
                        '${tx['description'] ?? tx['transaction_type'] ?? '-'}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text(date == null
                          ? '${tx['transaction_type'] ?? '-'}'
                          : DateFormat('MMM d, yyyy • h:mm a')
                              .format(date.toLocal())),
                      trailing: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 112),
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerRight,
                          child: Text(
                            money.format(_toDouble(tx['amount']).abs()),
                            style: Theme.of(context)
                                .textTheme
                                .titleSmall
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ),
                      ),
                    );
                  }),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _balancePanel(BuildContext context, String balance) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.primary,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 16, 12, 16),
        child: Row(
          children: [
            const Icon(Icons.account_balance_wallet_outlined,
                color: Colors.white, size: 22),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('Wallet balance',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            color: Colors.white,
                            fontWeight: FontWeight.w600,
                          )),
                  const SizedBox(height: 4),
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Text(balance,
                        style:
                            Theme.of(context).textTheme.headlineSmall?.copyWith(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                )),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 4),
            IconButton.filledTonal(
              tooltip: 'Open wallet',
              onPressed: () => context.go('/member/wallet'),
              style: IconButton.styleFrom(
                foregroundColor: Colors.white,
                backgroundColor: Colors.white.withValues(alpha: 0.16),
              ),
              icon: const Icon(Icons.arrow_forward),
            ),
          ],
        ),
      ),
    );
  }

  Widget _accountFacts(
      BuildContext context, MemberWalletSnapshot data, NumberFormat money) {
    return Column(
      children: [
        _factRow(context, Icons.assignment_late_outlined, 'Unpaid cases',
            '${data.unpaidCasesCount}', '/member/cases'),
        const Divider(height: 1),
        _factRow(context, Icons.account_balance_outlined, 'Arrears',
            money.format(data.arrearsTotal), '/member/wallet'),
        const Divider(height: 1),
        _factRow(context, Icons.warning_amber_rounded, 'Penalties',
            money.format(data.penaltyTotal), '/member/wallet'),
      ],
    );
  }

  Widget _factRow(BuildContext context, IconData icon, String label,
      String value, String route) {
    return Semantics(
      button: true,
      child: InkWell(
        onTap: () => context.go(route),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 14),
          child: Row(
            children: [
              Icon(icon, color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 12),
              Expanded(child: Text(label)),
              Text(value,
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(width: 4),
              const Icon(Icons.chevron_right, size: 20),
            ],
          ),
        ),
      ),
    );
  }

  Widget _quickAccess(BuildContext context) {
    const actions = [
      ('Cases', Icons.assignment_outlined, '/member/cases'),
      ('Payments', Icons.payments_outlined, '/member/payments'),
      ('Dependants', Icons.people_outline, '/member/dependants'),
      ('My report', Icons.bar_chart_outlined, '/member/report'),
      ('My profile', Icons.person_outline, '/member/summary'),
      ('Transactions', Icons.receipt_long_outlined, '/member/transactions'),
    ];
    return LayoutBuilder(builder: (context, constraints) {
      final columns = constraints.maxWidth > 600 ? 3 : 2;
      final width = (constraints.maxWidth - (columns - 1) * 12) / columns;
      return Wrap(
        spacing: 12,
        runSpacing: 12,
        children: actions
            .map((action) => SizedBox(
                  width: width,
                  child: OutlinedButton.icon(
                    onPressed: () => context.go(action.$3),
                    icon: Icon(action.$2, size: 20),
                    label: Text(action.$1, overflow: TextOverflow.ellipsis),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(56),
                      alignment: Alignment.centerLeft,
                    ),
                  ),
                ))
            .toList(),
      );
    });
  }

  double _toDouble(dynamic value) {
    if (value == null) return 0;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString()) ?? 0;
  }
}
