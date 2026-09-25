import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../auth/auth_controller.dart';
import '../../core/theme/app_colors.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifierController = TextEditingController();
  final _secretController = TextEditingController();
  final _identifierFocusNode = FocusNode();
  final _secretFocusNode = FocusNode();
  bool _isMemberPortal = true;
  bool _rememberMe = false;

  @override
  void dispose() {
    _identifierController.dispose();
    _secretController.dispose();
    _identifierFocusNode.dispose();
    _secretFocusNode.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    FocusScope.of(context).unfocus();
    if (_formKey.currentState!.validate()) {
      await ref.read(authControllerProvider.notifier).login(
            memberNumber: _identifierController.text.trim(),
            phoneNumber: _secretController.text.trim(),
            isAdmin: !_isMemberPortal,
          );
    }
  }

  Future<void> _showRecoveryHelp() async {
    final isMember = _isMemberPortal;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(isMember ? 'Forgot member ID?' : 'Forgot password?'),
        content: Text(
          isMember
              ? 'Please contact the welfare administrator to confirm your member number and registered phone number.'
              : 'Please contact a super administrator to reset your admin password. Admin resets are recorded for security.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authControllerProvider);
    final theme = Theme.of(context);

    // Background gradient
    final gradient = const LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      colors: [
        Color(0xFF0E171F),
        Color(0xFF385943),
      ],
    );

    return Scaffold(
      body: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: () => FocusScope.of(context).unfocus(),
        child: Container(
          decoration: BoxDecoration(gradient: gradient),
          child: SafeArea(
            child: Center(
              child: SingleChildScrollView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                padding: const EdgeInsets.all(24),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 400),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      // Hero Banner
                      _buildHeroBanner(theme),

                      const SizedBox(height: 32),

                      // Login Card
                      _buildLoginCard(theme, authState),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeroBanner(ThemeData theme) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF0F172A),
            Color(0xFF065F46),
          ],
        ),
        borderRadius: BorderRadius.circular(30),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.2),
            blurRadius: 20,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(
              Icons.nature_people,
              color: Colors.white,
              size: 32,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'Malanga Welfare\nCompanion',
            style: theme.textTheme.displayLarge?.copyWith(
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Member and Admin Access',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: Colors.white70,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLoginCard(ThemeData theme, dynamic authState) {
    return Container(
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: const Color(0xFFEEF1F5),
        borderRadius: BorderRadius.circular(26),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.2),
            blurRadius: 20,
            offset: const Offset(0, 20),
          ),
        ],
      ),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Segmented Control
            _buildSegmentedControl(theme),

            const SizedBox(height: 24),

            // Identifier Field
            _buildTextField(
              key: const ValueKey('login_member_field'),
              controller: _identifierController,
              focusNode: _identifierFocusNode,
              label: _isMemberPortal ? 'Member Number' : 'Admin Username',
              hint: _isMemberPortal
                  ? 'Enter your member ID'
                  : 'Enter admin username',
              icon: _isMemberPortal ? Icons.badge : Icons.admin_panel_settings,
              textInputAction: TextInputAction.next,
              onFieldSubmitted: (_) => _secretFocusNode.requestFocus(),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return _isMemberPortal
                      ? 'Please enter your member number'
                      : 'Please enter admin username';
                }
                return null;
              },
              theme: theme,
            ),

            const SizedBox(height: 16),

            // Secret Field
            _buildTextField(
              key: const ValueKey('login_phone_field'),
              controller: _secretController,
              focusNode: _secretFocusNode,
              label: _isMemberPortal ? 'Phone Number' : 'Password',
              hint: _isMemberPortal ? '+2547XXXXXXXX' : 'Enter admin password',
              icon: _isMemberPortal ? Icons.phone : Icons.lock_outline,
              keyboardType: _isMemberPortal
                  ? TextInputType.phone
                  : TextInputType.visiblePassword,
              textInputAction: TextInputAction.done,
              obscureText: !_isMemberPortal,
              onFieldSubmitted: (_) => _handleLogin(),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return _isMemberPortal
                      ? 'Please enter your phone number'
                      : 'Please enter password';
                }
                return null;
              },
              theme: theme,
            ),

            // Remember me & Forgot ID
            Padding(
              padding: const EdgeInsets.only(top: 8, left: 4, right: 4),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      SizedBox(
                        width: 20,
                        height: 20,
                        child: Checkbox(
                          value: _rememberMe,
                          onChanged: (value) {
                            setState(() => _rememberMe = value ?? false);
                          },
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(4),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Remember me',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: AppColors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                  TextButton(
                    onPressed: _showRecoveryHelp,
                    child: Text(
                      _isMemberPortal ? 'Forgot ID?' : 'Forgot Password?',
                      style: theme.textTheme.labelLarge?.copyWith(
                        color: AppColors.primaryContainer,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 24),

            // Sign In Button
            FilledButton(
              key: const ValueKey('login_submit_button'),
              onPressed: authState.isLoading ? null : _handleLogin,
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF111827),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                textStyle: theme.textTheme.headlineMedium,
              ),
              child: authState.isLoading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                      ),
                    )
                  : Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: const [
                        Text('Sign In'),
                        SizedBox(width: 8),
                        Icon(Icons.login, size: 20),
                      ],
                    ),
            ),

            if (authState.error != null) ...[
              const SizedBox(height: 16),
              Text(
                authState.error!,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: AppColors.error,
                ),
                textAlign: TextAlign.center,
              ),
            ],

            const SizedBox(height: 24),

            // Divider
            const Divider(),

            const SizedBox(height: 16),

            // Not a member yet?
            Text.rich(
              TextSpan(
                text: 'Not a member yet? ',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: AppColors.onSurfaceVariant,
                ),
                children: [
                  TextSpan(
                    text: 'Apply for Welfare',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: AppColors.primaryContainer,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSegmentedControl(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: Colors.grey.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          // Member Portal button
          Expanded(
            child: GestureDetector(
              onTap: () => setState(() => _isMemberPortal = true),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 12),
                decoration: BoxDecoration(
                  color: _isMemberPortal ? Colors.white : Colors.transparent,
                  borderRadius: BorderRadius.circular(14),
                  boxShadow: _isMemberPortal
                      ? [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.1),
                            blurRadius: 4,
                            offset: const Offset(0, 2),
                          ),
                        ]
                      : null,
                ),
                child: Text(
                  'Member Portal',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: _isMemberPortal
                        ? AppColors.onSurface
                        : AppColors.onSurfaceVariant,
                    fontWeight:
                        _isMemberPortal ? FontWeight.w600 : FontWeight.w500,
                  ),
                ),
              ),
            ),
          ),
          // Admin Portal button
          Expanded(
            child: GestureDetector(
              onTap: () => setState(() => _isMemberPortal = false),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 12),
                decoration: BoxDecoration(
                  color: !_isMemberPortal ? Colors.white : Colors.transparent,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Text(
                  'Admin Portal',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: !_isMemberPortal
                        ? AppColors.onSurface
                        : AppColors.onSurfaceVariant,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required FocusNode focusNode,
    required String label,
    required String hint,
    required IconData icon,
    TextInputType? keyboardType,
    TextInputAction? textInputAction,
    void Function(String)? onFieldSubmitted,
    String? Function(String?)? validator,
    bool obscureText = false,
    required ThemeData theme,
    Key? key,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4),
          child: Text(
            label,
            style: theme.textTheme.labelSmall?.copyWith(
              color: AppColors.onSurfaceVariant,
            ),
          ),
        ),
        const SizedBox(height: 8),
        TextFormField(
          key: key,
          controller: controller,
          focusNode: focusNode,
          keyboardType: keyboardType,
          textInputAction: textInputAction,
          obscureText: obscureText,
          onFieldSubmitted: onFieldSubmitted,
          validator: validator,
          style: theme.textTheme.bodyMedium,
          decoration: InputDecoration(
            hintText: hint,
            prefixIcon: Icon(icon, color: AppColors.onSurfaceVariant),
          ),
        ),
      ],
    );
  }
}
