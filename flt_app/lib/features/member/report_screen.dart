import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/constants/app_constants.dart';
import '../../core/services/live_data_service.dart';
import '../auth/auth_controller.dart';
import 'member_shell.dart';

class MemberReportScreen extends ConsumerStatefulWidget {
  const MemberReportScreen({super.key});

  @override
  ConsumerState<MemberReportScreen> createState() => _MemberReportScreenState();
}

class _MemberReportScreenState extends ConsumerState<MemberReportScreen> {
  final _service = LiveDataService();
  late Future<_MemberReportVm> _future;
  String _typeFilter = 'all';
  String _dateFilter = '12m';
  String _search = '';

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_MemberReportVm> _load() async {
    final auth = ref.read(authControllerProvider);
    if ((auth.memberId ?? '').isEmpty || (auth.appToken ?? '').isEmpty) {
      throw Exception('Session missing member identity. Please log in again.');
    }
    final summary = await _service.buildMemberReport(
      memberId: auth.memberId!,
      appToken: auth.appToken!,
    );
    final transactions = await _service.fetchMemberTransactions(
      memberId: auth.memberId!,
      appToken: auth.appToken!,
      pageSize: 500,
    );
    return _MemberReportVm(summary: summary, transactions: transactions);
  }

  @override
  Widget build(BuildContext context) {
    final money = NumberFormat.currency(
        locale: 'en_KE', symbol: 'KES ', decimalDigits: 2);
    return MemberShell(
      title: 'My Report',
      subtitle: 'Personal financial snapshot',
      currentIndex: 0,
      actions: [
        IconButton(
            onPressed: () => setState(() => _future = _load()),
            icon: const Icon(Icons.refresh)),
      ],
      body: FutureBuilder<_MemberReportVm>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text(snapshot.error.toString()));
          }
          final vm = snapshot.data!;
          final data = vm.summary;
          final filtered = _applyFilters(vm.transactions);

          final totals = _totals(filtered);
          final totalVolume = totals.credit + totals.debit;
          final creditRatio =
              totalVolume <= 0 ? 0.0 : totals.credit / totalVolume;

          return ListView(
            padding: const EdgeInsets.all(AppConstants.marginEdge),
            children: [
              Text(
                'Financial Overview',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
              ),
              const SizedBox(height: 6),
              const Text(
                'Filter your member ledger and export a quick summary.',
                style: TextStyle(
                  color: Color(0xFF64748B),
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 12),
              Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Filters',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            initialValue: _dateFilter,
                            items: const [
                              DropdownMenuItem(
                                  value: '3m', child: Text('Last 3 months')),
                              DropdownMenuItem(
                                  value: '6m', child: Text('Last 6 months')),
                              DropdownMenuItem(
                                  value: '12m', child: Text('Last 12 months')),
                              DropdownMenuItem(
                                  value: 'all', child: Text('All time')),
                            ],
                            onChanged: (v) {
                              if (v == null) return;
                              setState(() => _dateFilter = v);
                            },
                            decoration: const InputDecoration(
                              labelText: 'Date',
                              isDense: true,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            initialValue: _typeFilter,
                            items: const [
                              DropdownMenuItem(
                                  value: 'all', child: Text('All types')),
                              DropdownMenuItem(
                                  value: 'contribution',
                                  child: Text('Contributions')),
                              DropdownMenuItem(
                                  value: 'disbursement',
                                  child: Text('Disbursements')),
                              DropdownMenuItem(
                                  value: 'wallet_funding',
                                  child: Text('Wallet funding')),
                              DropdownMenuItem(
                                  value: 'arrears', child: Text('Arrears')),
                              DropdownMenuItem(
                                  value: 'penalty', child: Text('Penalty')),
                            ],
                            onChanged: (v) {
                              if (v == null) return;
                              setState(() => _typeFilter = v);
                            },
                            decoration: const InputDecoration(
                              labelText: 'Type',
                              isDense: true,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      onChanged: (v) => setState(() => _search = v.trim()),
                      decoration: const InputDecoration(
                        isDense: true,
                        labelText: 'Search description',
                        prefixIcon: Icon(Icons.search),
                      ),
                    ),
                  ],
                ),
              ),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  _tile(
                    'Wallet Balance',
                    money.format(
                        (data['wallet_balance'] as num?)?.toDouble() ?? 0),
                    icon: Icons.account_balance_wallet,
                  ),
                  _tile(
                    'Filtered Transactions',
                    '${filtered.length}',
                    icon: Icons.filter_alt,
                  ),
                  _tile(
                    'Total Credits',
                    money.format(totals.credit),
                    icon: Icons.trending_up,
                  ),
                  _tile(
                    'Total Debits',
                    money.format(totals.debit),
                    icon: Icons.trending_down,
                  ),
                  _tile(
                    'Active Cases',
                    '${data['active_cases'] ?? 0}',
                    icon: Icons.assignment_turned_in,
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Credit vs Debit',
                        style: TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    LinearProgressIndicator(
                      value: creditRatio,
                      minHeight: 10,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    const SizedBox(height: 6),
                    Text(
                        'Credit share: ${(creditRatio * 100).toStringAsFixed(1)}%'),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () =>
                      _copyReportToClipboard(filtered, totals, data),
                  icon: const Icon(Icons.copy),
                  label: const Text('Copy report summary'),
                ),
              ),
              const SizedBox(height: 6),
              const Text('Recent filtered transactions',
                  style: TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              if (filtered.isEmpty)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: const Text(
                    'No transactions match current filters.',
                    style: TextStyle(color: Color(0xFF64748B)),
                  ),
                )
              else
                ...filtered.take(25).map((tx) {
                  final createdAt = DateTime.tryParse('${tx['created_at']}');
                  final amount = _toDouble(tx['amount']).abs();
                  final desc =
                      '${tx['description'] ?? tx['transaction_type'] ?? '-'}';
                  final status = '${tx['status'] ?? '-'}';
                  return Container(
                    margin: const EdgeInsets.only(bottom: 6),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 10),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(desc,
                                  maxLines: 2, overflow: TextOverflow.ellipsis),
                              const SizedBox(height: 4),
                              Text(
                                createdAt == null
                                    ? '-'
                                    : DateFormat('MMM d, yyyy')
                                        .format(createdAt.toLocal()),
                                style: const TextStyle(
                                    color: Color(0xFF5E6B7A), fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Text(
                                  money.format(amount),
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w700),
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                status.toUpperCase(),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 10,
                                    color: Color(0xFF5E6B7A),
                                    fontWeight: FontWeight.w600),
                              ),
                            ],
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

  void _copyReportToClipboard(
    List<Map<String, dynamic>> filtered,
    _TxTotals totals,
    Map<String, dynamic> summary,
  ) {
    final lines = <String>[
      'Malanga Welfare Member Report',
      'Generated: ${DateFormat('yyyy-MM-dd HH:mm').format(DateTime.now())}',
      'Wallet Balance: ${summary['wallet_balance'] ?? 0}',
      'Active Cases: ${summary['active_cases'] ?? 0}',
      'Filtered Transactions: ${filtered.length}',
      'Total Credits: ${totals.credit.toStringAsFixed(2)}',
      'Total Debits: ${totals.debit.toStringAsFixed(2)}',
      '',
      'Top Transactions:'
    ];

    for (final tx in filtered.take(20)) {
      lines.add(
        '- ${tx['created_at'] ?? '-'} | ${tx['transaction_type'] ?? '-'} | ${tx['status'] ?? '-'} | ${tx['amount'] ?? 0} | ${tx['description'] ?? ''}',
      );
    }

    Clipboard.setData(ClipboardData(text: lines.join('\n')));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Report copied to clipboard.'),
        backgroundColor: Colors.green,
      ),
    );
  }

