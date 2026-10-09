import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:posthog_flutter/posthog_flutter.dart';

import '../../core/services/live_data_service.dart';
import '../../core/widgets/async_error_view.dart';
import '../auth/auth_controller.dart';
import 'member_shell.dart';

class DependantsScreen extends ConsumerStatefulWidget {
  const DependantsScreen({super.key});

  @override
  ConsumerState<DependantsScreen> createState() => _DependantsScreenState();
}

class _DependantsScreenState extends ConsumerState<DependantsScreen> {
  final LiveDataService _service = LiveDataService();
  late Future<List<MemberDependant>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<MemberDependant>> _load() async {
    final auth = ref.read(authControllerProvider);
    if ((auth.memberId ?? '').isEmpty) {
      throw Exception('Missing member session');
    }
    return _service.fetchDependants(auth.memberId!).timeout(
          const Duration(seconds: 20),
          onTimeout: () => throw Exception(
            'Loading dependants timed out. Check your connection and try again.',
          ),
        );
  }

  void _refresh() => setState(() => _future = _load());

  Future<void> _addDependant() async {
    final auth = ref.read(authControllerProvider);
    if ((auth.memberId ?? '').isEmpty) return;
    final result = await _showDependantForm(context);
    if (result == null) return;
    try {
      await _service.addDependant(memberId: auth.memberId!, dependant: result);
      Posthog().capture(eventName: 'dependant_added');
      _refresh();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to add dependant: $e')),
        );
      }
    }
  }

  Future<void> _editDependant(MemberDependant dependant) async {
    final result = await _showDependantForm(context, initial: dependant);
    if (result == null) return;
    try {
      await _service.updateDependant(
          dependantId: dependant.id, dependant: result);
      Posthog().capture(eventName: 'dependant_updated');
      _refresh();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update dependant: $e')),
        );
      }
    }
  }

  Future<void> _deleteDependant(MemberDependant dependant) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Dependant'),
        content: Text('Remove ${dependant.name} as a dependant?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await _service.deleteDependant(dependant.id);
      Posthog().capture(eventName: 'dependant_deleted');
      _refresh();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to delete dependant: $e')),
        );
      }
    }
  }

  Future<MemberDependant?> _showDependantForm(
    BuildContext context, {
    MemberDependant? initial,
  }) async {
    final isEditing = initial != null;
    final nameCtrl = TextEditingController(text: initial?.name ?? '');
    String gender = initial?.gender ?? 'male';
    String relationship = initial?.relationship ?? 'Child';
    DateTime? dob;
    if (initial?.dateOfBirth != null && initial!.dateOfBirth!.isNotEmpty) {
      dob = DateTime.tryParse(initial.dateOfBirth!);
    }
    bool isDisabled = initial?.isDisabled ?? false;
    bool isEligible = initial?.isEligible ?? true;

    return showDialog<MemberDependant>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setDialogState) {
            return AlertDialog(
              title: Text(isEditing ? 'Edit Dependant' : 'Add Dependant'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(
                      controller: nameCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Full Name',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    InputDecorator(
                      decoration: const InputDecoration(
                        labelText: 'Gender',
                        border: OutlineInputBorder(),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: gender,
                          isDense: true,
                          isExpanded: true,
                          items: const [
                            DropdownMenuItem(
                                value: 'male', child: Text('Male')),
                            DropdownMenuItem(
                                value: 'female', child: Text('Female')),
                          ],
                          onChanged: (v) =>
                              setDialogState(() => gender = v ?? 'male'),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    InputDecorator(
                      decoration: const InputDecoration(
                        labelText: 'Relationship',
                        border: OutlineInputBorder(),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: relationship,
                          isDense: true,
                          isExpanded: true,
                          items: const [
                            DropdownMenuItem(
                                value: 'Spouse', child: Text('Spouse')),
                            DropdownMenuItem(
                                value: 'Child', child: Text('Child')),
                            DropdownMenuItem(
                                value: 'Parent', child: Text('Parent')),
                            DropdownMenuItem(
                                value: 'Sibling', child: Text('Sibling')),
                            DropdownMenuItem(
                                value: 'Other', child: Text('Other')),
                          ],
                          onChanged: (v) =>
                              setDialogState(() => relationship = v ?? 'Child'),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    InkWell(
                      onTap: () async {
                        final picked = await showDatePicker(
                          context: ctx,
                          initialDate: dob ?? DateTime.now(),
                          firstDate: DateTime(1950),
                          lastDate: DateTime.now(),
                        );
                        if (picked != null) {
                          setDialogState(() => dob = picked);
                        }
                      },
                      child: InputDecorator(
                        decoration: const InputDecoration(
                          labelText: 'Date of Birth',
                          border: OutlineInputBorder(),
                        ),
                        child: Text(
                          dob != null
                              ? DateFormat('MMM d, yyyy').format(dob!)
                              : 'Tap to select',
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    CheckboxListTile(
                      title: const Text('Has Disability'),
                      value: isDisabled,
                      onChanged: (v) =>
                          setDialogState(() => isDisabled = v ?? false),
                      controlAffinity: ListTileControlAffinity.leading,
                      contentPadding: EdgeInsets.zero,
                    ),
                    CheckboxListTile(
                      title: const Text('Eligible for Benefits'),
                      value: isEligible,
                      onChanged: (v) =>
                          setDialogState(() => isEligible = v ?? true),
                      controlAffinity: ListTileControlAffinity.leading,
                      contentPadding: EdgeInsets.zero,
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx, null),
                  child: const Text('Cancel'),
                ),
                FilledButton(
                  onPressed: () {
                    final name = nameCtrl.text.trim();
                    if (name.isEmpty) {
                      ScaffoldMessenger.of(ctx).showSnackBar(
                        const SnackBar(content: Text('Name is required')),
                      );
                      return;
                    }
                    Navigator.pop(
                      ctx,
                      MemberDependant(
                        id: initial?.id ?? '',
                        name: name,
                        gender: gender,
                        relationship: relationship,
                        dateOfBirth: dob?.toIso8601String(),
                        isDisabled: isDisabled,
                        isEligible: isEligible,
                      ),
                    );
                  },
                  child: Text(isEditing ? 'Save' : 'Add'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);

    return MemberShell(
      title: 'Dependants',
      subtitle: auth.memberName ?? '',
      currentIndex: 1,
      actions: [
        IconButton(
          icon: const Icon(Icons.add_circle_outline),
          tooltip: 'Add Dependant',
          onPressed: _addDependant,
        ),
      ],
      body: FutureBuilder<List<MemberDependant>>(
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
          final dependants = snapshot.data ?? [];
          return RefreshIndicator(
            onRefresh: () async => _refresh(),
            child: dependants.isEmpty
                ? ListView(
                    children: [
                      SizedBox(
                        height: MediaQuery.of(context).size.height * 0.3,
                      ),
                      const Icon(Icons.people_outline,
                          size: 64, color: Colors.black26),
                      const SizedBox(height: 16),
                      const Center(
                        child: Text(
                          'No dependants registered',
                          style: TextStyle(color: Colors.black45, fontSize: 16),
                        ),
                      ),
                      const SizedBox(height: 24),
                      Center(
                        child: OutlinedButton.icon(
                          onPressed: _addDependant,
                          icon: const Icon(Icons.add),
                          label: const Text('Add Dependant'),
                        ),
                      ),
                    ],
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: dependants.length,
                    itemBuilder: (context, index) {
                      final d = dependants[index];
                      final age =
                          d.dateOfBirth != null && d.dateOfBirth!.isNotEmpty
                              ? DateTime.now().year -
                                  (DateTime.tryParse(d.dateOfBirth!)?.year ??
                                      DateTime.now().year)
                              : null;
                      return Card(
                        margin: const EdgeInsets.only(bottom: 12),
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          d.name,
                                          style: const TextStyle(
                                              fontWeight: FontWeight.w700,
                                              fontSize: 16),
                                        ),
                                        const SizedBox(height: 2),
                                        Text(
                                          d.relationship ?? '-',
                                          style: TextStyle(
                                              color: Colors.grey[600]),
                                        ),
                                      ],
                                    ),
                                  ),
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          if (d.gender != null)
                                            Container(
                                              padding:
                                                  const EdgeInsets.symmetric(
                                                      horizontal: 8,
                                                      vertical: 2),
                                              decoration: BoxDecoration(
                                                border: Border.all(
                                                    color:
                                                        Colors.grey.shade300),
                                                borderRadius:
                                                    BorderRadius.circular(12),
                                              ),
                                              child: Text(
                                                d.gender == 'male'
                                                    ? 'Male'
                                                    : 'Female',
                                                style: const TextStyle(
                                                    fontSize: 12),
                                              ),
                                            ),
                                          if (d.isDisabled) ...[
                                            const SizedBox(width: 6),
                                            Container(
                                              padding:
                                                  const EdgeInsets.symmetric(
                                                      horizontal: 8,
                                                      vertical: 2),
                                              decoration: BoxDecoration(
                                                color: Colors.amber.shade100,
                                                border: Border.all(
                                                    color:
                                                        Colors.amber.shade300),
                                                borderRadius:
                                                    BorderRadius.circular(12),
                                              ),
                                              child: const Text(
                                                'Disabled',
                                                style: TextStyle(
                                                    fontSize: 12,
                                                    color: Colors.brown),
                                              ),
                                            ),
                                          ],
                                        ],
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  if (d.dateOfBirth != null &&
                                      d.dateOfBirth!.isNotEmpty)
                                    Text(
                                      'DOB: ${DateFormat('MMM d, yyyy').format(DateTime.parse(d.dateOfBirth!))}',
                                      style: TextStyle(
                                          fontSize: 13,
                                          color: Colors.grey[600]),
                                    ),
                                  if (age != null) ...[
                                    const SizedBox(width: 8),
                                    Text(
                                      'Age: $age',
                                      style: TextStyle(
                                          fontSize: 13,
                                          color: Colors.grey[600]),
                                    ),
                                  ],
                                  const Spacer(),
                                  Text(
                                    d.isEligible ? 'Eligible' : 'Not Eligible',
                                    style: TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                      color: d.isEligible
                                          ? Colors.green
                                          : Colors.orange,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.end,
                                children: [
                                  TextButton.icon(
                                    onPressed: () => _editDependant(d),
                                    icon: const Icon(Icons.edit, size: 18),
                                    label: const Text('Edit'),
                                  ),
                                  const SizedBox(width: 4),
                                  TextButton.icon(
                                    onPressed: () => _deleteDependant(d),
                                    icon: const Icon(Icons.delete_outline,
                                        size: 18, color: Colors.red),
                                    label: const Text('Delete',
                                        style: TextStyle(color: Colors.red)),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          );
        },
      ),
    );
  }
}
