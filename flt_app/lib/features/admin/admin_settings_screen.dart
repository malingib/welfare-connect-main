import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/services/live_data_service.dart';
import '../../core/widgets/async_error_view.dart';
import '../auth/auth_controller.dart';
import 'admin_shell.dart';

class AdminSettingsScreen extends ConsumerStatefulWidget {
  const AdminSettingsScreen({super.key});

  @override
  ConsumerState<AdminSettingsScreen> createState() =>
      _AdminSettingsScreenState();
}

class _AdminSettingsScreenState extends ConsumerState<AdminSettingsScreen> {
  final LiveDataService _service = LiveDataService();
  final _orgName = TextEditingController();
  final _orgPhone = TextEditingController();
  final _orgEmail = TextEditingController();
  final _paybill = TextEditingController();
  final _whatsappGroupLink = TextEditingController();
  final _registrationFee = TextEditingController();
  final _renewalFee = TextEditingController();
  final _penaltyAmount = TextEditingController();
  final _memberIdStart = TextEditingController();
  final _caseIdStart = TextEditingController();
  final _residenceCtrl = TextEditingController();
  final _mpesaShortcode = TextEditingController();
  final _mpesaConsumerKey = TextEditingController();
  final _mpesaConsumerSecret = TextEditingController();
  final _mpesaPasskey = TextEditingController();
  final _mpesaInitiatorName = TextEditingController();
  final _mpesaInitiatorPassword = TextEditingController();
  String _mpesaEnv = 'sandbox';
  bool _loading = true;
  bool _saving = false;
  int _currentTab = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final token = ref.read(authControllerProvider).appToken;
    if (token == null || token.isEmpty) {
      setState(() => _loading = false);
      return;
    }
    try {
      final s = await _service.fetchSettings(appToken: token);
      if (s != null) {
        _orgName.text = (s['organization_name'] ?? '').toString();
        _orgPhone.text = (s['organization_phone'] ?? '').toString();
        _orgEmail.text = (s['organization_email'] ?? '').toString();
        _paybill.text = (s['paybill_number'] ?? '').toString();
        _whatsappGroupLink.text = (s['whatsapp_group_link'] ?? '').toString();
        _registrationFee.text = (s['registration_fee'] ?? '').toString();
        _renewalFee.text = (s['renewal_fee'] ?? '').toString();
        _penaltyAmount.text = (s['penalty_amount'] ?? '').toString();
        _memberIdStart.text = (s['member_id_start'] ?? '1').toString();
        _caseIdStart.text = (s['case_id_start'] ?? '1').toString();
        _mpesaShortcode.text = (s['mpesa_shortcode'] ?? '').toString();
        _mpesaInitiatorName.text = (s['mpesa_initiator_name'] ?? '').toString();
        _mpesaEnv = (s['mpesa_env'] ?? 'sandbox').toString() == 'production'
            ? 'production'
            : 'sandbox';
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    final token = ref.read(authControllerProvider).appToken;
    if (token == null || token.isEmpty || _saving) return;

    final registrationFee = double.tryParse(_registrationFee.text.trim());
    final renewalFee = double.tryParse(_renewalFee.text.trim());
    final penalty = double.tryParse(_penaltyAmount.text.trim());
    final memberStart = int.tryParse(_memberIdStart.text.trim());
    final caseStart = int.tryParse(_caseIdStart.text.trim());
    final whatsappLink = _whatsappGroupLink.text.trim();
    final whatsappUri =
        whatsappLink.isEmpty ? null : Uri.tryParse(whatsappLink);
    if (registrationFee == null ||
        renewalFee == null ||
        penalty == null ||
        memberStart == null ||
        memberStart < 1 ||
        caseStart == null ||
        caseStart < 1 ||
        (whatsappLink.isNotEmpty &&
            (whatsappUri == null ||
                !whatsappUri.hasScheme ||
                whatsappUri.host.isEmpty))) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content:
                Text('Check fees, positive ID starts, and the WhatsApp link.')),
      );
      return;
    }

    setState(() => _saving = true);
    try {
      final settings = <String, dynamic>{
        'organization_name': _orgName.text.trim(),
        'organization_phone': _orgPhone.text.trim(),
        'organization_email': _orgEmail.text.trim(),
        'paybill_number': _paybill.text.trim(),
        'whatsapp_group_link': _whatsappGroupLink.text.trim(),
        'registration_fee': registrationFee,
        'renewal_fee': renewalFee,
        'penalty_amount': penalty,
        'member_id_start': memberStart,
        'case_id_start': caseStart,
        'mpesa_shortcode': _mpesaShortcode.text.trim(),
        'mpesa_initiator_name': _mpesaInitiatorName.text.trim(),
        'mpesa_env': _mpesaEnv,
      };
      final sensitive = <String, TextEditingController>{
        'mpesa_consumer_key': _mpesaConsumerKey,
        'mpesa_consumer_secret': _mpesaConsumerSecret,
        'mpesa_passkey': _mpesaPasskey,
        'mpesa_initiator_password': _mpesaInitiatorPassword,
      };
      for (final entry in sensitive.entries) {
        final value = entry.value.text.trim();
        if (value.isNotEmpty) settings[entry.key] = value;
      }
      await _service.updateSettings(appToken: token, settings: settings);
      if (!mounted) return;
      for (final controller in sensitive.values) {
        controller.clear();
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Settings saved successfully.')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to save settings: $e')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    for (final controller in [
      _orgName,
      _orgPhone,
      _orgEmail,
      _paybill,
      _whatsappGroupLink,
      _registrationFee,
      _renewalFee,
      _penaltyAmount,
      _memberIdStart,
      _caseIdStart,
      _residenceCtrl,
      _mpesaShortcode,
      _mpesaConsumerKey,
      _mpesaConsumerSecret,
      _mpesaPasskey,
      _mpesaInitiatorName,
      _mpesaInitiatorPassword,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AdminShell(
      title: 'Settings',
      route: '/admin/settings',
      actions: [
        IconButton(
          onPressed: _saving ? null : _save,
          tooltip: 'Save settings',
          icon: _saving
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.save_outlined),
        ),
      ],
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(
                      horizontal: 16.0, vertical: 12),
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
                Expanded(child: _tabContent(_currentTab)),
              ],
            ),
    );
  }

  static const _tabs = <String>[
    'Fees & Payments',
    'ID Config',
    'Residences',
    'Organization',
    'M-Pesa API',
    'SMS',
  ];

  Widget _tabContent(int index) {
    final token = ref.read(authControllerProvider).appToken ?? '';
    switch (index) {
      case 0:
        return _FeesTab(controllers: _controllers());
      case 1:
        return _IdConfigTab(
            memberStart: _memberIdStart, caseStart: _caseIdStart);
      case 2:
        return _ResidencesTab(
            service: _service, token: token, ctrl: _residenceCtrl);
      case 3:
        return _OrganizationTab(
          controllers: _controllers(),
          whatsappGroupLink: _whatsappGroupLink,
        );
      case 4:
        return _MpesaTab(
          shortcode: _mpesaShortcode,
          consumerKey: _mpesaConsumerKey,
          consumerSecret: _mpesaConsumerSecret,
          passkey: _mpesaPasskey,
          initiatorName: _mpesaInitiatorName,
          initiatorPassword: _mpesaInitiatorPassword,
          environment: _mpesaEnv,
          onEnvironmentChanged: (value) => setState(() => _mpesaEnv = value),
          token: token,
          service: _service,
        );
      case 5:
        return _SmsTab(service: _service, token: token);
      default:
        return const SizedBox.shrink();
    }
  }

  Map<String, TextEditingController> _controllers() => {
        'orgName': _orgName,
        'orgPhone': _orgPhone,
        'orgEmail': _orgEmail,
        'paybill': _paybill,
        'regFee': _registrationFee,
        'renFee': _renewalFee,
        'penalty': _penaltyAmount,
      };
}

