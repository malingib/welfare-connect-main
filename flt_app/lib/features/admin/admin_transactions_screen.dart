import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/constants/app_constants.dart';
import '../../core/services/live_data_service.dart';
import '../../core/widgets/async_error_view.dart';
import '../auth/auth_controller.dart';
import 'admin_shell.dart';

class AdminTransactionsScreen extends ConsumerStatefulWidget {
  const AdminTransactionsScreen({super.key});

  @override
  ConsumerState<AdminTransactionsScreen> createState() =>
      _AdminTransactionsScreenState();
}

class _AdminTransactionsScreenState
    extends ConsumerState<AdminTransactionsScreen> {
  final _service = LiveDataService();
  final _searchCtrl = TextEditingController();
  static const _pageSize = 10;
  int _page = 1;
  bool _hasMore = false;
  String _search = '';
  String _typeFilter = 'all';
  String _statusFilter = 'all';
  final Set<String> _selected = <String>{};
  bool _bulkBusy = false;
  late Future<List<Map<String, dynamic>>> _future;

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _future = _loadPage();
  }

  Future<List<Map<String, dynamic>>> _loadPage() async {
    final rows = await _service
        .fetchAdminTransactions(
          page: _page,
          pageSize: _pageSize,
          search: _search,
        )
        .timeout(const Duration(seconds: 20));
    _hasMore = rows.length == _pageSize;
    return rows;
  }

  Future<void> _refresh() async {
    setState(() => _future = _loadPage());
    await _future;
  }

  Future<void> _reverseTransaction(Map<String, dynamic> tx) async {
    final reasonCtrl = TextEditingController();
    final txId = (tx['id'] ?? '').toString();
    if (txId.isEmpty) return;

    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Reverse Transaction'),
        content: TextField(
          controller: reasonCtrl,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: 'Reason',
            hintText: 'Provide reversal reason',
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Reverse')),
        ],
      ),
    );

    if (ok != true || reasonCtrl.text.trim().isEmpty) return;

    try {
      final adminId = ref.read(authControllerProvider).user?.id;
      await _service.reverseTransaction(
        transactionId: txId,
        reason: reasonCtrl.text.trim(),
        adminUserId: adminId,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Transaction reversed successfully.')),
      );
      await _refresh();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Reversal failed: $e')),
      );
    }
  }

  Future<void> _editTransaction(Map<String, dynamic> tx) async {
    final txId = (tx['id'] ?? '').toString();
    if (txId.isEmpty) return;

    final descCtrl =
        TextEditingController(text: tx['description']?.toString() ?? '');
    final caseIdCtrl =
        TextEditingController(text: tx['case_id']?.toString() ?? '');

    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Edit Transaction'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: descCtrl,
              decoration: const InputDecoration(
                labelText: 'Description',
                hintText: 'Enter transaction description',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: caseIdCtrl,
              decoration: const InputDecoration(
                labelText: 'Link to Case (optional)',
                hintText: 'Enter case ID or leave empty',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Save')),
        ],
      ),
    );

    if (ok != true) return;

    try {
      await _service.updateTransactionDescription(
        transactionId: txId,
        description: descCtrl.text.trim(),
        caseId: caseIdCtrl.text.trim().isEmpty ? null : caseIdCtrl.text.trim(),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Transaction updated successfully.')),
      );
      await _refresh();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Update failed: $e')),
      );
    }
  }

  Future<void> _bulkReverse() async {
    if (_selected.isEmpty || _bulkBusy) return;
    final reasonCtrl = TextEditingController(text: 'Bulk reversal');
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Bulk Reverse'),
        content: TextField(
          controller: reasonCtrl,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'Reason'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Run')),
        ],
      ),
    );
    if (ok != true || reasonCtrl.text.trim().isEmpty) return;

    setState(() => _bulkBusy = true);
    int success = 0;
    int failed = 0;
    final adminId = ref.read(authControllerProvider).user?.id;
    final currentRows = await _future;
    for (final tx in currentRows) {
      final id = '${tx['id'] ?? ''}';
      final reversed = '${tx['status']}'.toLowerCase() == 'reversed';
      if (!_selected.contains(id) || reversed) continue;
      try {
        await _service.reverseTransaction(
          transactionId: id,
          reason: reasonCtrl.text.trim(),
          adminUserId: adminId,
        );
        success += 1;
      } catch (_) {
        failed += 1;
      }
    }
    if (!mounted) return;
    setState(() {
      _selected.clear();
      _bulkBusy = false;
      _future = _loadPage();
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
          content:
              Text('Bulk reverse done. Success: $success, Failed: $failed')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final money = NumberFormat.currency(
        locale: 'en_KE', symbol: 'KES ', decimalDigits: 2);
    return AdminShell(
      title: 'Transactions',
      route: '/admin/transactions',
      actions: [
        IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh)),
        IconButton(
          onPressed: _selected.isEmpty || _bulkBusy ? null : _bulkReverse,
          icon: const Icon(Icons.rule_folder),
          tooltip: 'Bulk Reverse',
        ),
      ],
      body: FutureBuilder<List<Map<String, dynamic>>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return AsyncErrorView(
              error: snapshot.error,
              onRetry: _refresh,
            );
          }
          final rows = snapshot.data ?? const [];
          final filteredRows = rows.where((r) {
            final type = '${r['transaction_type'] ?? ''}'.toLowerCase();
            final status = '${r['status'] ?? ''}'.toLowerCase();
            if (_typeFilter != 'all' && type != _typeFilter) return false;
            if (_statusFilter != 'all' && status != _statusFilter) return false;
            return true;
          }).toList();
          return ListView(
            padding: const EdgeInsets.all(AppConstants.marginEdge),
            children: [
              Text(
                'Transaction Ledger',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
              ),
              const SizedBox(height: 6),
              const Text(
                'Admin / Transactions',
                style: TextStyle(
                  color: Color(0xFF64748B),
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Page $_page',
                style: const TextStyle(color: Color(0xFF64748B)),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _searchCtrl,
                decoration: InputDecoration(
                  hintText: 'Search description, type, status, method',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _search.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.clear),
                          onPressed: () {
                            _searchCtrl.clear();
                            setState(() {
                              _search = '';
                              _page = 1;
                              _future = _loadPage();
                            });
                          },
                        ),
                ),
                onSubmitted: (value) {
                  setState(() {
                    _search = value.trim();
                    _page = 1;
                    _future = _loadPage();
                  });
                },
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _typeFilter,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'Type Filter',
                        isDense: true,
                      ),
                      items: const [
                        DropdownMenuItem(
                            value: 'all', child: Text('All Types')),
                        DropdownMenuItem(
                            value: 'contribution', child: Text('Contribution')),
                        DropdownMenuItem(
                            value: 'contribution_refund',
                            child: Text('Contribution Refund')),
                        DropdownMenuItem(
                            value: 'disbursement', child: Text('Disbursement')),
                        DropdownMenuItem(
                            value: 'registration',
                            child: Text('Registration Fee')),
                        DropdownMenuItem(
                            value: 'renewal', child: Text('Renewal Fee')),
                        DropdownMenuItem(
                            value: 'penalty', child: Text('Penalty')),
                        DropdownMenuItem(
                            value: 'arrears', child: Text('Arrears')),
                        DropdownMenuItem(
                            value: 'wallet_funding',
                            child: Text('Wallet Funding')),
                      ],
                      onChanged: (value) {
                        if (value == null) return;
                        setState(() => _typeFilter = value);
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _statusFilter,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'Status Filter',
                        isDense: true,
                      ),
                      items: const [
                        DropdownMenuItem(
                            value: 'all', child: Text('All Status')),
                        DropdownMenuItem(
                            value: 'completed', child: Text('Completed')),
                        DropdownMenuItem(
                            value: 'pending', child: Text('Pending')),
                        DropdownMenuItem(
                            value: 'reversed', child: Text('Reversed')),
                      ],
                      onChanged: (value) {
                        if (value == null) return;
                        setState(() => _statusFilter = value);
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              if (filteredRows.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(bottom: 10),
                  child: Text(
                    'No transactions match current filters.',
                    style: TextStyle(color: Color(0xFF64748B)),
                  ),
                ),
              ...filteredRows.map((r) {
                final date = DateTime.tryParse('${r['created_at']}');
                final amount = (r['amount'] as num?)?.toDouble() ??
                    double.tryParse('${r['amount']}') ??
                    0;
                final reversed = '${r['status']}'.toLowerCase() == 'reversed';
                final txId = '${r['id'] ?? ''}';
                return Container(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  decoration: const BoxDecoration(
                    border: Border(
                      bottom: BorderSide(color: Color(0xFFE2E8F0)),
                    ),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Checkbox(
                        value: _selected.contains(txId),
                        onChanged: reversed
                            ? null
                            : (v) {
                                setState(() {
                                  if (v == true) {
                                    _selected.add(txId);
                                  } else {
                                    _selected.remove(txId);
                                  }
                                });
                              },
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: Text(
                                    '${r['description'] ?? r['transaction_type'] ?? '-'}',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w700,
                                      fontSize: 15,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Flexible(
                                  child: Text(
                                    money.format(amount.abs()),
                                    textAlign: TextAlign.end,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w700),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '${r['transaction_type'] ?? '-'} • ${date == null ? '-' : DateFormat('MMM d, yyyy • h:mm a').format(date.toLocal())}',
                              style: const TextStyle(color: Color(0xFF64748B)),
                            ),
                            const SizedBox(height: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(999),
                                color: reversed
                                    ? const Color(0xFFFEE2E2)
                                    : const Color(0xFFDCFCE7),
                              ),
                              child: Text(
                                '${r['status'] ?? '-'}'.toUpperCase(),
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                  color: reversed
                                      ? const Color(0xFFB91C1C)
                                      : const Color(0xFF166534),
                                ),
                              ),
                            ),
                            if (!reversed) ...[
                              const SizedBox(height: 4),
                              Align(
                                alignment: Alignment.centerRight,
                                child: Wrap(
                                  spacing: 4,
                                  children: [
                                    TextButton(
                                      onPressed: () => _editTransaction(r),
                                      child: const Text('Edit'),
                                    ),
                                    TextButton(
                                      onPressed: () => _reverseTransaction(r),
                                      child: const Text('Revert'),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              }),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  OutlinedButton(
                    onPressed: _page > 1
                        ? () {
                            setState(() {
                              _page -= 1;
                              _future = _loadPage();
                            });
                          }
                        : null,
                    child: const Text('Prev'),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton(
                    onPressed: _hasMore
                        ? () {
                            setState(() {
                              _page += 1;
                              _future = _loadPage();
                            });
                          }
                        : null,
                    child: const Text('Next'),
                  ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}