  _TxTotals _totals(List<Map<String, dynamic>> txs) {
    double credit = 0;
    double debit = 0;
    for (final tx in txs) {
      final status = '${tx['status'] ?? ''}'.toLowerCase();
      if (status.isNotEmpty && status != 'completed') continue;
      final type = '${tx['transaction_type'] ?? ''}'.toLowerCase();
      final amount = _toDouble(tx['amount']).abs();
      if (type == 'wallet_funding' ||
          type == 'deposit' ||
          type == 'contribution_refund' ||
          type == 'case_wallet_refund') {
        credit += amount;
      } else if (type == 'contribution' ||
          type == 'case_wallet_deduction' ||
          type == 'disbursement' ||
          type == 'arrears' ||
          type == 'penalty' ||
          type == 'registration' ||
          type == 'renewal') {
        debit += amount;
      }
    }
    return _TxTotals(credit: credit, debit: debit);
  }

  List<Map<String, dynamic>> _applyFilters(List<Map<String, dynamic>> input) {
    final now = DateTime.now();
    DateTime start = DateTime(2000);
    if (_dateFilter == '3m') start = DateTime(now.year, now.month - 3, now.day);
    if (_dateFilter == '6m') start = DateTime(now.year, now.month - 6, now.day);
    if (_dateFilter == '12m') {
      start = DateTime(now.year, now.month - 12, now.day);
    }

    return input.where((tx) {
      final createdAt = DateTime.tryParse('${tx['created_at']}');
      if (_dateFilter != 'all') {
        if (createdAt == null || createdAt.isBefore(start)) return false;
      }
      if (_typeFilter != 'all') {
        final type = '${tx['transaction_type'] ?? ''}'.toLowerCase();
        if (type != _typeFilter) return false;
      }
      if (_search.isNotEmpty) {
        final hay = '${tx['description'] ?? ''} ${tx['transaction_type'] ?? ''}'
            .toLowerCase();
        if (!hay.contains(_search.toLowerCase())) return false;
      }
      return true;
    }).toList();
  }

  Widget _tile(String label, String value, {required IconData icon}) {
    return Container(
      width: 220,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: const Color(0xFFEFF6FF),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 18, color: const Color(0xFF1F3556)),
          ),
          const SizedBox(height: 10),
          Text(
            value,
            style: const TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
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

  double _toDouble(dynamic value) {
    if (value == null) return 0;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString()) ?? 0;
  }
}

class _MemberReportVm {
  final Map<String, dynamic> summary;
  final List<Map<String, dynamic>> transactions;
  const _MemberReportVm({
    required this.summary,
    required this.transactions,
  });
}

class _TxTotals {
  final double credit;
  final double debit;
  const _TxTotals({required this.credit, required this.debit});
}