class _FeesTab extends StatelessWidget {
  final Map<String, TextEditingController> controllers;
  const _FeesTab({required this.controllers});

  @override
  Widget build(BuildContext context) {
    return _formCard(context, [
      TextField(
          controller: controllers['paybill'],
          decoration: const InputDecoration(labelText: 'Paybill number')),
      const SizedBox(height: 12),
      TextField(
          controller: controllers['regFee'],
          decoration: const InputDecoration(labelText: 'Registration fee'),
          keyboardType: TextInputType.number),
      const SizedBox(height: 12),
      TextField(
          controller: controllers['renFee'],
          decoration: const InputDecoration(labelText: 'Renewal fee'),
          keyboardType: TextInputType.number),
      const SizedBox(height: 12),
      TextField(
          controller: controllers['penalty'],
          decoration: const InputDecoration(labelText: 'Penalty amount'),
          keyboardType: TextInputType.number),
    ]);
  }
}

class _OrganizationTab extends StatelessWidget {
  final Map<String, TextEditingController> controllers;
  final TextEditingController whatsappGroupLink;
  const _OrganizationTab(
      {required this.controllers, required this.whatsappGroupLink});

  @override
  Widget build(BuildContext context) {
    return _formCard(context, [
      TextField(
          controller: controllers['orgName'],
          decoration: const InputDecoration(labelText: 'Organization name')),
      const SizedBox(height: 12),
      TextField(
          controller: controllers['orgPhone'],
          decoration: const InputDecoration(labelText: 'Organization phone')),
      const SizedBox(height: 12),
      TextField(
          controller: controllers['orgEmail'],
          decoration: const InputDecoration(labelText: 'Organization email')),
      const SizedBox(height: 12),
      TextField(
          controller: whatsappGroupLink,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(
            labelText: 'Members WhatsApp group link',
            hintText: 'https://chat.whatsapp.com/…',
            helperText:
                'Sent separately to a member after their membership is activated.',
          )),
    ]);
  }
}

