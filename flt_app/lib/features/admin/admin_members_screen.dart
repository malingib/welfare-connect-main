import 'dart:io';

import 'package:excel/excel.dart' hide Border;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:posthog_flutter/posthog_flutter.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/constants/app_constants.dart';
import '../../core/services/live_data_service.dart';
import '../../core/widgets/async_error_view.dart';
import '../auth/auth_controller.dart';
import 'admin_shell.dart';

class AdminMembersScreen extends ConsumerStatefulWidget {
  const AdminMembersScreen({super.key});

  @override
  ConsumerState<AdminMembersScreen> createState() => _AdminMembersScreenState();
}

class _AdminMembersScreenState extends ConsumerState<AdminMembersScreen> {
  final _service = LiveDataService();
  final _searchCtrl = TextEditingController();
  static const _pageSize = 50;
  int _page = 1;
  bool _hasMore = false;
  String _search = '';
  String _statusFilter = 'all';
  String _activeFilter = 'all';
  late Future<List<Map<String, dynamic>>> _future;

  String? _sortField;
  bool _sortAsc = true;
  final Set<String> _selectedIds = {};
  final Map<String, int> _unpaidCounts = {};
  bool _unpaidLoading = false;

  final _deductCaseIdCtrl = TextEditingController();
  final _deductMemberIdsCtrl = TextEditingController();
  bool _deductSubmitting = false;
  List<Map<String, dynamic>> _deductPreviewRows = [];

  @override
  void dispose() {
    _searchCtrl.dispose();
    _deductCaseIdCtrl.dispose();
    _deductMemberIdsCtrl.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _future = _loadPage();
  }

  Future<List<Map<String, dynamic>>> _loadPage() async {
    final rows = await _service
        .fetchAdminMembers(
          page: _page,
          pageSize: _pageSize,
          search: _search,
          status: _statusFilter,
          active: _activeFilter,
        )
        .timeout(const Duration(seconds: 20));
    _hasMore = rows.length == _pageSize;
    if (mounted) {
      _selectedIds.clear();
    }
    if (rows.isNotEmpty) {
      _loadUnpaidCounts(rows);
    }
    return rows;
  }

