import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/services/supabase_service.dart';
import '../auth/auth_controller.dart';
import 'admin_shell.dart';

class AdminApplicationsScreen extends ConsumerStatefulWidget {
  const AdminApplicationsScreen({super.key});

  @override
  ConsumerState<AdminApplicationsScreen> createState() =>
      _AdminApplicationsScreenState();
}

class _AdminApplicationsScreenState
    extends ConsumerState<AdminApplicationsScreen> {
  final _service = SupabaseService();
  List<Map<String, dynamic>> _applications = [];
  bool _loading = true;
  String? _error;
  String _filter = 'all';
  String? _workingId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final token = ref.read(authControllerProvider).appToken;
    if (token == null || token.isEmpty) {
      setState(() {
        _loading = false;
        _error = 'Your session has expired. Sign in again.';
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final response = await _service.invokeFunction(
        'api-membership-applications',
        body: {'action': 'list'},
        headers: {'x-app-token': token},
      );
      if (response.status < 200 || response.status >= 300) {
        final payload = (response.data as Map?)?.cast<String, dynamic>();
        throw Exception(payload?['error'] ?? 'Could not load applications.');
      }
      final payload = (response.data as Map?)?.cast<String, dynamic>() ?? {};
      final rows = (payload['applications'] as List?) ?? const [];
      if (!mounted) return;
      setState(() => _applications = rows
          .whereType<Map>()
          .map((row) => row.cast<String, dynamic>())
          .toList());
    } catch (error) {
      if (mounted) {
        setState(
            () => _error = error.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _act(Map<String, dynamic> application, String action,
      {String? decision, String? reason}) async {
    final token = ref.read(authControllerProvider).appToken;
    if (token == null || token.isEmpty) return;
    final id = '${application['id'] ?? ''}';
    if (id.isEmpty) return;
    setState(() => _workingId = id);
    try {
      final response = await _service.invokeFunction(
        'api-membership-applications',
        body: {
          'action': action,
          'application_id': id,
          if (decision != null) 'decision': decision,
          if (reason != null) 'reason': reason,
        },
        headers: {'x-app-token': token},
      );
      if (response.status < 200 || response.status >= 300) {
        final payload = (response.data as Map?)?.cast<String, dynamic>();
        throw Exception(payload?['error'] ?? 'Could not update application.');
      }
      if (!mounted) return;
      final payload = (response.data as Map?)?.cast<String, dynamic>() ?? {};
      final memberNumber = payload['member_number']?.toString();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(memberNumber == null
            ? action == 'review'
                ? (decision == 'approve'
                    ? 'Application approved; payment requested.'
                    : 'Application rejected.')
                : 'Application updated.'
            : 'Membership activated. Member number: $memberNumber'),
      ));
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(error.toString().replaceFirst('Exception: ', ''))),
        );
      }
    } finally {
      if (mounted) setState(() => _workingId = null);
    }
  }

  Future<void> _review(
      Map<String, dynamic> application, String decision) async {
    String reason = '';
    if (decision == 'reject') {
      final controller = TextEditingController();
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Reject application?'),
          content: TextField(
            controller: controller,
            maxLines: 3,
            decoration: const InputDecoration(labelText: 'Reason (optional)'),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Reject')),
          ],
        ),
      );
      reason = controller.text.trim();
      controller.dispose();
      if (confirmed != true) return;
    } else {
      final confirmed = await _confirm(
        'Approve application?',
        'The applicant will be sent payment instructions for the registration fee.',
        'Approve and request payment',
      );
      if (!confirmed) return;
    }
    await _act(application, 'review', decision: decision, reason: reason);
  }

  Future<void> _activate(Map<String, dynamic> application) async {
    final confirmed = await _confirm(
      'Activate membership?',
      'Confirm only after the payment receipt has been verified. This creates the member account and queues the member SMS and WhatsApp invitation.',
      'Confirm and activate',
    );
    if (confirmed) await _act(application, 'confirm_payment');
  }

  Future<bool> _confirm(String title, String message, String action) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: Text(action)),
          ],
        ),
      ) ??
      false;

  @override
  Widget build(BuildContext context) {
    final applications = _applications
        .where((application) =>
            _filter == 'all' || application['status'] == _filter)
        .toList();
    return AdminShell(
      title: 'Membership applications',
      route: '/admin/applications',
      actions: [
        IconButton(
            tooltip: 'Refresh',
            onPressed: _load,
            icon: const Icon(Icons.refresh))
      ],
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.cloud_off_outlined, size: 40),
                  const SizedBox(height: 8),
                  Text(_error!, textAlign: TextAlign.center),
                  const SizedBox(height: 12),
                  FilledButton(
                      onPressed: _load, child: const Text('Try again')),
                ]))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: CustomScrollView(
                    slivers: [
                      SliverPadding(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                        sliver: SliverToBoxAdapter(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text(
                                  'Review, verify payment, and activate new members.',
                                  style:
                                      Theme.of(context).textTheme.bodyMedium),
                              const SizedBox(height: 14),
                              DropdownButtonFormField<String>(
                                initialValue: _filter,
                                decoration: const InputDecoration(
                                    labelText: 'Filter by status'),
                                items: const [
                                  DropdownMenuItem(
                                      value: 'all',
                                      child: Text('All applications')),
                                  DropdownMenuItem(
                                      value: 'pending_review',
                                      child: Text('Pending review')),
                                  DropdownMenuItem(
                                      value: 'payment_pending',
                                      child: Text('Payment pending')),
                                  DropdownMenuItem(
                                      value: 'activated',
                                      child: Text('Activated')),
                                  DropdownMenuItem(
                                      value: 'rejected',
                                      child: Text('Rejected')),
                                  DropdownMenuItem(
                                      value: 'expired', child: Text('Expired')),
                                ],
                                onChanged: (value) =>
                                    setState(() => _filter = value ?? 'all'),
                              ),
                              const SizedBox(height: 12),
                              if (applications.isEmpty)
                                const Padding(
                                  padding: EdgeInsets.symmetric(vertical: 48),
                                  child: Column(children: [
                                    Icon(Icons.inbox_outlined, size: 40),
                                    SizedBox(height: 8),
                                    Text('No applications in this view.'),
                                  ]),
                                ),
                            ],
                          ),
                        ),
                      ),
                      if (applications.isNotEmpty)
                        SliverPadding(
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                          sliver: SliverList.builder(
                            itemCount: applications.length,
                            itemBuilder: (context, index) =>
                                _applicationCard(applications[index]),
                          ),
                        ),
                    ],
                  ),
                ),
    );
  }

  Widget _applicationCard(Map<String, dynamic> application) {
    final id = '${application['id'] ?? ''}';
    final status = '${application['status'] ?? 'unknown'}';
    final busy = _workingId == id;
    final colors = Theme.of(context).colorScheme;
    final statusBackground = status == 'activated'
        ? const Color(0xFFE3F4E8)
        : status == 'payment_pending'
            ? const Color(0xFFFFF1D6)
            : colors.secondaryContainer;
    final statusForeground = status == 'activated'
        ? const Color(0xFF155B2B)
        : status == 'payment_pending'
            ? const Color(0xFF744700)
            : colors.onSecondaryContainer;
    final location = application['residence_status'] == 'resident'
        ? application['village']
        : application['current_location'];
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text('${application['full_name'] ?? 'Applicant'}',
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 3),
                  Text(
                      '${application['application_reference'] ?? '-'}  ·  ${application['phone_number'] ?? '-'}'),
                  Text('${location ?? 'Residence not provided'}',
                      style: Theme.of(context).textTheme.bodySmall),
                ])),
            Chip(
              backgroundColor: statusBackground,
              side: BorderSide.none,
              label: Text(
                status.replaceAll('_', ' '),
                style: TextStyle(
                  color: statusForeground,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ]),
          if (application['payment_code'] != null) ...[
            const SizedBox(height: 6),
            Text('Payment code: ${application['payment_code']}'),
            Text(
                'Payment status: ${application['payment_status'] ?? 'pending'}'),
          ],
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 4, children: [
            OutlinedButton.icon(
              onPressed: () => _showDetails(application),
              icon: const Icon(Icons.info_outline),
              label: const Text('Details'),
            ),
            if (status == 'pending_review') ...[
              FilledButton.icon(
                onPressed: busy ? null : () => _review(application, 'approve'),
                icon: const Icon(Icons.check),
                label: const Text('Approve'),
              ),
              OutlinedButton.icon(
                onPressed: busy ? null : () => _review(application, 'reject'),
                icon: const Icon(Icons.close),
                label: const Text('Reject'),
              ),
            ],
            if (status == 'payment_pending')
              FilledButton.icon(
                onPressed: busy || application['payment_receipt'] == null
                    ? null
                    : () => _activate(application),
                icon: busy
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.verified_outlined),
                label: Text(application['payment_receipt'] == null
                    ? 'Awaiting payment verification'
                    : 'Verify & activate'),
              ),
          ]),
        ]),
      ),
    );
  }

  void _showDetails(Map<String, dynamic> application) {
    final kin =
        (application['next_of_kin'] as Map?)?.cast<String, dynamic>() ?? {};
    final dependants = (application['dependants'] as List?) ?? const [];
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: DraggableScrollableSheet(
          expand: false,
          initialChildSize: .82,
          builder: (context, controller) => ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
            children: [
              Text('${application['full_name'] ?? 'Application'}',
                  style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 12),
              _detail('Reference', application['application_reference']),
              _detail('National ID', application['national_id_number']),
              _detail('Date of birth', application['date_of_birth']),
              _detail('Gender', application['gender']),
              _detail('Phone', application['phone_number']),
              _detail(
                  'Alternative phone', application['alternative_phone_number']),
              _detail('Email', application['email_address']),
              _detail('Residence',
                  application['village'] ?? application['current_location']),
              const Divider(height: 24),
              Text('Next of kin',
                  style: Theme.of(context).textTheme.titleMedium),
              _detail('Name', kin['name']),
              _detail('Relationship', kin['relationship']),
              _detail('Phone', kin['phone_number'] ?? kin['phoneNumber']),
              const Divider(height: 24),
              Text('Dependants (${dependants.length})',
                  style: Theme.of(context).textTheme.titleMedium),
              ...dependants.whereType<Map>().map((d) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    title:
                        Text('${d['full_name'] ?? d['name'] ?? 'Dependant'}'),
                    subtitle: Text(
                        '${d['relationship'] ?? ''}  ${d['date_of_birth'] ?? ''}'),
                  )),
              const Divider(height: 24),
              _detail('Application status', application['status']),
              _detail('Payment code', application['payment_code']),
              _detail('Payment status', application['payment_status']),
              _detail('Receipt', application['payment_receipt']),
              _detail('Payment amount', application['payment_amount']),
              _detail('Review reason', application['review_reason']),
            ],
          ),
        ),
      ),
    );
  }

  Widget _detail(String label, dynamic value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(
              width: 142,
              child: Text(label, style: Theme.of(context).textTheme.bodySmall)),
          Expanded(
              child: SelectableText(value == null || value.toString().isEmpty
                  ? '—'
                  : value.toString())),
        ]),
      );
}