class _MpesaTab extends StatelessWidget {
  final TextEditingController shortcode;
  final TextEditingController consumerKey;
  final TextEditingController consumerSecret;
  final TextEditingController passkey;
  final TextEditingController initiatorName;
  final TextEditingController initiatorPassword;
  final String environment;
  final ValueChanged<String> onEnvironmentChanged;
  final String token;
  final LiveDataService service;
  const _MpesaTab({
    required this.shortcode,
    required this.consumerKey,
    required this.consumerSecret,
    required this.passkey,
    required this.initiatorName,
    required this.initiatorPassword,
    required this.environment,
    required this.onEnvironmentChanged,
    required this.token,
    required this.service,
  });

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('M-Pesa API Configuration',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          const SizedBox(height: 12),
          TextField(
              controller: shortcode,
              decoration: const InputDecoration(labelText: 'Shortcode')),
          const SizedBox(height: 12),
          TextField(
              controller: consumerKey,
              decoration: const InputDecoration(labelText: 'Consumer Key')),
          const SizedBox(height: 12),
          TextField(
              controller: consumerSecret,
              decoration: const InputDecoration(labelText: 'Consumer Secret'),
              obscureText: true),
          const SizedBox(height: 12),
          TextField(
              controller: passkey,
              decoration: const InputDecoration(labelText: 'Passkey'),
              obscureText: true),
          const SizedBox(height: 12),
          TextField(
              controller: initiatorName,
              decoration: const InputDecoration(labelText: 'Initiator Name')),
          const SizedBox(height: 12),
          TextField(
              controller: initiatorPassword,
              decoration:
                  const InputDecoration(labelText: 'Initiator Password'),
              obscureText: true),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: environment,
            decoration: const InputDecoration(labelText: 'Environment'),
            items: const [
              DropdownMenuItem(value: 'sandbox', child: Text('Sandbox')),
              DropdownMenuItem(value: 'production', child: Text('Production')),
            ],
            onChanged: (value) {
              if (value != null) onEnvironmentChanged(value);
            },
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: () async {
              try {
                final ok = await service.testMpesaConnection(appToken: token);
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                    content: Text(
                        ok ? 'Connection successful!' : 'Connection failed')));
              } catch (e) {
                if (!context.mounted) return;
                ScaffoldMessenger.of(context)
                    .showSnackBar(SnackBar(content: Text('Error: $e')));
              }
            },
            icon: const Icon(Icons.wifi),
            label: const Text('Test Connection'),
          ),
        ],
      ),
    );
  }
}