  Future<void> _loadUnpaidCounts(List<Map<String, dynamic>> rows) async {
    setState(() => _unpaidLoading = true);
    try {
      final results = await Future.wait(
        rows.map((r) async {
          final id = (r['id'] ?? '').toString();
          try {
            final data = await Supabase.instance.client.rpc(
              'get_member_unpaid_case_obligations',
              params: {'p_member_id': id},
            );
            final obligations = (data as List?)?.cast<Map<String, dynamic>>() ??
                const <Map<String, dynamic>>[];
            return MapEntry(id, obligations.length);
          } catch (_) {
            return MapEntry(id, 0);
          }
        }),
      );
      if (mounted) {
        setState(() {
          _unpaidCounts.addEntries(results.where((e) => e.value > 0));
          _unpaidLoading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _unpaidLoading = false);
    }
  }

  Future<void> _refresh() async {
    setState(() => _future = _loadPage());
    await _future;
  }

  Future<void> _exportFilteredMembers() async {
    try {
      final allRows = await _service.fetchAdminMembers(
        page: 1,
        pageSize: 5000,
        search: _search,
        status: _statusFilter,
        active: _activeFilter,
      );
      final now = DateTime.now();
      final filename =
          'members_export_${now.year}${now.month.toString().padLeft(2, '0')}${now.day.toString().padLeft(2, '0')}_${now.hour.toString().padLeft(2, '0')}${now.minute.toString().padLeft(2, '0')}.csv';
      allRows.sort((a, b) {
        final aNum = _memberNumberOrder((a['member_number'] ?? '').toString());
        final bNum = _memberNumberOrder((b['member_number'] ?? '').toString());
        final numCmp = aNum.compareTo(bNum);
        if (numCmp != 0) return numCmp;
        return (a['member_number'] ?? '')
            .toString()
            .compareTo((b['member_number'] ?? '').toString());
      });
      final lines = <String>[
        'member_number,name,phone_number,status,is_active,wallet_balance'
      ];
      for (final r in allRows) {
        final memberNumber = _csv('${r['member_number'] ?? ''}');
        final name = _csv('${r['name'] ?? ''}');
        final phone = _csv('${r['phone_number'] ?? ''}');
        final status = _csv('${r['status'] ?? ''}');
        final isActive = r['is_active'] == true ? 'TRUE' : 'FALSE';
        final wallet = _toDouble(r['wallet_balance']).toStringAsFixed(2);
        lines.add('$memberNumber,$name,$phone,$status,$isActive,$wallet');
      }
      final csv = lines.join('\n');
      final dir = await getApplicationDocumentsDirectory();
      final file = File('${dir.path}/$filename');
      await file.writeAsString(csv);
      await Clipboard.setData(ClipboardData(text: csv));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Exported ${allRows.length} rows. Saved: ${file.path} (also copied to clipboard).',
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Export failed: $e')),
      );
    }
  }

  void _onSort(String field) {
    setState(() {
      if (_sortField == field) {
        _sortAsc = !_sortAsc;
      } else {
        _sortField = field;
        _sortAsc = true;
      }
    });
  }

  void _toggleSelect(String id) {
    setState(() {
      if (_selectedIds.contains(id)) {
        _selectedIds.remove(id);
      } else {
        _selectedIds.add(id);
      }
    });
  }

  void _toggleSelectAll(bool? checked, List<Map<String, dynamic>> rows) {
    setState(() {
      if (checked == true) {
        _selectedIds.addAll(rows.map((r) => (r['id'] ?? '').toString()));
      } else {
        _selectedIds.clear();
      }
    });
  }

  Future<void> _openBulkDeductDialog(
      List<Map<String, dynamic>> rows, NumberFormat money) async {
    final selectedRows = rows
        .where((r) => _selectedIds.contains((r['id'] ?? '').toString()))
        .toList();
    if (selectedRows.isEmpty) return;

    _deductPreviewRows = selectedRows;
    _deductMemberIdsCtrl.text =
        selectedRows.map((r) => r['id'] ?? '').join(', ');
    _deductCaseIdCtrl.clear();
    _deductSubmitting = false;
    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Bulk Wallet Deduction'),
          content: SizedBox(
            width: 520,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: _deductCaseIdCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Case ID or Case Number',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _deductMemberIdsCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Member IDs (comma-separated)',
                    border: OutlineInputBorder(),
                  ),
                  maxLines: 2,
                ),
                const SizedBox(height: 16),
                const Text(
                  'Selected members preview:',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    columns: const [
                      DataColumn(label: Text('Name')),
                      DataColumn(label: Text('Number')),
                      DataColumn(label: Text('Balance'), numeric: true),
                    ],
                    rows: _deductPreviewRows.map((r) {
                      return DataRow(cells: [
                        DataCell(Text('${r['name'] ?? '-'}')),
                        DataCell(Text('${r['member_number'] ?? '-'}')),
                        DataCell(
                          Text(
                            money.format(_toDouble(r['wallet_balance'])),
                            style: const TextStyle(fontWeight: FontWeight.w600),
                            textAlign: TextAlign.right,
                          ),
                        ),
                      ]);
                    }).toList(),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: _deductSubmitting
                  ? null
                  : () async {
                      setLocal(() => _deductSubmitting = true);
                      await _submitBulkDeduct(ctx, setLocal);
                    },
              child: _deductSubmitting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Deduct'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submitBulkDeduct(BuildContext ctx, StateSetter setLocal) async {
    final caseId = _deductCaseIdCtrl.text.trim();
    final memberIdTexts = _deductMemberIdsCtrl.text
        .split(',')
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList();
    if (caseId.isEmpty || memberIdTexts.isEmpty) {
      setLocal(() => _deductSubmitting = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Case ID and member IDs are required')),
        );
      }
      return;
    }

    try {
      final token = ref.read(authControllerProvider).appToken ?? '';
      final response = await Supabase.instance.client.functions.invoke(
        'api-case-bulk-deduct',
        body: {'case_id': caseId, 'member_ids': memberIdTexts},
        headers: {'x-app-token': token},
      );

      final payload =
          (response.data as Map?)?.cast<String, dynamic>() ?? const {};
      final deducted = (payload['deducted'] as List?)?.length ?? 0;
      final skippedPaid =
          (payload['skipped_already_paid'] as List?)?.length ?? 0;
      final skippedIneligible =
          (payload['skipped_ineligible'] as List?)?.length ?? 0;
      final skippedInsufficient =
          (payload['skipped_insufficient'] as List?)?.length ?? 0;

      if (!mounted) return;
      if (deducted > 0) {
        Posthog().capture(
          eventName: 'admin_bulk_deduction_completed',
          properties: {
            'deducted_count': deducted,
            'skipped_already_paid_count': skippedPaid,
            'skipped_ineligible_count': skippedIneligible,
            'skipped_insufficient_count': skippedInsufficient,
          },
        );
        setState(() {});
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'Deducted: $deducted. Already paid: $skippedPaid. Ineligible: $skippedIneligible. Insufficient: $skippedInsufficient.',
              ),
            ),
          );
        }
        if (!ctx.mounted) return;
        Navigator.of(ctx).pop();
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('No deductions applied')),
          );
        }
        setLocal(() => _deductSubmitting = false);
      }
    } catch (e) {
      setLocal(() => _deductSubmitting = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Bulk deduct failed: $e')),
        );
      }
    }
  }

  Future<void> _showUnpaidObligations(
      String memberId, String memberName) async {
    try {
      final data = await Supabase.instance.client.rpc(
        'get_member_unpaid_case_obligations',
        params: {'p_member_id': memberId},
      );
      final obligations = (data as List?)?.cast<Map<String, dynamic>>() ??
          const <Map<String, dynamic>>[];
      if (!mounted) return;
      await showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text('Unpaid obligations — $memberName'),
          content: obligations.isEmpty
              ? const Text('No unpaid obligations.')
              : SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    columns: const [
                      DataColumn(label: Text('Case')),
                      DataColumn(label: Text('Type')),
                      DataColumn(label: Text('Required'), numeric: true),
                    ],
                    rows: obligations.map((o) {
                      return DataRow(cells: [
                        DataCell(Text('${o['case_number'] ?? '-'}')),
                        DataCell(Text('${o['case_type'] ?? '-'}')),
                        DataCell(
                          Text(
                            _toDouble(o['contribution_per_member'])
                                .toStringAsFixed(2),
                            textAlign: TextAlign.right,
                          ),
                        ),
                      ]);
                    }).toList(),
                  ),
                ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Close'),
            ),
          ],
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to load obligations: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final money = NumberFormat.currency(
      locale: 'en_KE',
      symbol: 'KES ',
      decimalDigits: 2,
    );

    return AdminShell(
      title: 'Members',
      route: '/admin/members',
      actions: [
        IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh)),
        IconButton(
          onPressed: _exportFilteredMembers,
          icon: const Icon(Icons.download),
          tooltip: 'Export filtered members (CSV)',
        ),
        IconButton(
          onPressed: _importMembersFromExcel,
          icon: const Icon(Icons.upload_file),
          tooltip: 'Import members from Excel',
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
          var sortedRows = [...rows];
          if (_sortField != null) {
            sortedRows.sort((a, b) {
              int cmp;
              switch (_sortField) {
                case 'member_number':
                  final aNum =
                      _memberNumberOrder((a['member_number'] ?? '').toString());
                  final bNum =
                      _memberNumberOrder((b['member_number'] ?? '').toString());
                  cmp = aNum.compareTo(bNum);
                  if (cmp != 0) return _sortAsc ? cmp : -cmp;
                  cmp = (a['member_number'] ?? '')
                      .toString()
                      .compareTo((b['member_number'] ?? '').toString());
                  return _sortAsc ? cmp : -cmp;
                case 'name':
                  cmp = (a['name'] ?? '')
                      .toString()
                      .compareTo((b['name'] ?? '').toString());
                  return _sortAsc ? cmp : -cmp;
                case 'wallet_balance':
                  final aBal = _toDouble(a['wallet_balance']);
                  final bBal = _toDouble(b['wallet_balance']);
                  cmp = aBal.compareTo(bBal);
                  return _sortAsc ? cmp : -cmp;
                default:
                  return 0;
              }
            });
          } else {
            sortedRows.sort((a, b) {
              final aNum =
                  _memberNumberOrder((a['member_number'] ?? '').toString());
              final bNum =
                  _memberNumberOrder((b['member_number'] ?? '').toString());
              final numCmp = aNum.compareTo(bNum);
              if (numCmp != 0) return numCmp;
              return (a['member_number'] ?? '')
                  .toString()
                  .compareTo((b['member_number'] ?? '').toString());
            });
          }

          final allSelected = sortedRows.isNotEmpty &&
              sortedRows.every(
                  (r) => _selectedIds.contains((r['id'] ?? '').toString()));

          return SingleChildScrollView(
            padding: const EdgeInsets.all(AppConstants.marginEdge),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Member Directory',
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Admin / Members',
                  style: TextStyle(
                    color: Color(0xFF64748B),
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${sortedRows.length} shown • Page $_page',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: const Color(0xFF64748B),
                            ),
                      ),
                    ),
                    if (_selectedIds.isNotEmpty)
                      ElevatedButton.icon(
                        onPressed: () =>
                            _openBulkDeductDialog(sortedRows, money),
                        icon: const Icon(Icons.payments_rounded),
                        label: Text('Bulk Deduct (${_selectedIds.length})'),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _searchCtrl,
                  decoration: InputDecoration(
                    hintText: 'Search member number, name, phone',
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
                        initialValue: _activeFilter,
                        isExpanded: true,
                        decoration: const InputDecoration(
                          labelText: 'Active Filter',
                          border: OutlineInputBorder(),
                        ),
                        items: const [
                          DropdownMenuItem(value: 'all', child: Text('All')),
                          DropdownMenuItem(
                              value: 'active', child: Text('Active')),
                          DropdownMenuItem(
                              value: 'inactive', child: Text('Inactive')),
                        ],
                        onChanged: (v) => setState(() {
                          _activeFilter = v ?? 'all';
                          _page = 1;
                          _future = _loadPage();
                        }),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _statusFilter,
                        isExpanded: true,
                        decoration: const InputDecoration(
                          labelText: 'Status Filter',
                          border: OutlineInputBorder(),
                        ),
                        items: const [
                          DropdownMenuItem(
                              value: 'all', child: Text('All statuses')),
                          DropdownMenuItem(
                              value: 'active', child: Text('ACTIVE')),
                          DropdownMenuItem(
                              value: 'inactive', child: Text('INACTIVE')),
                          DropdownMenuItem(
                              value: 'probation', child: Text('PROBATION')),
                          DropdownMenuItem(
                              value: 'deceased', child: Text('DECEASED')),
                        ],
                        onChanged: (v) => setState(() {
                          _statusFilter = v ?? 'all';
                          _page = 1;
                          _future = _loadPage();
                        }),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Icon(Icons.swipe,
                        size: 18,
                        color: Theme.of(context).colorScheme.onSurfaceVariant),
                    const SizedBox(width: 6),
                    Text(
                      'Swipe the table to see more columns',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    showCheckboxColumn: false,
                    columnSpacing: 16,
                    headingRowColor:
                        WidgetStateProperty.all(const Color(0xFFF1F5F9)),
                    columns: [
                      DataColumn(
                        label: Checkbox(
                          value: allSelected,
                          onChanged: (v) => _toggleSelectAll(v, sortedRows),
                        ),
                      ),
                      DataColumn(
                        label: InkWell(
                          onTap: () => _onSort('member_number'),
                          child: Row(
                            children: [
                              const Text('Member #'),
                              if (_sortField == 'member_number')
                                Icon(
                                  _sortAsc
                                      ? Icons.arrow_upward
                                      : Icons.arrow_downward,
                                  size: 16,
                                ),
                            ],
                          ),
                        ),
                      ),
                      DataColumn(
                        label: InkWell(
                          onTap: () => _onSort('name'),
                          child: Row(
                            children: [
                              const Text('Name'),
                              if (_sortField == 'name')
                                Icon(
                                  _sortAsc
                                      ? Icons.arrow_upward
                                      : Icons.arrow_downward,
                                  size: 16,
                                ),
                            ],
                          ),
                        ),
                      ),
                      const DataColumn(label: Text('Phone')),
                      DataColumn(
                        label: InkWell(
                          onTap: () => _onSort('wallet_balance'),
                          child: Row(
                            children: [
                              const Text('Balance'),
                              if (_sortField == 'wallet_balance')
                                Icon(
                                  _sortAsc
                                      ? Icons.arrow_upward
                                      : Icons.arrow_downward,
                                  size: 16,
                                ),
                            ],
                          ),
                        ),
                      ),
                      const DataColumn(label: Text('Status')),
                      DataColumn(label: _buildUnpaidHeader()),
                      const DataColumn(label: Text('Actions')),
                    ],
                    rows: sortedRows.map((r) {
                      final id = (r['id'] ?? '').toString();
                      final active = r['is_active'] == true;
                      final balance = _toDouble(r['wallet_balance']);
                      final unpaid = _unpaidCounts[id] ?? 0;
                      final selected = _selectedIds.contains(id);

                      return DataRow(
                        selected: selected,
                        onSelectChanged: (v) => _toggleSelect(id),
                        cells: [
                          DataCell(Checkbox(
                            value: selected,
                            onChanged: (v) => _toggleSelect(id),
                          )),
                          DataCell(Text('${r['member_number'] ?? '-'}')),
                          DataCell(
                            InkWell(
                              onTap: () => context.go('/admin/members/$id'),
                              child: Text(
                                '${r['name'] ?? '-'}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  color: Color(0xFF1F3556),
                                  decoration: TextDecoration.underline,
                                ),
                              ),
                            ),
                          ),
                          DataCell(Text('${r['phone_number'] ?? '-'}')),
                          DataCell(
                            Text(
                              money.format(balance),
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                color: Color(0xFF0F172A),
                              ),
                            ),
                          ),
                          DataCell(_chip(
                            label: active ? 'Active' : 'Inactive',
                            fg: active
                                ? const Color(0xFF166534)
                                : const Color(0xFF9A3412),
                            bg: active
                                ? const Color(0xFFDCFCE7)
                                : const Color(0xFFFFEDD5),
                          )),
                          DataCell(
                            InkWell(
                              onTap: unpaid > 0
                                  ? () => _showUnpaidObligations(
                                      id, '${r['name'] ?? '-'}')
                                  : null,
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: unpaid > 0
                                      ? const Color(0xFFFEE2E2)
                                      : const Color(0xFFF1F5F9),
                                  borderRadius: BorderRadius.circular(999),
                                  border: Border.all(
                                    color: unpaid > 0
                                        ? const Color(0xFFEF4444)
                                        : const Color(0xFFE2E8F0),
                                  ),
                                ),
                                child: Text(
                                  unpaid > 0 ? '$unpaid unpaid' : '0',
                                  style: TextStyle(
                                    color: unpaid > 0
                                        ? const Color(0xFF991B1B)
                                        : const Color(0xFF64748B),
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ),
                          ),
                          DataCell(
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                IconButton(
                                  tooltip: 'View Details',
                                  icon: const Icon(Icons.visibility, size: 18),
                                  onPressed: () =>
                                      context.go('/admin/members/$id'),
                                ),
                                IconButton(
                                  tooltip: 'SMS',
                                  icon: const Icon(Icons.message, size: 18),
                                  onPressed: () {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                          content:
                                              Text('SMS composer coming soon')),
                                    );
                                  },
                                ),
                                IconButton(
                                  tooltip: 'Transfer',
                                  icon: const Icon(Icons.swap_horiz, size: 18),
                                  onPressed: () {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                          content:
                                              Text('Transfer coming soon')),
                                    );
                                  },
                                ),
                              ],
                            ),
                          ),
                        ],
                      );
                    }).toList(),
                  ),
                ),
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
            ),
          );
        },
      ),
    );
  }

  Widget _buildUnpaidHeader() {
    return Row(
      children: [
        const Text('Unpaid'),
        if (_unpaidLoading)
          const SizedBox(
            width: 12,
            height: 12,
            child: Padding(
              padding: EdgeInsets.all(2.0),
              child: CircularProgressIndicator(strokeWidth: 1.5),
            ),
          ),
      ],
    );
  }

  Widget _chip({
    required String label,
    required Color fg,
    required Color bg,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: fg,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }

  double _toDouble(dynamic value) {
    if (value == null) return 0;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString()) ?? 0;
  }

  String _csv(String input) {
    final escaped = input.replaceAll('"', '""');
    return '"$escaped"';
  }

  int _memberNumberOrder(String memberNumber) {
    final match = RegExp(r'\d+').firstMatch(memberNumber);
    if (match == null) return 1 << 30;
    return int.tryParse(match.group(0)!) ?? (1 << 30);
  }

  Future<void> _importMembersFromExcel() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['xlsx'],
        withData: true,
      );

      if (result == null || result.files.isEmpty) return;

      final file = result.files.first;
      final bytes = file.bytes;
      if (bytes == null) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not read file')),
        );
        return;
      }

      final excel = Excel.decodeBytes(bytes);
      final sheetNames = excel.sheets.keys.toList();
      final sheet =
          sheetNames.isNotEmpty ? excel.sheets[sheetNames.first] : null;
      if (sheet == null) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No data found in Excel file')),
        );
        return;
      }

      final rows = <Map<String, dynamic>>[];
      final headers = <String>[];

      int rowIndex = 0;
      for (final row in sheet.rows) {
        if (rowIndex == 0) {
          headers.addAll(row.map((c) => c?.value?.toString() ?? '').toList());
          rowIndex++;
          continue;
        }
        final rowData = <String, dynamic>{};
        for (var i = 0; i < headers.length && i < row.length; i++) {
          rowData[headers[i].toLowerCase().replaceAll(' ', '_')] =
              row[i]?.value;
        }
        rows.add(rowData);
        rowIndex++;
      }

      if (rows.isEmpty) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No member rows found')),
        );
        return;
      }

      final token = ref.read(authControllerProvider).appToken ?? '';
      final importResult =
          await _service.importMembers(appToken: token, members: rows);

      if (!mounted) return;
      final createdCount = (importResult['created'] as num?)?.toInt() ?? 0;
      Posthog().capture(
        eventName: 'members_import_completed',
        properties: {'created_count': createdCount},
      );
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Imported $createdCount members')),
      );

      setState(() {
        _page = 1;
        _future = _loadPage();
      });
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Import failed: $e')),
      );
    }
  }
}
