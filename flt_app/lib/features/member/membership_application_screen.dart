import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class MembershipApplicationScreen extends StatefulWidget {
  const MembershipApplicationScreen({super.key});

  @override
  State<MembershipApplicationScreen> createState() =>
      _MembershipApplicationScreenState();
}

class _MembershipApplicationScreenState
    extends State<MembershipApplicationScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _nationalId = TextEditingController();
  final _dob = TextEditingController();
  final _phone = TextEditingController();
  final _alternativePhone = TextEditingController();
  final _email = TextEditingController();
  final _location = TextEditingController();
  final _kinName = TextEditingController();
  final _kinRelationship = TextEditingController();
  final _kinPhone = TextEditingController();
  final _dependants = <_DependantFields>[_DependantFields()];
  String? _gender;
  String _residenceStatus = 'resident';
  String? _village;
  bool _declarationAccepted = false;
  bool _submitting = false;
  String? _applicationReference;

  static const _villages = [
    'Kabiranduni',
    'Chembe',
    'Kibaoni',
    'Ziani',
    'Soyosoyo',
    'Muthoroni',
    'Yembe',
    'Majengo',
    'Ngamani',
    'Kadzitosoni',
    'Kisimani',
    'Bahati',
    'Muungano',
    'Malanga',
  ];

  @override
  void dispose() {
    for (final controller in [
      _name,
      _nationalId,
      _dob,
      _phone,
      _alternativePhone,
      _email,
      _location,
      _kinName,
      _kinRelationship,
      _kinPhone,
    ]) {
      controller.dispose();
    }
    for (final dependant in _dependants) {
      dependant.dispose();
    }
    super.dispose();
  }

  String? _required(String? value) =>
      value == null || value.trim().isEmpty ? 'This field is required' : null;

  Future<void> _chooseDate() async {
    final today = DateTime.now();
    final initial = DateTime.tryParse(_dob.text) ?? DateTime(today.year - 25);
    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(1900),
      lastDate: today,
      helpText: 'Select date of birth',
    );
    if (date != null) {
      _dob.text = '${date.year.toString().padLeft(4, '0')}-'
          '${date.month.toString().padLeft(2, '0')}-'
          '${date.day.toString().padLeft(2, '0')}';
      setState(() {});
    }
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;
    if (!_declarationAccepted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Please accept the declaration to continue.')),
      );
      return;
    }
    setState(() => _submitting = true);
    try {
      final response = await Supabase.instance.client.functions.invoke(
        'api-membership-applications',
        body: {
          'action': 'submit',
          'full_name': _name.text.trim(),
          'national_id_number': _nationalId.text.trim(),
          'date_of_birth': _dob.text.trim(),
          'gender': _gender,
          'phone_number': _phone.text.trim(),
          'alternative_phone_number': _alternativePhone.text.trim(),
          'email_address': _email.text.trim(),
          'residence_status': _residenceStatus,
          'village': _residenceStatus == 'resident' && _village != null
              ? 'Malanga - $_village'
              : null,
          'current_location':
              _residenceStatus == 'non_resident' ? _location.text.trim() : null,
          'dependants': _dependants
              .where((d) => d.name.text.trim().isNotEmpty)
              .map((d) => {
                    'full_name': d.name.text.trim(),
                    'relationship': d.relationship.text.trim(),
                    'date_of_birth': d.dateOfBirth.text.trim(),
                  })
              .toList(),
          'next_of_kin': {
            'name': _kinName.text.trim(),
            'relationship': _kinRelationship.text.trim(),
            'phone_number': _kinPhone.text.trim(),
          },
          'declaration_accepted': true,
        },
      );
      if (response.status < 200 || response.status >= 300) {
        final payload = response.data;
        final message = payload is Map ? payload['error']?.toString() : null;
        throw Exception(message ?? 'Could not submit your application.');
      }
      final payload = (response.data as Map?)?.cast<String, dynamic>() ?? {};
      final application =
          (payload['application'] as Map?)?.cast<String, dynamic>() ?? {};
      setState(() => _applicationReference =
          application['application_reference']?.toString() ?? '');
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(error.toString().replaceFirst('Exception: ', ''))),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_applicationReference != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Application received')),
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.check_circle_outline,
                      size: 64, color: Colors.green),
                  const SizedBox(height: 16),
                  Text('Your application is with the Welfare Committee.',
                      style: Theme.of(context).textTheme.titleLarge,
                      textAlign: TextAlign.center),
                  const SizedBox(height: 12),
                  const Text('Keep this reference for future communication:'),
                  SelectableText(_applicationReference!,
                      style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 12),
                  const Text(
                      'We will send updates to the phone number you provided.',
                      textAlign: TextAlign.center),
                  const SizedBox(height: 24),
                  FilledButton.icon(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.login),
                    label: const Text('Return to sign in'),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Membership application')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: Form(
            key: _formKey,
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text('Apply to join Malanga Welfare',
                    style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 8),
                const Text(
                    'Applicants must be 18–75 years old. Complete the details below; the committee will review your application before payment is requested.'),
                const SizedBox(height: 20),
                _section('Personal information', [
                  _field(_name, 'Full name as on National ID',
                      validator: _required,
                      textCapitalization: TextCapitalization.words),
                  _field(_nationalId, 'National ID number',
                      validator: _required, keyboardType: TextInputType.number),
                  TextFormField(
                    controller: _dob,
                    readOnly: true,
                    onTap: _chooseDate,
                    decoration: const InputDecoration(
                      labelText: 'Date of birth',
                      suffixIcon: Icon(Icons.calendar_today),
                    ),
                    validator: _required,
                  ),
                  DropdownButtonFormField<String>(
                    initialValue: _gender,
                    decoration: const InputDecoration(labelText: 'Gender'),
                    items: const ['Female', 'Male', 'Other']
                        .map((v) => DropdownMenuItem(value: v, child: Text(v)))
                        .toList(),
                    onChanged: (v) => setState(() => _gender = v),
                    validator: (v) => v == null ? 'Select a gender' : null,
                  ),
                  _field(_phone, 'Mobile phone number',
                      validator: _required, keyboardType: TextInputType.phone),
                  _field(_alternativePhone, 'Alternative phone (optional)',
                      keyboardType: TextInputType.phone),
                  _field(_email, 'Email (optional)',
                      keyboardType: TextInputType.emailAddress),
                ]),
                const SizedBox(height: 16),
                _section('Residence', [
                  DropdownButtonFormField<String>(
                    initialValue: _residenceStatus,
                    decoration: const InputDecoration(
                        labelText: 'Are you a resident of Malanga?'),
                    items: const [
                      DropdownMenuItem(value: 'resident', child: Text('Yes')),
                      DropdownMenuItem(
                          value: 'non_resident', child: Text('No')),
                    ],
                    onChanged: (v) =>
                        setState(() => _residenceStatus = v ?? 'resident'),
                  ),
                  if (_residenceStatus == 'resident')
                    DropdownButtonFormField<String>(
                      initialValue: _village,
                      decoration:
                          const InputDecoration(labelText: 'Malanga village'),
                      items: _villages
                          .map(
                              (v) => DropdownMenuItem(value: v, child: Text(v)))
                          .toList(),
                      onChanged: (v) => setState(() => _village = v),
                      validator: (v) =>
                          v == null ? 'Select your village' : null,
                    )
                  else
                    _field(_location, 'Current residence/location',
                        validator: _required),
                ]),
                const SizedBox(height: 16),
                _section('Dependants (optional)', [
                  ...List.generate(_dependants.length, (index) {
                    final dependant = _dependants[index];
                    return Column(
                      children: [
                        Row(children: [
                          Expanded(child: _field(dependant.name, 'Full name')),
                          if (_dependants.length > 1)
                            IconButton(
                              tooltip: 'Remove dependant',
                              onPressed: () => setState(() {
                                _dependants.removeAt(index).dispose();
                              }),
                              icon: const Icon(Icons.remove_circle_outline),
                            ),
                        ]),
                        _field(dependant.relationship, 'Relationship'),
                        TextFormField(
                          controller: dependant.dateOfBirth,
                          readOnly: true,
                          onTap: () async {
                            final date = await showDatePicker(
                              context: context,
                              initialDate: DateTime(2015),
                              firstDate: DateTime(1900),
                              lastDate: DateTime.now(),
                            );
                            if (date != null) {
                              dependant.dateOfBirth.text = '${date.year}-'
                                  '${date.month.toString().padLeft(2, '0')}-'
                                  '${date.day.toString().padLeft(2, '0')}';
                            }
                          },
                          decoration: const InputDecoration(
                              labelText: 'Date of birth (optional)'),
                        ),
                      ],
                    );
                  }),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: () =>
                          setState(() => _dependants.add(_DependantFields())),
                      icon: const Icon(Icons.add),
                      label: const Text('Add dependant'),
                    ),
                  ),
                ]),
                const SizedBox(height: 16),
                _section('Next of kin', [
                  _field(_kinName, 'Full name',
                      validator: _required,
                      textCapitalization: TextCapitalization.words),
                  _field(_kinRelationship, 'Relationship',
                      validator: _required),
                  _field(_kinPhone, 'Phone number',
                      validator: _required, keyboardType: TextInputType.phone),
                ]),
                const SizedBox(height: 8),
                CheckboxListTile(
                  value: _declarationAccepted,
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  onChanged: (value) =>
                      setState(() => _declarationAccepted = value ?? false),
                  title: const Text(
                      'I declare that the information provided is true and accurate.'),
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: _submitting ? null : _submit,
                  icon: _submitting
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.send),
                  label:
                      Text(_submitting ? 'Submitting…' : 'Submit application'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _section(String title, List<Widget> children) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 10),
            ...children.map((child) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: child,
                )),
          ]),
        ),
      );

  Widget _field(
    TextEditingController controller,
    String label, {
    String? Function(String?)? validator,
    TextInputType? keyboardType,
    TextCapitalization textCapitalization = TextCapitalization.none,
  }) =>
      TextFormField(
        controller: controller,
        validator: validator,
        keyboardType: keyboardType,
        textCapitalization: textCapitalization,
        decoration: InputDecoration(labelText: label),
      );
}

class _DependantFields {
  final name = TextEditingController();
  final relationship = TextEditingController();
  final dateOfBirth = TextEditingController();

  void dispose() {
    name.dispose();
    relationship.dispose();
    dateOfBirth.dispose();
  }
}