class _IdConfigTab extends StatelessWidget {
  final TextEditingController memberStart;
  final TextEditingController caseStart;
  const _IdConfigTab({required this.memberStart, required this.caseStart});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('ID Configuration',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          const SizedBox(height: 12),
          TextField(
              controller: memberStart,
              decoration: const InputDecoration(labelText: 'Member ID Start'),
              keyboardType: TextInputType.number),
          const SizedBox(height: 12),
          TextField(
              controller: caseStart,
              decoration: const InputDecoration(labelText: 'Case ID Start'),
              keyboardType: TextInputType.number),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Text(
                'Preview: M${memberStart.text.padLeft(3, '0')} / C${caseStart.text.padLeft(3, '0')}',
                style: const TextStyle(fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}

class _ResidencesTab extends StatefulWidget {
  final LiveDataService service;
  final String token;
  final TextEditingController ctrl;
  const _ResidencesTab(
      {required this.service, required this.token, required this.ctrl});

  @override
  State<_ResidencesTab> createState() => _ResidencesTabState();
}

class _ResidencesTabState extends State<_ResidencesTab> {
  late Future<List<String>> _future;
  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<String>> _load() async {
    return widget.service.fetchResidences().timeout(
          const Duration(seconds: 20),
          onTimeout: () => throw Exception(
            'Loading residences timed out. Check your connection and try again.',
          ),
        );
  }

  Future<void> _add() async {
    final name = widget.ctrl.text.trim();
    if (name.isEmpty) return;
    try {
      await widget.service.createResidence(name: name);
      widget.ctrl.clear();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Added residence: $name')),
      );
      setState(() => _future = _load());
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to add residence: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                  child: TextField(
                      controller: widget.ctrl,
                      decoration:
                          const InputDecoration(labelText: 'New residence'))),
              const SizedBox(width: 8),
              FilledButton(onPressed: _add, child: const Text('Add')),
            ],
          ),
        ),
        Expanded(
          child: FutureBuilder<List<String>>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return AsyncErrorView(
                  error: snapshot.error,
                  onRetry: () => setState(() => _future = _load()),
                );
              }
              final list = snapshot.data ?? const [];
              if (list.isEmpty) {
                return const Center(child: Text('No residences configured.'));
              }
              return ListView.builder(
                itemCount: list.length,
                itemBuilder: (_, i) => ListTile(title: Text(list[i])),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _SmsTab extends StatefulWidget {
  final LiveDataService service;
  final String token;
  const _SmsTab({required this.service, required this.token});

  @override
  State<_SmsTab> createState() => _SmsTabState();
}

class _SmsTabState extends State<_SmsTab> {
  late Future<_SmsSettingsData> _settingsFuture;
  int _section = 0;
  final Map<String, List<String>> _pendingRecipients = {};
  String? _savingTrigger;

  static const _alertEvents = <(String, String, String)>[
    (
      'registration_submitted',
      'Registration submitted',
      'A new membership application was submitted.'
    ),
    (
      'registration_pending_review',
      'Registration pending review',
      'An application awaits committee review.'
    ),
    (
      'registration_approved',
      'Registration approved',
      'An applicant was approved and should pay.'
    ),
    (
      'registration_payment_pending',
      'Registration payment pending',
      'An approved applicant has not paid.'
    ),
    (
      'registration_payment_received',
      'Registration payment received',
      'Payment awaits administrator verification.'
    ),
    (
      'registration_activated',
      'Membership activated',
      'Verified payment created a member account.'
    ),
    (
      'registration_expired',
      'Application expired',
      'An application expired after one week.'
    ),
    (
      'whatsapp_group_invite',
      'WhatsApp invitation',
      'A group invitation was sent after activation.'
    ),
    (
      'registration_rejected',
      'Registration rejected',
      'An application was rejected.'
    ),
    ('payment_received', 'Payment received', 'A member payment was received.'),
    (
      'payment_failed',
      'Payment failed',
      'A payment failed or needs attention.'
    ),
    ('case_opened', 'Case opened', 'A welfare case was opened.'),
    ('case_closed', 'Case closed', 'A welfare case was closed.'),
    ('status_changed', 'Member status changed', 'A member status changed.'),
    ('auto_inactive', 'Suspension / inactive', 'A member became inactive.'),
    ('penalty_posted', 'Penalty posted', 'A member penalty was posted.'),
    (
      'probation_ending',
      'Probation ending',
      'A member probation period is ending.'
    ),
    (
      'probation_completed',
      'Probation completed',
      'A member completed probation.'
    ),
    (
      'closed_case_overdue',
      'Closed case overdue',
      'A closed-case balance remains unpaid.'
    ),
  ];

  @override
  void initState() {
    super.initState();
    _settingsFuture = _loadSettings();
  }

  Future<_SmsSettingsData> _loadSettings() async {
    final values = await Future.wait([
      widget.service.fetchSmsTemplates(appToken: widget.token),
      widget.service.fetchSmsAlertSettings(appToken: widget.token),
      widget.service.fetchAdminUsers(appToken: widget.token),
    ]);
    final admins = values[2]
        .where((user) =>
            user['is_active'] == true &&
            user['role'] != 'member' &&
            (user['phone_number']?.toString().trim().isNotEmpty ?? false))
        .toList();
    return _SmsSettingsData(
      templates: values[0],
      recipients: values[1],
      admins: admins,
    );
  }

  Future<void> _showComposer(Map<String, dynamic> template) async {
    final ctrl = TextEditingController(
        text: (template['raw_template'] ?? '').toString());
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Edit: ${template['label'] ?? template['trigger_key']}'),
        content: TextField(
          controller: ctrl,
          maxLines: 5,
          decoration: const InputDecoration(labelText: 'Template'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Save')),
        ],
      ),
    );
    if (saved == true) {
      try {
        await widget.service.updateSmsTemplate(
          appToken: widget.token,
          triggerKey: '${template['trigger_key']}',
          updates: {'raw_template': ctrl.text},
        );
        if (!mounted) return;
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Template updated')));
        setState(() => _settingsFuture = _loadSettings());
      } catch (e) {
        if (!mounted) return;
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Error: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<_SmsSettingsData>(
      future: _settingsFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return Center(
              child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text('Could not load SMS settings: ${snapshot.error}',
                  textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(
                  onPressed: () =>
                      setState(() => _settingsFuture = _loadSettings()),
                  child: const Text('Try again')),
            ]),
          ));
        }
        final data = snapshot.data!;
        return Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: SegmentedButton<int>(
              showSelectedIcon: false,
              segments: const [
                ButtonSegment(value: 0, label: Text('Templates')),
                ButtonSegment(value: 1, label: Text('Alert recipients')),
              ],
              selected: {_section},
              onSelectionChanged: (value) =>
                  setState(() => _section = value.first),
            ),
          ),
          Expanded(
            child: _section == 0
                ? _templateList(data.templates)
                : _recipientList(data),
          ),
        ]);
      },
    );
  }

  Widget _templateList(List<Map<String, dynamic>> templates) {
    if (templates.isEmpty) {
      return const Center(child: Text('No SMS templates configured.'));
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: templates.length,
      itemBuilder: (_, i) {
        final template = templates[i];
        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          child: ListTile(
            title: Text('${template['label'] ?? template['trigger_key']}'),
            subtitle: Text(
                '${template['description'] ?? ''}\n${template['raw_template'] ?? ''}',
                maxLines: 3,
                overflow: TextOverflow.ellipsis),
            trailing: const Icon(Icons.edit_outlined),
            onTap: () => _showComposer(template),
          ),
        );
      },
    );
  }

  Widget _recipientList(_SmsSettingsData data) {
    if (data.admins.isEmpty) {
      return const Center(
          child: Padding(
        padding: EdgeInsets.all(24),
        child: Text(
            'No active administrators with linked phone numbers were found.',
            textAlign: TextAlign.center),
      ));
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
            'Choose which administrators receive copies of each alert. An admin must have an active account and a linked phone number.',
            style: Theme.of(context).textTheme.bodyMedium),
        const SizedBox(height: 12),
        ..._alertEvents.map((event) {
          final trigger = event.$1;
          final stored = data.recipients.firstWhere(
            (setting) => setting['trigger_key'] == trigger,
            orElse: () => const <String, dynamic>{},
          );
          final currentIds = _pendingRecipients[trigger] ??
              ((stored['admin_user_ids'] as List?) ?? const [])
                  .map((id) => id.toString())
                  .toList();
          return Card(
            margin: const EdgeInsets.only(bottom: 10),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(event.$2,
                        style: Theme.of(context).textTheme.titleSmall),
                    const SizedBox(height: 2),
                    Text(event.$3,
                        style: Theme.of(context).textTheme.bodySmall),
                    const SizedBox(height: 6),
                    ...data.admins.map((admin) {
                      final id = '${admin['id']}';
                      return CheckboxListTile(
                        value: currentIds.contains(id),
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                            '${admin['name'] ?? admin['username'] ?? 'Administrator'}'),
                        subtitle: Text(
                            '${admin['role'] ?? ''} · ${admin['phone_number']}'),
                        onChanged: (checked) => setState(() {
                          _pendingRecipients[trigger] = checked == true
                              ? [...currentIds, id]
                              : currentIds
                                  .where((selected) => selected != id)
                                  .toList();
                        }),
                      );
                    }),
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton.tonalIcon(
                        onPressed: _savingTrigger == trigger
                            ? null
                            : () => _saveRecipients(trigger, currentIds),
                        icon: _savingTrigger == trigger
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.save_outlined),
                        label: Text(_savingTrigger == trigger
                            ? 'Saving…'
                            : 'Save recipients'),
                      ),
                    ),
                  ]),
            ),
          );
        }),
      ],
    );
  }

  Future<void> _saveRecipients(String trigger, List<String> ids) async {
    setState(() => _savingTrigger = trigger);
    try {
      await widget.service.updateSmsAlertRecipients(
        appToken: widget.token,
        triggerKey: trigger,
        adminUserIds: ids,
      );
      if (!mounted) return;
      setState(() {
        _pendingRecipients.remove(trigger);
        _settingsFuture = _loadSettings();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('SMS alert recipients saved.')),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not save recipients: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _savingTrigger = null);
    }
  }
}

class _SmsSettingsData {
  const _SmsSettingsData(
      {required this.templates,
      required this.recipients,
      required this.admins});
  final List<Map<String, dynamic>> templates;
  final List<Map<String, dynamic>> recipients;
  final List<Map<String, dynamic>> admins;
}

Widget _formCard(BuildContext context, List<Widget> children) {
  return SingleChildScrollView(
    padding: const EdgeInsets.all(16),
    child: Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: Color(0xFFE2E8F0)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(children: children),
      ),
    ),
  );
}
