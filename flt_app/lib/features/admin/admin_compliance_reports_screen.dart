import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/constants/app_constants.dart';
import '../../core/services/export_service.dart';
import '../../core/services/live_data_service.dart';
import '../auth/auth_controller.dart';
import 'admin_shell.dart';

class AdminComplianceReportsScreen extends ConsumerStatefulWidget {
  const AdminComplianceReportsScreen({super.key});

  @override
  ConsumerState<AdminComplianceReportsScreen> createState() =>
      _AdminComplianceReportsScreenState();
}

class _AdminComplianceReportsScreenState
    extends ConsumerState<AdminComplianceReportsScreen> {
  final LiveDataService _service = LiveDataService();
  final money = NumberFormat.currency(locale: 'en_KE', symbol: 'KES ');

  late final Future<List<Map<String, dynamic>>> _casePaymentsFuture;
  late final Future<List<Map<String, dynamic>>> _auditTrailFuture;
  late final Future<List<Map<String, dynamic>>> _reversalsFuture;
  late final Future<List<Map<String, dynamic>>> _issuesFuture;

  int _auditPage = 1;
  final int _pageSize = 15;
  DateTimeRange? _dateRange;

  List<Map<String, dynamic>> _filterRows(
    List<Map<String, dynamic>> rows,
    String dateKey,
  ) {
    final range = _dateRange;
    if (range == null) return rows;
    return rows.where((row) {
      final value = DateTime.tryParse(row[dateKey]?.toString() ?? '');
      if (value == null) return false;
      final date = value.toLocal();
      final start =
          DateTime(range.start.year, range.start.month, range.start.day);
      final end =
          DateTime(range.end.year, range.end.month, range.end.day, 23, 59, 59);
      return !date.isBefore(start) && !date.isAfter(end);
    }).toList();
  }

  Future<void> _pickDateRange() async {
    final range = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime.now(),
      initialDateRange: _dateRange,
    );
    if (range != null && mounted) {
      setState(() {
        _dateRange = range;
        _auditPage = 1;
      });
    }
  }

  Future<void> _exportReport({
    required String title,
    required List<String> headers,
    required List<List<dynamic>> rows,
    required bool pdf,
  }) async {
    if (rows.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('There is no data to export.')),
      );
      return;
    }
    try {
      final bytes = pdf
          ? await generatePdfFile(
              title: title,
              headers: headers,
              rows: rows,
              money: money,
            )
          : await generateExcelFile(
              title: title,
              headers: headers,
              rows: rows,
            );
      await shareFile(
        title: exportFilename(
                title.toLowerCase().replaceAll(' ', '_'), pdf ? 'pdf' : 'xlsx')
            .replaceAll(RegExp(r'\.(pdf|xlsx)$'), ''),
        bytes: bytes,
        ext: pdf ? 'pdf' : 'xlsx',
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Export failed: $e')),
      );
    }
  }

  @override
  void initState() {
    super.initState();
    final token = ref.read(authControllerProvider).appToken ?? '';
    _casePaymentsFuture = _service.fetchComplianceCasePayments(
      appToken: token,
      filters: {},
    );
    _auditTrailFuture = _service.fetchAuditTrail(
      appToken: token,
      filters: {'limit': 100},
    );
    _reversalsFuture = _service.fetchReversalsAudit(
      appToken: token,
      filters: {},
    );
    _issuesFuture = _service.fetchComplianceIssues(
      appToken: token,
      filters: {},
    );
  }

  Future<void> _refresh() async {
    final token = ref.read(authControllerProvider).appToken ?? '';
    setState(() {
      _casePaymentsFuture = _service.fetchComplianceCasePayments(
        appToken: token,
        filters: {},
      );
      _auditTrailFuture = _service.fetchAuditTrail(
        appToken: token,
        filters: {'limit': 100},
      );
      _reversalsFuture = _service.fetchReversalsAudit(
        appToken: token,
        filters: {},
      );
      _issuesFuture = _service.fetchComplianceIssues(
        appToken: token,
        filters: {},
      );
    });
  }

  double _toDouble(dynamic v) {
    if (v == null) return 0;
    if (v is num) return v.toDouble();
    return double.tryParse(v.toString()) ?? 0;
  }

  @override
  Widget build(BuildContext context) {
    return AdminShell(
      title: 'Compliance Reports',
      route: '/admin/compliance-reports',
      actions: [
        IconButton(
          onPressed: _refresh,
          icon: const Icon(Icons.refresh),
        ),
      ],
      body: DefaultTabController(
        length: 4,
        child: Column(
          children: [
            const SizedBox(height: 16),
            _buildStatsCards(),
            const SizedBox(height: 16),
            _buildFilterControls(),
            const SizedBox(height: 16),
            const TabBar(
              isScrollable: true,
              tabs: [
                Tab(text: 'Case Payments'),
                Tab(text: 'Audit Trail'),
                Tab(text: 'Reversals'),
                Tab(text: 'Compliance Issues'),
              ],
            ),
            Expanded(
              child: TabBarView(
                children: [
                  _buildCasePaymentsTab(),
                  _buildAuditTrailTab(),
                  _buildReversalsTab(),
                  _buildComplianceIssuesTab(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatsCards() {
    return FutureBuilder<List<dynamic>>(
      future: Future.wait([
        _casePaymentsFuture,
        _auditTrailFuture,
        _reversalsFuture,
        _issuesFuture,
      ]),
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done ||
            !snapshot.hasData) {
          return const SizedBox(
            height: 100,
            child: Center(child: CircularProgressIndicator()),
          );
        }
        final auditTrail = (snapshot.data![1] as List?)
                ?.whereType<Map>()
                .map((e) => e.cast<String, dynamic>())
                .toList() ??
            const <Map<String, dynamic>>[];
        final reversals = (snapshot.data![2] as List?)
                ?.whereType<Map>()
                .map((e) => e.cast<String, dynamic>())
                .toList() ??
            const <Map<String, dynamic>>[];
        final issues = (snapshot.data![3] as List?)
                ?.whereType<Map>()
                .map((e) => e.cast<String, dynamic>())
                .toList() ??
            const <Map<String, dynamic>>[];

        return Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            _statCard(
              'Total Reversals',
              reversals.length.toString(),
              subtitle:
                  'KES ${reversals.fold<double>(0, (sum, r) => sum + _toDouble(r['reversal_amount']).abs()).toStringAsFixed(2)} reversed',
              icon: Icons.file_copy,
            ),
            _statCard(
              'Compliance Issues',
              issues.length.toString(),
              subtitle:
                  '${issues.where((i) => (i['severity'] ?? '') == 'high' || (i['severity'] ?? '') == 'critical').length} critical/high',
              icon: Icons.warning_amber_rounded,
            ),
            _statCard(
              'Audit Entries',
              auditTrail.length.toString(),
              subtitle: 'Last 100 entries',
              icon: Icons.shield,
            ),
            _statCard(
              'Suspense Pending',
              '0',
              subtitle: 'KES 0.00 pending',
              icon: Icons.pending_actions,
            ),
          ],
        );
      },
    );
  }

  Widget _statCard(String label, String value,
      {required String subtitle, required IconData icon}) {
    return SizedBox(
      width: 220,
      child: Container(
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
            Text(value,
                style:
                    const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
            const SizedBox(height: 4),
            Text(
              label,
              style: const TextStyle(
                color: Color(0xFF64748B),
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: const TextStyle(
                color: Color(0xFF94A3B8),
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFilterControls() {
    return Row(
      children: [
        OutlinedButton.icon(
          onPressed: _pickDateRange,
          icon: const Icon(Icons.filter_list, size: 16),
          label: Text(_dateRange == null ? 'Date filter' : 'Date filtered'),
        ),
        const SizedBox(width: 8),
        OutlinedButton.icon(
          onPressed: _dateRange == null
              ? null
              : () => setState(() => _dateRange = null),
          icon: const Icon(Icons.date_range, size: 16),
          label: const Text('Clear date filter'),
        ),
      ],
    );
  }

  Widget _buildCasePaymentsTab() {
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: _casePaymentsFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done ||
            !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final rows = _filterRows(
            (snapshot.data ?? [])
                .whereType<Map>()
                .map((e) => e.cast<String, dynamic>())
                .toList(),
            'created_at');
        return SingleChildScrollView(
          padding: const EdgeInsets.all(AppConstants.marginEdge),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Case Payment Compliance',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                  ),
                  Row(
                    children: [
                      OutlinedButton.icon(
                        onPressed: () => _exportReport(
                          title: 'case_payment_compliance',
                          headers: const [
                            'Case',
                            'Type',
                            'Status',
                            'Eligible',
                            'Paid',
                            'Partial',
                            'Unpaid',
                            'Expected',
                            'Net Paid',
                            'Outstanding',
                            'Paid %',
                            'Members %'
                          ],
                          rows: rows
                              .map((r) => [
                                    r['case_number'],
                                    r['case_type'],
                                    r['case_status'],
                                    r['eligible_members'],
                                    r['paid_members'],
                                    r['partial_members'],
                                    r['unpaid_members'],
                                    r['expected_total'],
                                    r['net_paid_total'],
                                    r['outstanding_total'],
                                    r['paid_amount_percent'],
                                    r['paid_members_percent'],
                                  ])
                              .toList(),
                          pdf: false,
                        ),
                        icon: const Icon(Icons.download, size: 16),
                        label: const Text('Summary CSV'),
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton.icon(
                        onPressed: () => _exportReport(
                          title: 'case_payment_compliance',
                          headers: const [
                            'Case',
                            'Type',
                            'Status',
                            'Eligible',
                            'Paid',
                            'Partial',
                            'Unpaid',
                            'Expected',
                            'Net Paid',
                            'Outstanding',
                            'Paid %',
                            'Members %'
                          ],
                          rows: rows
                              .map((r) => [
                                    r['case_number'],
                                    r['case_type'],
                                    r['case_status'],
                                    r['eligible_members'],
                                    r['paid_members'],
                                    r['partial_members'],
                                    r['unpaid_members'],
                                    r['expected_total'],
                                    r['net_paid_total'],
                                    r['outstanding_total'],
                                    r['paid_amount_percent'],
                                    r['paid_members_percent'],
                                  ])
                              .toList(),
                          pdf: true,
                        ),
                        icon: const Icon(Icons.download, size: 16),
                        label: const Text('Summary PDF'),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (rows.isEmpty)
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: const Text(
                    'No case payment compliance data available.',
                    style: TextStyle(color: Color(0xFF64748B)),
                  ),
                )
              else
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    columns: const [
                      DataColumn(label: Text('Case')),
                      DataColumn(label: Text('Type')),
                      DataColumn(label: Text('Status')),
                      DataColumn(label: Text('Eligible'), numeric: true),
                      DataColumn(label: Text('Paid'), numeric: true),
                      DataColumn(label: Text('Partial'), numeric: true),
                      DataColumn(label: Text('Unpaid'), numeric: true),
                      DataColumn(label: Text('Expected'), numeric: true),
                      DataColumn(label: Text('Net Paid'), numeric: true),
                      DataColumn(label: Text('Outstanding'), numeric: true),
                      DataColumn(label: Text('Paid %'), numeric: true),
                      DataColumn(label: Text('Members %'), numeric: true),
                    ],
                    rows: rows.map((r) {
                      return DataRow(
                        cells: [
                          DataCell(Text('${r['case_number'] ?? '-'}')),
                          DataCell(Text('${r['case_type'] ?? '-'}'.capitalize)),
                          DataCell(
                              Text('${r['case_status'] ?? '-'}'.capitalize)),
                          DataCell(Text('${r['eligible_members'] ?? 0}')),
                          DataCell(Text('${r['paid_members'] ?? 0}')),
                          DataCell(Text('${r['partial_members'] ?? 0}')),
                          DataCell(Text('${r['unpaid_members'] ?? 0}')),
                          DataCell(Text(
                              money.format(_toDouble(r['expected_total'])))),
                          DataCell(Text(
                              money.format(_toDouble(r['net_paid_total'])))),
                          DataCell(Text(
                              money.format(_toDouble(r['outstanding_total'])))),
                          DataCell(Text(
                              '${_toDouble(r['paid_amount_percent']).toStringAsFixed(1)}%')),
                          DataCell(Text(
                              '${_toDouble(r['paid_members_percent']).toStringAsFixed(1)}%')),
                        ],
                      );
                    }).toList(),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildAuditTrailTab() {
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: _auditTrailFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done ||
            !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final rows = _filterRows(
            (snapshot.data ?? [])
                .whereType<Map>()
                .map((e) => e.cast<String, dynamic>())
                .toList(),
            'created_at');
        final start = (_auditPage - 1) * _pageSize;
        final paged = rows.skip(start).take(_pageSize).toList();
        final totalPages = (rows.length / _pageSize).ceil();
        return SingleChildScrollView(
          padding: const EdgeInsets.all(AppConstants.marginEdge),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Audit Trail',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                  ),
                  Row(
                    children: [
                      OutlinedButton.icon(
                        onPressed: () => _exportReport(
                          title: 'audit_trail',
                          headers: const [
                            'Timestamp',
                            'Action',
                            'Table',
                            'Status',
                            'Reference'
                          ],
                          rows: rows
                              .map((r) => [
                                    r['created_at'],
                                    r['action'],
                                    r['table_name'],
                                    r['status'],
                                    r['member_id'] ?? r['user_id'],
                                  ])
                              .toList(),
                          pdf: false,
                        ),
                        icon: const Icon(Icons.download, size: 16),
                        label: const Text('Export CSV'),
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton.icon(
                        onPressed: () => _exportReport(
                          title: 'audit_trail',
                          headers: const [
                            'Timestamp',
                            'Action',
                            'Table',
                            'Status',
                            'Reference'
                          ],
                          rows: rows
                              .map((r) => [
                                    r['created_at'],
                                    r['action'],
                                    r['table_name'],
                                    r['status'],
                                    r['member_id'] ?? r['user_id'],
                                  ])
                              .toList(),
                          pdf: true,
                        ),
                        icon: const Icon(Icons.download, size: 16),
                        label: const Text('Export PDF'),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                decoration: const InputDecoration(
                  labelText: 'Search audit logs',
                  prefixIcon: Icon(Icons.search),
                  isDense: true,
                ),
                onChanged: (_) {},
              ),
              const SizedBox(height: 12),
              if (rows.isEmpty)
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: const Text(
                    'No audit logs found.',
                    style: TextStyle(color: Color(0xFF64748B)),
                  ),
                )
              else
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    columns: const [
                      DataColumn(label: Text('Timestamp')),
                      DataColumn(label: Text('Action')),
                      DataColumn(label: Text('Table')),
                      DataColumn(label: Text('Status')),
                      DataColumn(label: Text('Reference')),
                    ],
                    rows: paged.map((r) {
                      final dateStr = r['created_at']?.toString() ?? '-';
                      final ref = r['member_id']?.toString() ??
                          r['user_id']?.toString() ??
                          '-';
                      final status = (r['status'] ?? '').toString();
                      return DataRow(
                        cells: [
                          DataCell(Text(dateStr)),
                          DataCell(Text(r['action']?.toString() ?? '-')),
                          DataCell(Text('${r['table_name'] ?? '-'}')),
                          DataCell(
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: status == 'success'
                                    ? Colors.green.shade100
                                    : Colors.red.shade100,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                status,
                                style: TextStyle(
                                  color: status == 'success'
                                      ? Colors.green.shade800
                                      : Colors.red.shade800,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ),
                          DataCell(Text(ref.length > 12
                              ? '${ref.substring(0, 12)}...'
                              : ref)),
                        ],
                      );
                    }).toList(),
                  ),
                ),
              if (totalPages > 1)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Showing ${start + 1}-${start + paged.length} of ${rows.length}',
                        style: const TextStyle(
                            fontSize: 12, color: Color(0xFF64748B)),
                      ),
                      Row(
                        children: [
                          IconButton(
                            onPressed: _auditPage > 1
                                ? () => setState(() => _auditPage--)
                                : null,
                            icon: const Icon(Icons.chevron_left),
                          ),
                          ...List.generate(totalPages.clamp(0, 7), (i) {
                            final page = i + 1;
                            return Padding(
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 2),
                              child: TextButton(
                                onPressed: () =>
                                    setState(() => _auditPage = page),
                                style: TextButton.styleFrom(
                                  backgroundColor: _auditPage == page
                                      ? const Color(0xFF1F3556)
                                      : Colors.transparent,
                                  foregroundColor: _auditPage == page
                                      ? Colors.white
                                      : const Color(0xFF1F3556),
                                  minimumSize: const Size(36, 36),
                                  padding: EdgeInsets.zero,
                                ),
                                child: Text('$page'),
                              ),
                            );
                          }),
                          IconButton(
                            onPressed: _auditPage < totalPages
                                ? () => setState(() => _auditPage++)
                                : null,
                            icon: const Icon(Icons.chevron_right),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildReversalsTab() {
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: _reversalsFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done ||
            !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final rows = _filterRows(
            (snapshot.data ?? [])
                .whereType<Map>()
                .map((e) => e.cast<String, dynamic>())
                .toList(),
            'reversal_date');
        return SingleChildScrollView(
          padding: const EdgeInsets.all(AppConstants.marginEdge),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Reversals Audit',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => _exportReport(
                      title: 'reversals_audit',
                      headers: const [
                        'Reversal Date',
                        'Member',
                        'Member Number',
                        'Amount',
                        'Reason',
                        'Original Date',
                        'Original Amount'
                      ],
                      rows: rows
                          .map((r) => [
                                r['reversal_date'],
                                r['member_name'],
                                r['member_number'],
                                r['reversal_amount'],
                                r['reason'],
                                r['original_transaction_date'],
                                r['original_amount'],
                              ])
                          .toList(),
                      pdf: false,
                    ),
                    icon: const Icon(Icons.download, size: 16),
                    label: const Text('Export CSV'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (rows.isEmpty)
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: const Text(
                    'No reversals found.',
                    style: TextStyle(color: Color(0xFF64748B)),
                  ),
                )
              else
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    columns: const [
                      DataColumn(label: Text('Reversal Date')),
                      DataColumn(label: Text('Member')),
                      DataColumn(label: Text('Amount'), numeric: true),
                      DataColumn(label: Text('Reason')),
                      DataColumn(label: Text('Original Date')),
                      DataColumn(label: Text('Original Amount'), numeric: true),
                    ],
                    rows: rows.map((r) {
                      return DataRow(
                        cells: [
                          DataCell(Text(r['reversal_date']?.toString() ?? '-')),
                          DataCell(
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(r['member_name']?.toString() ?? '-'),
                                Text(
                                  r['member_number']?.toString() ?? '-',
                                  style: const TextStyle(
                                      fontSize: 11, color: Color(0xFF64748B)),
                                ),
                              ],
                            ),
                          ),
                          DataCell(
                            Text(
                              money.format(
                                  _toDouble(r['reversal_amount']).abs()),
                              style:
                                  const TextStyle(fontWeight: FontWeight.w700),
                            ),
                          ),
                          DataCell(Text(r['reason']?.toString() ?? '-')),
                          DataCell(Text(
                              r['original_transaction_date']?.toString() ??
                                  '-')),
                          DataCell(Text(money
                              .format(_toDouble(r['original_amount']).abs()))),
                        ],
                      );
                    }).toList(),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildComplianceIssuesTab() {
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: _issuesFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done ||
            !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final issues = _filterRows(
            (snapshot.data ?? [])
                .whereType<Map>()
                .map((e) => e.cast<String, dynamic>())
                .toList(),
            'created_at');
        return SingleChildScrollView(
          padding: const EdgeInsets.all(AppConstants.marginEdge),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Compliance Issues',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => _exportReport(
                      title: 'compliance_issues',
                      headers: const [
                        'Created At',
                        'Severity',
                        'Issue',
                        'Member',
                        'Status'
                      ],
                      rows: issues
                          .map((r) => [
                                r['created_at'],
                                r['severity'],
                                r['issue'] ?? r['description'],
                                r['member_number'] ?? r['member_id'],
                                r['status'],
                              ])
                          .toList(),
                      pdf: false,
                    ),
                    icon: const Icon(Icons.download, size: 16),
                    label: const Text('Export CSV'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (issues.isEmpty)
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.check_circle, color: Colors.green, size: 32),
                      SizedBox(width: 12),
                      Text(
                        'All Clear! No compliance issues detected.',
                        style:
                            TextStyle(color: Color(0xFF64748B), fontSize: 16),
                      ),
                    ],
                  ),
                )
              else
                ListView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: issues.length,
                  itemBuilder: (context, index) {
                    final issue = issues[index];
                    final severity = (issue['severity'] ?? 'medium').toString();
                    return Card(
                      margin: const EdgeInsets.only(bottom: 12),
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: const BorderSide(color: Color(0xFFE2E8F0)),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                _severityBadge(severity),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Text(
                                    issue['issue_type']?.toString() ??
                                        'Unknown Issue',
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w700,
                                        fontSize: 15),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(
                              '${issue['description'] ?? ''} - ${issue['affected_count'] ?? 0} affected',
                              style: const TextStyle(
                                  color: Color(0xFF64748B), fontSize: 13),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              'Recommendation: ${issue['recommendation'] ?? 'N/A'}',
                              style: const TextStyle(fontSize: 13),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _severityBadge(String severity) {
    Color bg;
    Color fg;
    switch (severity.toLowerCase()) {
      case 'critical':
        bg = Colors.red.shade100;
        fg = Colors.red.shade900;
        break;
      case 'high':
        bg = Colors.orange.shade100;
        fg = Colors.orange.shade900;
        break;
      case 'medium':
        bg = Colors.blue.shade100;
        fg = Colors.blue.shade900;
        break;
      default:
        bg = Colors.green.shade100;
        fg = Colors.green.shade900;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        severity.toUpperCase(),
        style: TextStyle(
          color: fg,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

extension StringCapitalize on String {
  String get capitalize =>
      isEmpty ? this : '${this[0].toUpperCase()}${substring(1)}';
}
