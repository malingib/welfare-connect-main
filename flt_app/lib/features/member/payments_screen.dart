import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:posthog_flutter/posthog_flutter.dart';

import '../../core/constants/app_constants.dart';
import '../../core/services/supabase_service.dart';
import '../auth/auth_controller.dart';
import 'member_shell.dart';

class PaymentsScreen extends ConsumerStatefulWidget {
  const PaymentsScreen({super.key});

  @override
  ConsumerState<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends ConsumerState<PaymentsScreen> {
  final _formKey = GlobalKey<FormState>();
  final _phoneController = TextEditingController();
  final _amountController = TextEditingController();
  final _referenceController = TextEditingController();
  bool _isLoading = false;

  @override
  void dispose() {
    _phoneController.dispose();
    _amountController.dispose();
    _referenceController.dispose();
    super.dispose();
  }

  Future<void> _handleSubmit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);
    try {
      final appToken = ref.read(authControllerProvider).appToken;
      if (appToken == null || appToken.isEmpty) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Session expired. Please log in again.'),
              backgroundColor: Colors.red),
        );
        return;
      }

      final response = await SupabaseService().invokeFunction(
        'api-stk-push',
        body: {
          'phone': _phoneController.text.trim(),
          'amount': double.tryParse(_amountController.text.trim()) ?? 0,
          'accountReference': _referenceController.text.trim(),
          'transactionDesc': 'Member wallet funding',
        },
        headers: {'x-app-token': appToken},
      );

      if (!mounted) return;
      if (response.status == 200 || response.status == 201) {
        Posthog().capture(
          eventName: 'wallet_top_up_initiated',
          properties: {
            'amount': double.tryParse(_amountController.text.trim()) ?? 0,
            'payment_method': 'mpesa_stk_push',
          },
        );
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('STK Push sent. Check your phone.'),
              backgroundColor: Colors.green),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(
                  'Error: ${response.data?['error'] ?? 'Failed to initiate STK Push'}'),
              backgroundColor: Colors.red),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text('Connection error: $e'), backgroundColor: Colors.red),
      );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return MemberShell(
      title: 'Payments',
      subtitle: 'Wallet top-up',
      currentIndex: 3,
      body: ListView(
        padding: const EdgeInsets.all(AppConstants.marginEdge),
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFEAF1FB),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFFCAD7EA)),
            ),
            child: const Text(
              'Use M-Pesa STK Push to top up your wallet. Fill all fields and confirm on your phone.',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFFDCE3EE)),
            ),
            child: Form(
              key: _formKey,
              child: Column(
                children: [
                  TextFormField(
                    key: const ValueKey('payment_phone_field'),
                    controller: _phoneController,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                        labelText: 'Phone number', hintText: '0712 345 678'),
                    validator: (value) =>
                        (value == null || value.trim().isEmpty)
                            ? 'Please enter phone number'
                            : null,
                  ),
                  const SizedBox(height: 10),
                  TextFormField(
                    key: const ValueKey('payment_amount_field'),
                    controller: _amountController,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                        labelText: 'Amount', hintText: 'KES 0.00'),
                    validator: (value) {
                      if (value == null || value.trim().isEmpty) {
                        return 'Please enter amount';
                      }
                      final parsed = double.tryParse(value.trim());
                      if (parsed == null || parsed <= 0) {
                        return 'Enter a valid amount';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 10),
                  TextFormField(
                    key: const ValueKey('payment_reference_field'),
                    controller: _referenceController,
                    decoration: const InputDecoration(
                        labelText: 'Account reference',
                        hintText: 'e.g. Welfare-001'),
                    validator: (value) =>
                        (value == null || value.trim().isEmpty)
                            ? 'Please enter account reference'
                            : null,
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      key: const ValueKey('payment_submit_button'),
                      onPressed: _isLoading ? null : _handleSubmit,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF1F3556),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8)),
                      ),
                      child: _isLoading
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2))
                          : const Text('Initiate STK Push'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
