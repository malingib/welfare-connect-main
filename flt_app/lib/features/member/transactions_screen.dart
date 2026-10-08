import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/constants/app_constants.dart';
import '../../core/services/live_data_service.dart';
import '../../core/widgets/async_error_view.dart';
import '../auth/auth_controller.dart';
import 'member_shell.dart';

class MemberTransactionsScreen extends ConsumerStatefulWidget {
  const MemberTransactionsScreen({super.key});

  @override
  ConsumerState<MemberTransactionsScreen> createState() =>
      _MemberTransactionsScreenState();
}

class _MemberTransactionsScreenState
    extends ConsumerState<MemberTransactionsScreen> {
  final _service = LiveDataService();
  late Future<List<Map<String, dynamic>>> _future;
  final _searchCtrl = TextEditingController();
  String _typeFilter = 'all';
  String _statusFilter = 'all';

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<List<Map<String, dynamic>>> _load() {
    final auth = ref.read(authControllerProvider);
    if ((auth.memberId ?? '').isEmpty || (auth.appToken ?? '').isEmpty) {
      throw Exception('Session missing member identity. Please log in again.');
    }
    return _service.fetchMemberTransactions(
      memberId: auth.memberId!,
      appToken: auth.appToken!,
      pageSize: 200,
    );
  }

  @override
  Widget build(BuildContext context) {
    final money = NumberFormat.currency(
        locale: 'en_KE', symbol: 'KES ', decimalDigits: 2);

    return MemberShell(
      title: 'Transactions',
      subtitle: 'Ledger view',
      currentIndex: 2,
      actions: [
        IconButton(
            onPressed: () => setState(() => _future = _load()),
            icon: const Icon(Icons.refresh)),
      ],
      body: FutureBuilder<List<Map<String, dynamic>>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return AsyncErrorView(error: snapshot.error, onRetry: () => setState(() => _future = _load()));
          }

          final items = snapshot.data ?? const <Map<String, dynamic>>[];
          final search = _searchCtrl.text.trim().toLowerCase();
          final filtered = items.where((tx) {
            final type = '${tx['transaction_type'] ?? ''}'.toLowerCase();
            final status = '${tx['status'] ?? ''}'.toLowerCase();
            final desc = '${tx['description'] ?? ''}'.toLowerCase();
            if (_typeFilter != 'all' && type != _typeFilter) return false;
            if (_statusFilter != 'all' && status != _statusFilter) return false;
            if (search.isEmpty) return true;
            return type.contains(search) || desc.contains(search);
          }).toList();

          double totalCredit = 0;
          double totalDebit = 0;
          for (final tx in items) {
            final status = '${tx['status'] ?? ''}'.toLowerCase();
            if (status.isNotEmpty && status != 'completed') continue;
            final type = '${tx['transaction_type'] ?? ''}'.toLowerCase();
            final amount = _toDouble(tx['amount']).abs();
            if (type == 'wallet_funding' ||
                type == 'deposit' ||
                type == 'contribution_refund' ||
                type == 'case_wallet_refund') {
              totalCredit += amount;
            } else if (type == 'contribution' ||
                type == 'case_wallet_deduction' ||
                type == 'arrears' ||
                type == 'penalty' ||
                type == 'registration' ||
                type == 'renewal' ||
                type == 'disbursement') {
              totalDebit += amount;
            }
          }

          return ListView(
            padding: const EdgeInsets.all(AppConstants.marginEdge),
            children: [
              LayoutBuilder(
                builder: (context, constraints) {
                  final columns = constraints.maxWidth >= 640
                      ? 3
                      : constraints.maxWidth >= 360
                          ? 2
                          : 1;
                  final width =
                      (constraints.maxWidth - ((columns - 1) * 8)) / columns;
                  return Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _stat('Total', '${items.length}'),
                      _stat('Credits', money.format(totalCredit)),
                      _stat('Debits', money.format(totalDebit)),
                    ]
                        .map((child) => SizedBox(width: width, child: child))
                        .toList(),
                  );
                },
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _searchCtrl,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  hintText: 'Search description/type',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _searchCtrl.text.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.clear),
                          onPressed: () {
                            _searchCtrl.clear();
                            setState(() {});
                          },
                        ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _typeFilter,
                      items: const [
                        DropdownMenuItem(
                            value: 'all', child: Text('All types')),
                        DropdownMenuItem(
                            value: 'wallet_funding',
                            child: Text('Wallet funding')),
                        DropdownMenuItem(
                            value: 'contribution', child: Text('Contribution')),
                        DropdownMenuItem(
                            value: 'case_wallet_deduction',
                            child: Text('Case deduction')),
                        DropdownMenuItem(
                            value: 'arrears', child: Text('Arrears')),
                        DropdownMenuItem(
                            value: 'penalty', child: Text('Penalty')),
                      ],
                      onChanged: (v) =>
                          setState(() => _typeFilter = v ?? 'all'),
                      decoration: const InputDecoration(
                        labelText: 'Type',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _statusFilter,
                      items: const [
                        DropdownMenuItem(
                            value: 'all', child: Text('All statuses')),
                        DropdownMenuItem(
                            value: 'completed', child: Text('Completed')),
                        DropdownMenuItem(
                            value: 'pending', child: Text('Pending')),
                        DropdownMenuItem(
                            value: 'reversed', child: Text('Reversed')),
                        DropdownMenuItem(
                            value: 'failed', child: Text('Failed')),
                      ],
                      onChanged: (v) =>
                          setState(() => _statusFilter = v ?? 'all'),
                      decoration: const InputDecoration(
                        labelText: 'Status',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              if (filtered.isEmpty)
                const Center(
                    child: Padding(
                  padding: EdgeInsets.all(20),
                  child: Text('No transactions match current filters.'),
                ))
              else
                ...filtered.map((tx) {
                  final createdAt = DateTime.tryParse('${tx['created_at']}');
                  final amount = _toDouble(tx['amount']);
                  final absAmount = amount.abs();
                  final type = '${tx['transaction_type'] ?? 'transaction'}';
                  final status = '${tx['status'] ?? '-'}';
                  final description = '${tx['description'] ?? ''}'.trim();
                  final isCredit = _isCredit(type);

                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFFDCE3EE)),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          flex: 4,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                  description.isEmpty
                                      ? type.replaceAll('_', ' ')
                                      : description,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w600)),
                              const SizedBox(height: 4),
                              Text(
                                createdAt == null
                                    ? '-'
                                    : DateFormat('MMM d, yyyy • h:mm a')
                                        .format(createdAt.toLocal()),
                                style: const TextStyle(
                                    color: Color(0xFF5E6B7A), fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        Flexible(
                          flex: 2,
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 150),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                FittedBox(
                                  fit: BoxFit.scaleDown,
                                  alignment: Alignment.centerRight,
                                  child: Text(
                                    '${isCredit ? '+' : '-'}${money.format(absAmount)}',
                                    maxLines: 1,
                                    style: TextStyle(
                                      fontWeight: FontWeight.w700,
                                      color: isCredit
                                          ? const Color(0xFF0A7C2F)
                                          : const Color(0xFFB34700),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: _statusColor(status),
                                    borderRadius: BorderRadius.circular(999),
                                  ),
                                  child: Text(
                                    status.toUpperCase(),
                                    style: const TextStyle(
                                        fontSize: 10,
                                        fontWeight: FontWeight.w700),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  );
                }),
            ],
          );
        },
      ),
    );
  }

  Widget _stat(String label, String value) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFDCE3EE)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 12)),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }

  double _toDouble(dynamic value) {
    if (value == null) return 0;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString()) ?? 0;
  }

  bool _isCredit(String type) {
    final t = type.toLowerCase();
    return t == 'wallet_funding' ||
        t == 'deposit' ||
        t == 'contribution_refund' ||
        t == 'case_wallet_refund';
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'completed':
        return const Color(0xFFE8F5ED);
      case 'pending':
        return const Color(0xFFFFF1EA);
      case 'reversed':
        return const Color(0xFFEAEFF5);
      case 'failed':
      case 'cancelled':
      case 'canceled':
      case 'error':
        return const Color(0xFFFFE8E8);
      default:
        return const Color(0xFFF0F2F5);
    }
  }
}
