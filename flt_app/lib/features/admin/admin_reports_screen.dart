import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:intl/intl.dart';

import '../../core/services/export_service.dart';
import '../../core/services/live_data_service.dart';
import '../auth/auth_controller.dart';
import 'admin_shell.dart';

class AdminReportsScreen extends ConsumerStatefulWidget {
  const AdminReportsScreen({super.key});

  @override
  ConsumerState<AdminReportsScreen> createState() => _AdminReportsScreenState();
}

class _AdminReportsScreenState extends ConsumerState<AdminReportsScreen> {
  int _currentTab = 0;
  int _reloadKey = 0;
  String? _appToken;

  @override
  void initState() {
    super.initState();
    _appToken = ref.read(authControllerProvider).appToken;
  }

  String? _token() => _appToken;

  @override
  Widget build(BuildContext context) {
    // Update token if needed
    final currentToken = ref.read(authControllerProvider).appToken;
    if (currentToken != _appToken && mounted) {
      _appToken = currentToken;
    }

    return AdminShell(
      title: 'Reports',
      route: '/admin/reports',
      actions: [
        IconButton(
          onPressed: () => setState(() => _reloadKey++),
          tooltip: 'Refresh report',
          icon: const Icon(Icons.refresh),
        ),
      ],
      body: DefaultTabController(
        length: 5,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Reports & Insights',
                    style: Theme.of(context)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Operational metrics, discipline status, and quick export.',
                    style: TextStyle(
                        color: Color(0xFF64748B), fontWeight: FontWeight.w500),
                  ),
                  const SizedBox(height: 12),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: List.generate(_tabs.length, (i) {
                        final selected = i == _currentTab;
                        return Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            selected: selected,
                            onSelected: (_) => setState(() => _currentTab = i),
                            label: Text(_tabs[i]),
                            selectedColor: const Color(0xFF1F3556),
                            labelStyle: TextStyle(
                              color: selected
                                  ? Colors.white
                                  : const Color(0xFF1F3556),
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        );
                      }),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(child: _tabContent(_currentTab)),
          ],
        ),
      ),
    );
  }

  static const _tabs = <String>[
    'Contributions',
    'Transactions',
    'Defaulters',
    'Members',
    'Discipline',
  ];

  Widget _tabContent(int index) {
    final token = _token();
    if (token == null || token.isEmpty) {
      return const Center(
          child: Text('Your session has expired. Please log in again.'));
    }
    final content = switch (index) {
      0 => _ContributionsTab(appToken: token),
      1 => _TransactionsTab(appToken: token),
      2 => _DefaultersTab(appToken: token),
      3 => _MembersTab(appToken: token),
      4 => _DisciplineTab(appToken: token),
      _ => const Center(child: Text('Report not found')),
    };
    return KeyedSubtree(
      key: ValueKey('$_currentTab-$_reloadKey'),
      child: content,
    );
  }
}

String _reportDate(dynamic value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '');
  return parsed == null
      ? '-'
      : DateFormat('yyyy-MM-dd').format(parsed.toLocal());
}

Future<void> _exportReportRows(
  BuildContext context, {
  required String title,
  required List<String> headers,
  required List<List<dynamic>> rows,
}) async {
  if (rows.isEmpty) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('There is no data to export.')),
    );
    return;
  }
  try {
    final bytes =
        await generateExcelFile(title: title, headers: headers, rows: rows);
    await shareFile(
      title:
          '${title.toLowerCase().replaceAll(' ', '_')}_${DateTime.now().millisecondsSinceEpoch}',
      bytes: bytes,
      ext: 'xlsx',
    );
  } catch (e) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Export failed: $e')),
    );
  }
}

class _ContributionsTab extends StatelessWidget {
  final String? appToken;
  const _ContributionsTab({required this.appToken});

