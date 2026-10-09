import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../auth/auth_controller.dart';
import '../../core/widgets/notification_bell.dart';

class MemberShell extends ConsumerWidget {
  final String title;
  final String? subtitle;
  final int currentIndex;
  final Widget body;
  final List<Widget>? actions;

  const MemberShell({
    super.key,
    required this.title,
    this.subtitle,
    required this.currentIndex,
    required this.body,
    this.actions,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final expanded = MediaQuery.sizeOf(context).width >= 840;
    const destinations = <NavigationDestination>[
      NavigationDestination(
          icon: Icon(Icons.account_balance_wallet_outlined), label: 'Wallet'),
      NavigationDestination(
          icon: Icon(Icons.assignment_outlined), label: 'Cases'),
      NavigationDestination(
          icon: Icon(Icons.receipt_long_outlined), label: 'Transactions'),
      NavigationDestination(
          icon: Icon(Icons.payments_outlined), label: 'Payments'),
    ];
    const railDestinations = <NavigationRailDestination>[
      NavigationRailDestination(
          icon: Icon(Icons.account_balance_wallet_outlined),
          label: Text('Wallet')),
      NavigationRailDestination(
          icon: Icon(Icons.assignment_outlined), label: Text('Cases')),
      NavigationRailDestination(
          icon: Icon(Icons.receipt_long_outlined), label: Text('Transactions')),
      NavigationRailDestination(
          icon: Icon(Icons.payments_outlined), label: Text('Payments')),
    ];
    return Scaffold(
      backgroundColor: const Color(0xFFF6F8FB),
      appBar: AppBar(
        toolbarHeight: 72,
        titleSpacing: 18,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              title,
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 24),
            ),
            if (subtitle != null)
              Text(
                subtitle!,
                style: const TextStyle(
                  color: Color(0xFFCAD6E6),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
          ],
        ),
        flexibleSpace: Container(color: const Color(0xFF1F3556)),
        foregroundColor: Colors.white,
        actions: [
          const NotificationBell(),
          ...?actions,
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert, color: Colors.white),
            onSelected: (v) {
              if (v == 'dashboard') context.go('/member/dashboard');
              if (v == 'summary') context.go('/member/summary');
              if (v == 'dependants') context.go('/member/dependants');
              if (v == 'report') context.go('/member/report');
              if (v == 'logout') {
                ref.read(authControllerProvider.notifier).logout();
                context.go('/login');
              }
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'dashboard', child: Text('Dashboard')),
              PopupMenuItem(value: 'summary', child: Text('My Profile')),
              PopupMenuItem(value: 'dependants', child: Text('Dependants')),
              PopupMenuItem(value: 'report', child: Text('My Report')),
              PopupMenuItem(value: 'logout', child: Text('Logout')),
            ],
          ),
        ],
      ),
      body: Row(children: [
        if (expanded)
          NavigationRail(
            selectedIndex: currentIndex < 0 ? null : currentIndex,
            labelType: NavigationRailLabelType.all,
            onDestinationSelected: (index) => _goToDestination(context, index),
            destinations: railDestinations,
          ),
        Expanded(
          child: Align(
            alignment: Alignment.topCenter,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1120),
              child: body,
            ),
          ),
        ),
      ]),
      bottomNavigationBar: expanded
          ? null
          : NavigationBar(
              selectedIndex: currentIndex < 0 ? 0 : currentIndex,
              indicatorColor: currentIndex < 0 ? Colors.transparent : null,
              onDestinationSelected: (index) =>
                  _goToDestination(context, index),
              destinations: destinations,
            ),
    );
  }

  void _goToDestination(BuildContext context, int index) {
    switch (index) {
      case 0:
        context.go('/member/wallet');
        break;
      case 1:
        context.go('/member/cases');
        break;
      case 2:
        context.go('/member/transactions');
        break;
      case 3:
        context.go('/member/payments');
        break;
    }
  }
}
