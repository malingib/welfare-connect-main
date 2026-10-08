import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/constants/app_constants.dart';
import '../../core/services/live_data_service.dart';
import '../../core/widgets/async_error_view.dart';
import '../auth/auth_controller.dart';
import 'member_shell.dart';

class MemberSummaryScreen extends ConsumerStatefulWidget {
  const MemberSummaryScreen({super.key});

  @override
  ConsumerState<MemberSummaryScreen> createState() =>
      _MemberSummaryScreenState();
}

class _MemberSummaryScreenState extends ConsumerState<MemberSummaryScreen> {
  final _service = LiveDataService();
  late Future<Map<String, dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Map<String, dynamic>> _load() {
    final auth = ref.read(authControllerProvider);
    if ((auth.memberId ?? '').isEmpty || (auth.appToken ?? '').isEmpty) {
      throw Exception('Session missing member identity. Please log in again.');
    }
    return _service.fetchMemberSummary(
      memberId: auth.memberId!,
      appToken: auth.appToken!,
    );
  }

  @override
  Widget build(BuildContext context) {
    return MemberShell(
      title: 'My Profile',
      subtitle: 'Member summary',
      currentIndex: 0,
      actions: [
        IconButton(
            onPressed: () => setState(() => _future = _load()),
            icon: const Icon(Icons.refresh)),
      ],
      body: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return AsyncErrorView(error: snapshot.error, onRetry: () => setState(() => _future = _load()));
          }

          final member =
              (snapshot.data?['member'] as Map?)?.cast<String, dynamic>() ??
                  const {};
          return ListView(
            padding: const EdgeInsets.all(AppConstants.marginEdge),
            children: [
              _row('Name', '${member['name'] ?? '-'}'),
              _row('Member Number', '${member['member_number'] ?? '-'}'),
              _row('Phone', '${member['phone_number'] ?? '-'}'),
              _row('Status', '${member['status'] ?? '-'}'),
              _row('Residence', '${member['residence'] ?? '-'}'),
            ],
          );
        },
      ),
    );
  }

  Widget _row(String label, String value) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFDCE3EE)),
      ),
      child: Row(
        children: [
          Expanded(
              child: Text(label,
                  style: const TextStyle(fontWeight: FontWeight.w700))),
          Expanded(child: Text(value, textAlign: TextAlign.right)),
        ],
      ),
    );
  }
}