  @override
  Widget build(BuildContext context) {
    final money = NumberFormat.currency(locale: 'en_KE', symbol: 'KES ');
    final token = appToken;
    final future = token == null || token.isEmpty
        ? Future.value(<Map<String, dynamic>>[])
        : LiveDataService().fetchReportContributions(appToken: token);
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: FutureBuilder<List<Map<String, dynamic>>>(
        future: future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text('Failed: ${snapshot.error}'));
          }
          final rows = snapshot.data ?? const <Map<String, dynamic>>[];
          final total =
              rows.fold<double>(0, (s, r) => s + _toDouble(r['amount']));
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                      child: _summaryCard(context, 'Contributions',
                          '${rows.length}', Icons.payments)),
                  const SizedBox(width: 12),
                  Expanded(
                      child: _summaryCard(context, 'Amount',
                          money.format(total), Icons.trending_up)),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Contribution History',
                      style: TextStyle(fontWeight: FontWeight.w700)),
                  OutlinedButton.icon(
                    onPressed: () => _exportReportRows(
                      context,
                      title: 'contributions',
                      headers: const ['Date', 'Member', 'Type', 'Amount'],
                      rows: rows
                          .map((r) => [
                                _reportDate(r['created_at']),
                                r['member_name'],
                                r['transaction_type'],
                                r['amount'],
                              ])
                          .toList(),
                    ),
                    icon: const Icon(Icons.download, size: 16),
                    label: const Text('Export'),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              if (rows.isNotEmpty) ...[
                SizedBox(
                  height: 200,
                  child: BarChart(
                    BarChartData(
                      barTouchData: BarTouchData(enabled: true),
                      titlesData: FlTitlesData(
                        leftTitles: AxisTitles(
                            sideTitles:
                                SideTitles(showTitles: true, reservedSize: 40)),
                        bottomTitles: AxisTitles(
                            sideTitles: SideTitles(
                          showTitles: true,
                          getTitlesWidget: (value, meta) {
                            final idx = value.toInt();
                            if (idx < 0 || idx >= rows.length) {
                              return const SizedBox();
                            }
                            return Text('${rows[idx]['month'] ?? ''}',
                                style: const TextStyle(fontSize: 10));
                          },
                        )),
                      ),
                      borderData: FlBorderData(show: false),
                      barGroups: rows.asMap().entries.map((e) {
                        final idx = e.key;
                        final amt = _toDouble(e.value['amount']);
                        return BarChartGroupData(
                          x: idx,
                          barRods: [
                            BarChartRodData(
                                toY: amt / 1000,
                                width: 16,
                                color: const Color(0xFF1F3556))
                          ],
                        );
                      }).toList(),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],
              if (rows.isEmpty)
                const Card(
                    child: Padding(
                        padding: EdgeInsets.all(20),
                        child: Center(child: Text('No contributions found.'))))
              else
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: DataTable(
                      columns: const [
                        DataColumn(label: Text('Date')),
                        DataColumn(label: Text('Member')),
                        DataColumn(label: Text('Type')),
                        DataColumn(label: Text('Amount'), numeric: true),
                      ],
                      rows: rows
                          .map((r) => DataRow(cells: [
                                DataCell(Text(_reportDate(r['created_at']))),
                                DataCell(Text("${r['member_name'] ?? '-'}")),
                                DataCell(
                                    Text("${r['transaction_type'] ?? '-'}")),
                                DataCell(Text(money
                                    .format(_toDouble(r['amount']).abs()))),
                              ]))
                          .toList(),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }

  double _toDouble(dynamic v) {
    if (v == null) return 0;
    if (v is num) return v.toDouble();
    return double.tryParse(v.toString()) ?? 0;
  }
}

class _TransactionsTab extends StatelessWidget {
  final String? appToken;
  const _TransactionsTab({required this.appToken});

  @override
  Widget build(BuildContext context) {
    final money = NumberFormat.currency(locale: 'en_KE', symbol: 'KES ');
    final token = appToken;
    final future = token == null || token.isEmpty
        ? Future.value(<Map<String, dynamic>>[])
        : LiveDataService().fetchReportTransactions(appToken: token);
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: FutureBuilder<List<Map<String, dynamic>>>(
        future: future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text('Failed: ${snapshot.error}'));
          }
          final rows = snapshot.data ?? const [];
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _summaryCard(context, 'Transactions', '${rows.length}',
                  Icons.receipt_long),
              const SizedBox(height: 16),
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton.icon(
                  onPressed: () => _exportReportRows(
                    context,
                    title: 'transactions',
                    headers: const ['Date', 'Member', 'Type', 'Amount'],
                    rows: rows
                        .map((r) => [
                              _reportDate(r['created_at']),
                              r['member_name'],
                              r['transaction_type'],
                              r['amount'],
                            ])
                        .toList(),
                  ),
                  icon: const Icon(Icons.download, size: 16),
                  label: const Text('Export'),
                ),
              ),
              if (rows.isEmpty)
                const Card(
                    child: Padding(
                        padding: EdgeInsets.all(20),
                        child: Center(child: Text('No transactions found.'))))
              else
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: DataTable(
                      columns: const [
                        DataColumn(label: Text('Date')),
                        DataColumn(label: Text('Member')),
                        DataColumn(label: Text('Type')),
                        DataColumn(label: Text('Amount'), numeric: true),
                      ],
                      rows: rows
                          .map((r) => DataRow(cells: [
                                DataCell(Text("${r['created_at'] ?? '-'}"
                                    .substring(0, 10))),
                                DataCell(Text("${r['member_name'] ?? '-'}")),
                                DataCell(
                                    Text("${r['transaction_type'] ?? '-'}")),
                                DataCell(Text(money
                                    .format(_toDouble(r['amount']).abs()))),
                              ]))
                          .toList(),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }

  double _toDouble(dynamic v) {
    if (v == null) return 0;
    if (v is num) return v.toDouble();
    return double.tryParse(v.toString()) ?? 0;
  }
}

class _DefaultersTab extends StatelessWidget {
  final String? appToken;
  const _DefaultersTab({required this.appToken});

  @override
  Widget build(BuildContext context) {
    final money = NumberFormat.currency(locale: 'en_KE', symbol: 'KES ');
    final token = appToken;
    final future = token == null || token.isEmpty
        ? Future.value(<Map<String, dynamic>>[])
        : LiveDataService().fetchReportDefaulters(appToken: token);
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: FutureBuilder<List<Map<String, dynamic>>>(
        future: future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text('Failed: ${snapshot.error}'));
          }
          final rows = snapshot.data ?? const [];
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                      child: _summaryCard(context, 'Defaulters',
                          '${rows.length}', Icons.warning_amber_rounded)),
                  const SizedBox(width: 12),
                  Expanded(
                      child: _summaryCard(
                          context,
                          'Owed',
                          money.format(rows.fold<double>(
                              0, (s, r) => s + _toDouble(r['amount_owed']))),
                          Icons.account_balance_wallet)),
                ],
              ),
              const SizedBox(height: 16),
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton.icon(
                  onPressed: () => _exportReportRows(
                    context,
                    title: 'defaulters',
                    headers: const ['Member', 'Phone', 'Amount Owed'],
                    rows: rows
                        .map((r) => [
                              r['member_name'],
                              r['phone_number'],
                              r['amount_owed'],
                            ])
                        .toList(),
                  ),
                  icon: const Icon(Icons.download, size: 16),
                  label: const Text('Export'),
                ),
              ),
              if (rows.isEmpty)
                const Card(
                    child: Padding(
                        padding: EdgeInsets.all(20),
                        child: Center(child: Text('No defaulters found.'))))
              else
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: DataTable(
                      columns: const [
                        DataColumn(label: Text('Member')),
                        DataColumn(label: Text('Phone')),
                        DataColumn(label: Text('Owed'), numeric: true),
                      ],
                      rows: rows
                          .map((r) => DataRow(cells: [
                                DataCell(Text("${r['member_name'] ?? '-'}")),
                                DataCell(Text("${r['phone_number'] ?? '-'}")),
                                DataCell(Text(money.format(
                                    _toDouble(r['amount_owed']).abs()))),
                              ]))
                          .toList(),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }

  double _toDouble(dynamic v) {
    if (v == null) return 0;
    if (v is num) return v.toDouble();
    return double.tryParse(v.toString()) ?? 0;
  }
}

