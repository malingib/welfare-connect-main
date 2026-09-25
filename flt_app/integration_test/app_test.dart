import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:malanga_welfare_companion/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('End-to-end smoke tests', () {
    testWidgets('Startup, portal switching, and recovery help', (tester) async {
      app.main();
      await tester.pump();
      await tester.pump(const Duration(seconds: 3));

      final memberField = find.byKey(const ValueKey('login_member_field'));
      final phoneField = find.byKey(const ValueKey('login_phone_field'));
      expect(memberField, findsOneWidget);
      expect(phoneField, findsOneWidget);

      await tester.tap(find.text('Admin Portal'));
      await tester.pump();
      expect(find.text('Admin Username'), findsOneWidget);
      expect(find.text('Password'), findsOneWidget);

      await tester.tap(find.text('Forgot Password?'));
      await tester.pump();
      expect(
          find.text(
              'Please contact a super administrator to reset your admin password. Admin resets are recorded for security.'),
          findsOneWidget);
      await tester.tap(find.text('Close'));
    });

    testWidgets('Member login validates required fields without network calls',
        (tester) async {
      app.main();
      await tester.pump();
      await tester.pump(const Duration(seconds: 3));

      await tester.tap(find.byKey(const ValueKey('login_submit_button')));
      await tester.pump();

      expect(find.text('Please enter your member number'), findsOneWidget);
      expect(find.text('Please enter your phone number'), findsOneWidget);
    });
  });
}
