import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/constants/app_constants.dart';
import '../../core/services/live_data_service.dart';
import '../auth/auth_controller.dart';
import 'member_shell.dart';

class CasesScreen extends ConsumerStatefulWidget {
  const CasesScreen({super.key});

  @override
  ConsumerState<CasesScreen> createState() => _CasesScreenState();
}

class _CasesScreenState extends ConsumerState<CasesScreen> {
  final _service = LiveDataService();
  late Future<List<MemberCaseSnapshot>> _future;
  final _searchCtrl = TextEditingController();
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

  Future<List<MemberCaseSnapshot>> _load() {
    final auth = ref.read(authControllerProvider);
    if ((auth.memberId ?? '').isEmpty || (auth.appToken ?? '').isEmpty) {
      throw Exception('Session missing member identity. Please log in again.');
    }
    return _service.fetchMemberCases(
      memberId: auth.memberId!,
      appToken: auth.appToken!,
    );
  }

  @override
  Widget build(BuildContext context) {
    final money = NumberFormat.currency(
        locale: 'en_KE', symbol: 'KES ', decimalDigits: 2);

    return MemberShell(
      title: 'My Cases',
      subtitle: 'Obligations',
      currentIndex: 1,
      actions: [
        IconButton(
            onPressed: () => setState(() => _future = _load()),
            icon: const Icon(Icons.refresh)),
      ],
      body: FutureBuilder<List<MemberCaseSnapshot>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text(snapshot.error.toString()));
          }

          final cases = snapshot.data ?? const <MemberCaseSnapshot>[];
          final query = _searchCtrl.text.trim().toLowerCase();
          final filtered = cases.where((c) {
            if (_statusFilter == 'paid' && !c.paid) return false;
            if (_statusFilter == 'pending' && c.paid) return false;
            if (_statusFilter == 'finalized' && !c.isFinalized) return false;
            if (_statusFilter == 'open' && c.isFinalized) return false;
            if (query.isEmpty) return true;
            return c.caseNumber.toLowerCase().contains(query) ||
                c.caseType.toLowerCase().contains(query);
          }).toList();

          final paidCount = cases.where((c) => c.paid).length;
          final pendingCount = cases.length - paidCount;
          final finalizedCount = cases.where((c) => c.isFinalized).length;
          final contributionCount = cases.where((c) => c.amountPaid > 0).length;
          final totalContributed = cases.fold<double>(
            0,
            (sum, c) => sum + c.amountPaid,
          );

          return ListView(
            padding: const EdgeInsets.all(AppConstants.marginEdge),
            children: [
              _SummaryGrid(
                items: [
                  _SummaryBox(label: 'Total', value: '${cases.length}'),
                  _SummaryBox(label: 'Paid', value: '$paidCount'),
                  _SummaryBox(label: 'Pending', value: '$pendingCount'),
                  _SummaryBox(
                      label: 'Finalized Cases', value: '$finalizedCount'),
                  _SummaryBox(
                      label: 'Contribution Count', value: '$contributionCount'),
                ],
              ),
              const SizedBox(height: 8),
              _SummaryBox(
                label: 'Total Contributed',
                value: money.format(totalContributed),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _searchCtrl,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  hintText: 'Search by case number/type',
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
              DropdownButtonFormField<String>(
                initialValue: _statusFilter,
                items: const [
                  DropdownMenuItem(value: 'all', child: Text('All statuses')),
                  DropdownMenuItem(
                      value: 'pending', child: Text('Pending only')),
                  DropdownMenuItem(value: 'paid', child: Text('Paid only')),
                  DropdownMenuItem(value: 'open', child: Text('Open only')),
                  DropdownMenuItem(
                      value: 'finalized', child: Text('Finalized only')),
                ],
                onChanged: (v) => setState(() => _statusFilter = v ?? 'all'),
                decoration: const InputDecoration(
                  labelText: 'Filter',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              if (filtered.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(20),
                  child: Center(child: Text('No cases match current filters.')),
                )
              else
                ...filtered.map((c) {
                  final required = c.contributionPerMember;
                  final progress = c.progress.clamp(0.0, 1.0);
                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFFDCE3EE)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '#${c.caseNumber} • ${c.caseType.toUpperCase()}',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 8),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: c.paid
                                  ? const Color(0xFFE8F5ED)
                                  : const Color(0xFFFFF1EA),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              c.paid ? 'PAID' : 'PENDING',
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                color: c.paid
                                    ? const Color(0xFF0A7C2F)
                                    : const Color(0xFFB34700),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text('Required: ${money.format(required)}'),
                        Text('Paid: ${money.format(c.amountPaid)}'),
                        Text('Remaining: ${money.format(c.remainingAmount)}'),
                        if (c.isFinalized)
                          const Padding(
                            padding: EdgeInsets.only(top: 4),
                            child:
                                Text('Finalized case (late payment applies)'),
                          ),
                        const SizedBox(height: 8),
                        LinearProgressIndicator(
                          value: progress,
                          minHeight: 8,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        const SizedBox(height: 4),
                        Text(
                            'Progress: ${(progress * 100).toStringAsFixed(0)}%'),
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
}

class _SummaryBox extends StatelessWidget {
  final String label;
  final String value;
  const _SummaryBox({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFDCE3EE)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.labelSmall),
          const SizedBox(height: 3),
          Text(value,
              style:
                  const TextStyle(fontWeight: FontWeight.w800, fontSize: 20)),
        ],
      ),
    );
  }
}

class _SummaryGrid extends StatelessWidget {
  final List<Widget> items;

  const _SummaryGrid({required this.items});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 640
            ? 3
            : constraints.maxWidth >= 360
                ? 2
                : 1;
        final width = (constraints.maxWidth - ((columns - 1) * 10)) / columns;
        return Wrap(
          spacing: 10,
          runSpacing: 8,
          children:
              items.map((item) => SizedBox(width: width, child: item)).toList(),
        );
      },
    );
  }
}