class _MembersTab extends StatelessWidget {
  final String? appToken;
  const _MembersTab({required this.appToken});

  @override
  Widget build(BuildContext context) {
    final money = NumberFormat.currency(locale: 'en_KE', symbol: 'KES ');
    final token = appToken;
    final future = token == null || token.isEmpty
        ? Future.value(<Map<String, dynamic>>[])
        : LiveDataService().fetchReportMembers(appToken: token);
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: FutureBuilder<List<Map<String, dynamic>>>(
        future: future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text('Failed: ${snapshot.error}'));
          }
          final rows = snapshot.data ?? const [];
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _summaryCard(context, 'Members', '${rows.length}', Icons.group),
              const SizedBox(height: 16),
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton.icon(
                  onPressed: () => _exportReportRows(
                    context,
                    title: 'members',
                    headers: const ['Member', 'Number', 'Balance', 'Status'],
                    rows: rows
                        .map((r) => [
                              r['member_name'],
                              r['member_number'],
                              r['wallet_balance'],
                              r['status'],
                            ])
                        .toList(),
                  ),
                  icon: const Icon(Icons.download, size: 16),
                  label: const Text('Export'),
                ),
              ),
              if (rows.isEmpty)
                const Card(
                    child: Padding(
                        padding: EdgeInsets.all(20),
                        child: Center(child: Text('No member data found.'))))
              else
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: DataTable(
                      columns: const [
                        DataColumn(label: Text('Member')),
                        DataColumn(label: Text('Number')),
                        DataColumn(label: Text('Balance')),
                        DataColumn(label: Text('Status')),
                      ],
                      rows: rows
                          .map((r) => DataRow(cells: [
                                DataCell(Text("${r['member_name'] ?? '-'}")),
                                DataCell(Text("${r['member_number'] ?? '-'}")),
                                DataCell(Text(money
                                    .format(_toDouble(r['wallet_balance'])))),
                                DataCell(Text("${r['status'] ?? '-'}")),
                              ]))
                          .toList(),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }

  double _toDouble(dynamic v) {
    if (v == null) return 0;
    if (v is num) return v.toDouble();
    return double.tryParse(v.toString()) ?? 0;
  }
}

