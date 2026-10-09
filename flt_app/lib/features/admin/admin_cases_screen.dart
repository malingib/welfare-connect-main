import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:posthog_flutter/posthog_flutter.dart';

import '../../core/constants/app_constants.dart';
import '../../core/services/live_data_service.dart';
import '../../core/widgets/async_error_view.dart';
import 'admin_shell.dart';

class AdminCasesScreen extends StatefulWidget {
  const AdminCasesScreen({super.key});

  @override
  State<AdminCasesScreen> createState() => _AdminCasesScreenState();
}

class _AdminCasesScreenState extends State<AdminCasesScreen> {
  final _service = LiveDataService();
  final _searchCtrl = TextEditingController();
  late Future<List<Map<String, dynamic>>> _future;
  String _statusFilter = 'all';
  String _caseTypeFilter = 'all';

  @override
  void initState() {
    super.initState();
    _future = _loadCases();
  }

  Future<List<Map<String, dynamic>>> _loadCases() =>
      _service.fetchAdminCases().timeout(const Duration(seconds: 20));

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    setState(() => _future = _loadCases());
    await _future;
  }

  Future<void> _deleteCase(Map<String, dynamic> row) async {
    final caseId = (row['id'] ?? '').toString();
    if (caseId.isEmpty) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Case'),
        content: Text(
            'Are you sure you want to delete case #${row['case_number'] ?? '-'}? This action cannot be undone.'),
        actions: [
          TextButton(
              onPressed: () => ctx.pop(false), child: const Text('Cancel')),
          FilledButton(
              onPressed: () => ctx.pop(true), child: const Text('Delete')),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    try {
      await _service.deleteCase(caseId: caseId);
      Posthog().capture(
        eventName: 'case_deleted',
        properties: {
          'case_type': (row['case_type'] ?? 'unknown').toString().toLowerCase(),
        },
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Case deleted successfully.')),
      );
      await _refresh();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Delete failed: $e')),
      );
    }
  }

  Future<void> _toggleCase(Map<String, dynamic> row) async {
    final caseId = (row['id'] ?? '').toString();
    if (caseId.isEmpty) return;

    try {
      if (row['is_finalized'] == true) {
        await _service.reopenCase(caseId: caseId);
        Posthog().capture(
          eventName: 'case_reopened',
          properties: {
            'case_type':
                (row['case_type'] ?? 'unknown').toString().toLowerCase(),
          },
        );
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Case reopened successfully.')),
        );
      } else {
        final amount = _toDouble(row['actual_amount']);
        await _service.finalizeCase(caseId: caseId, actualAmount: amount);
        Posthog().capture(
          eventName: 'case_finalized',
          properties: {
            'case_type':
                (row['case_type'] ?? 'unknown').toString().toLowerCase(),
            'actual_amount': amount,
          },
        );
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Case finalized successfully.')),
        );
      }
      await _refresh();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Action failed: $e')),
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
      title: 'Cases',
      route: '/admin/cases',
      actions: [
        IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh)),
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
          final query = _searchCtrl.text.trim().toLowerCase();

          final filtered = rows.where((r) {
            final isFinalized = r['is_finalized'] == true;
            final isActive = r['is_active'] == true;

            if (_statusFilter == 'active' && !(isActive && !isFinalized)) {
              return false;
            }
            if (_statusFilter == 'inactive' && (isActive || isFinalized)) {
              return false;
            }
            if (_statusFilter == 'finalized' && !isFinalized) return false;

            if (_caseTypeFilter != 'all') {
              final caseType = (r['case_type'] ?? '').toString().toLowerCase();
              if (caseType != _caseTypeFilter) return false;
            }

            if (query.isEmpty) return true;
            final caseNumber =
                (r['case_number'] ?? '').toString().toLowerCase();
            final caseType = (r['case_type'] ?? '').toString().toLowerCase();
            return caseNumber.contains(query) || caseType.contains(query);
          }).toList();

          final finalizedCount =
              rows.where((r) => r['is_finalized'] == true).length;
          final activeCount = rows
              .where((r) => r['is_active'] == true && r['is_finalized'] != true)
              .length;
          final inactiveCount = rows
              .where((r) => r['is_active'] != true && r['is_finalized'] != true)
              .length;

          return LayoutBuilder(
            builder: (context, constraints) {
              final isWide = constraints.maxWidth >= 600;
              final maxCardWidth = isWide ? 560.0 : 380.0;
              final childAspectRatio = isWide ? 1.7 : 1.05;

              return ListView(
                padding: const EdgeInsets.all(AppConstants.marginEdge),
                children: [
                  Text(
                    'Case Management',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Total ${rows.length} • Active $activeCount • Inactive $inactiveCount • Finalized $finalizedCount',
                    style: const TextStyle(color: Color(0xFF64748B)),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _searchCtrl,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      hintText: 'Search by case number or type',
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
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      SizedBox(
                        width: isWide
                            ? (constraints.maxWidth - 10) / 2
                            : constraints.maxWidth,
                        child: DropdownButtonFormField<String>(
                          initialValue: _statusFilter,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            labelText: 'Status',
                            border: OutlineInputBorder(),
                          ),
                          items: const [
                            DropdownMenuItem(value: 'all', child: Text('All')),
                            DropdownMenuItem(
                                value: 'active', child: Text('Active')),
                            DropdownMenuItem(
                                value: 'inactive', child: Text('Inactive')),
                            DropdownMenuItem(
                                value: 'finalized', child: Text('Finalized')),
                          ],
                          onChanged: (v) =>
                              setState(() => _statusFilter = v ?? 'all'),
                        ),
                      ),
                      SizedBox(
                        width: isWide
                            ? (constraints.maxWidth - 10) / 2
                            : constraints.maxWidth,
                        child: DropdownButtonFormField<String>(
                          initialValue: _caseTypeFilter,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            labelText: 'Case Type',
                            border: OutlineInputBorder(),
                          ),
                          items: const [
                            DropdownMenuItem(value: 'all', child: Text('All')),
                            DropdownMenuItem(
                                value: 'education', child: Text('Education')),
                            DropdownMenuItem(
                                value: 'sickness',
                                child: Text('Medical Emergencies')),
                            DropdownMenuItem(
                                value: 'death',
                                child: Text('Funeral Contributions')),
                          ],
                          onChanged: (v) =>
                              setState(() => _caseTypeFilter = v ?? 'all'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  if (filtered.isEmpty)
                    const Padding(
                      padding: EdgeInsets.all(20),
                      child: Center(
                          child: Text('No cases match current filters.')),
                    )
                  else
                    GridView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
                        maxCrossAxisExtent: maxCardWidth,
                        childAspectRatio: childAspectRatio,
                        mainAxisSpacing: 12,
                      ),
                      itemCount: filtered.length,
                      itemBuilder: (context, index) {
                        final r = filtered[index];
                        final isFinalized = r['is_finalized'] == true;
                        final isActive = r['is_active'] == true;

                        final expected = _toDouble(r['expected_amount']);
                        final actual = _toDouble(r['actual_amount']);
                        final contribution =
                            _toDouble(r['contribution_per_member']);

                        final progress = expected > 0
                            ? (actual / expected).clamp(0.0, 1.0)
                            : (isFinalized ? 1.0 : 0.0);
                        final variance = actual - expected;
                        final caseType = (r['case_type'] ?? 'unknown')
                            .toString()
                            .toLowerCase();

                        return Card(
                          elevation: AppConstants.elevationCard,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(
                                AppConstants.radiusMedium),
                            side: const BorderSide(color: Color(0xFFE2E8F0)),
                          ),
                          child: InkWell(
                            onTap: () => context.go('/admin/cases/${r['id']}'),
                            borderRadius: BorderRadius.circular(
                                AppConstants.radiusMedium),
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          '#${r['case_number'] ?? '-'}',
                                          style: const TextStyle(
                                            fontWeight: FontWeight.w800,
                                            fontSize: 15,
                                          ),
                                        ),
                                      ),
                                      _caseTypeBadge(caseType),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  Wrap(
                                    spacing: 8,
                                    children: [
                                      _statusBadge(isFinalized, isActive),
                                      if (contribution > 0)
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                              horizontal: 8, vertical: 4),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFFF1F5F9),
                                            borderRadius:
                                                BorderRadius.circular(999),
                                          ),
                                          child: Text(
                                            '${money.format(contribution)} / member',
                                            style: const TextStyle(
                                              fontSize: 11,
                                              fontWeight: FontWeight.w600,
                                              color: Color(0xFF475569),
                                            ),
                                          ),
                                        ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  LinearProgressIndicator(
                                    value: progress,
                                    minHeight: 8,
                                    borderRadius: BorderRadius.circular(999),
                                    color: progress >= 1.0
                                        ? const Color(0xFF16A34A)
                                        : const Color(0xFF3B82F6),
                                  ),
                                  const SizedBox(height: 4),
                                  Row(
                                    mainAxisAlignment:
                                        MainAxisAlignment.spaceBetween,
                                    children: [
                                      Text(
                                        '${(progress * 100).toStringAsFixed(0)}% collected',
                                        style: const TextStyle(
                                          fontSize: 11,
                                          color: Color(0xFF64748B),
                                        ),
                                      ),
                                      Text(
                                        'Variance: ${variance >= 0 ? '+' : ''}${money.format(variance)}',
                                        style: TextStyle(
                                          fontSize: 11,
                                          color: variance >= 0
                                              ? const Color(0xFF16A34A)
                                              : const Color(0xFFDC2626),
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  Row(
                                    children: [
                                      Expanded(
                                        child: FilledButton.tonal(
                                          onPressed: () => _toggleCase(r),
                                          child: Text(isFinalized
                                              ? 'Reopen'
                                              : 'Finalize'),
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      IconButton(
                                        onPressed: () => _deleteCase(r),
                                        icon: const Icon(Icons.delete_outline,
                                            size: 18),
                                        tooltip: 'Delete',
                                        style: IconButton.styleFrom(
                                          backgroundColor:
                                              const Color(0xFFFEF2F2),
                                          foregroundColor:
                                              const Color(0xFFDC2626),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                ],
              );
            },
          );
        },
      ),
    );
  }

  Widget _caseTypeBadge(String caseType) {
    Color fg;
    Color bg;
    switch (caseType) {
      case 'education':
        fg = const Color(0xFF1E40AF);
        bg = const Color(0xFFDBEAFE);
        break;
      case 'sickness':
        fg = const Color(0xFFB91C1C);
        bg = const Color(0xFFFEE2E2);
        break;
      case 'death':
        fg = const Color(0xFF7C3AED);
        bg = const Color(0xFFEDE9FE);
        break;
      default:
        fg = const Color(0xFF334155);
        bg = const Color(0xFFF1F5F9);
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        switch (caseType) {
          'education' => 'EDUCATION',
          'sickness' => 'MEDICAL EMERGENCIES',
          'death' => 'FUNERAL CONTRIBUTIONS',
          _ => caseType.replaceAll('_', ' ').toUpperCase(),
        },
        style: TextStyle(
          color: fg,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }

  Widget _statusBadge(bool isFinalized, bool isActive) {
    String label;
    Color fg;
    Color bg;
    if (isFinalized) {
      label = 'FINALIZED';
      fg = const Color(0xFF166534);
      bg = const Color(0xFFDCFCE7);
    } else if (isActive) {
      label = 'ACTIVE';
      fg = const Color(0xFF1E40AF);
      bg = const Color(0xFFDBEAFE);
    } else {
      label = 'INACTIVE';
      fg = const Color(0xFF9A3412);
      bg = const Color(0xFFFFEDD5);
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
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
}