class _DisciplineTab extends StatelessWidget {
  final String? appToken;
  const _DisciplineTab({required this.appToken});

  @override
  Widget build(BuildContext context) {
    final token = appToken;
    final future = token == null || token.isEmpty
        ? Future.value(<Map<String, dynamic>>[])
        : LiveDataService().fetchReportDiscipline(appToken: token);
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: FutureBuilder<List<Map<String, dynamic>>>(
        future: future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text('Failed: ${snapshot.error}'));
          }
          final rows = snapshot.data ?? const [];
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _summaryCard(
                  context, 'Discipline Records', '${rows.length}', Icons.rule),
              const SizedBox(height: 16),
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton.icon(
                  onPressed: () => _exportReportRows(
                    context,
                    title: 'discipline',
                    headers: const ['Member', 'Status', 'Action', 'Date'],
                    rows: rows
                        .map((r) => [
                              r['member_name'],
                              r['status'],
                              r['action'],
                              _reportDate(r['created_at']),
                            ])
                        .toList(),
                  ),
                  icon: const Icon(Icons.download, size: 16),
                  label: const Text('Export'),
                ),
              ),
              if (rows.isEmpty)
                const Card(
                    child: Padding(
                        padding: EdgeInsets.all(20),
                        child: Center(
                            child: Text('No discipline records found.'))))
              else
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: DataTable(
                      columns: const [
                        DataColumn(label: Text('Member')),
                        DataColumn(label: Text('Status')),
                        DataColumn(label: Text('Action')),
                        DataColumn(label: Text('Date')),
                      ],
                      rows: rows
                          .map((r) => DataRow(cells: [
                                DataCell(Text("${r['member_name'] ?? '-'}")),
                                DataCell(Text("${r['status'] ?? '-'}")),
                                DataCell(Text("${r['action'] ?? '-'}")),
                                DataCell(Text(_reportDate(r['created_at']))),
                              ]))
                          .toList(),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

Widget _summaryCard(
    BuildContext context, String title, String value, IconData icon) {
  return Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: const Color(0xFFE2E8F0)),
    ),
    child: Row(
      children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: const Color(0xFFEFF6FF),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, size: 18, color: const Color(0xFF1F3556)),
        ),
        const SizedBox(width: 12),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(value,
              style:
                  const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
          const SizedBox(height: 4),
          Text(title,
              style: const TextStyle(
                  color: Color(0xFF64748B), fontWeight: FontWeight.w600)),
        ])),
      ],
    ),
  );
}
