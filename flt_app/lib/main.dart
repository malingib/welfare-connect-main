import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:posthog_flutter/posthog_flutter.dart';

import 'app.dart';
import 'core/config/app_config.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  String? startupError;

  // Load environment variables
  try {
    await dotenv.load(fileName: ".env");
  } catch (e) {
    startupError = 'Failed to load .env file: $e';
  }

  if (startupError == null) {
    final posthogProjectToken = dotenv.env['POSTHOG_PROJECT_TOKEN'];
    final posthogHost = dotenv.env['POSTHOG_HOST'];

    final hasPosthogConfig = posthogProjectToken != null &&
        posthogProjectToken.isNotEmpty &&
        posthogProjectToken != 'your_posthog_project_token' &&
        posthogHost != null &&
        posthogHost.isNotEmpty;

    if (hasPosthogConfig) {
      final config = PostHogConfig(posthogProjectToken);
      config.host = posthogHost;
      config.errorTrackingConfig.captureFlutterErrors = true;
      config.errorTrackingConfig.capturePlatformDispatcherErrors = true;
      config.errorTrackingConfig.captureIsolateErrors = true;
      try {
        await Posthog().setup(config);
      } catch (e) {
        debugPrint('PostHog initialization skipped: $e');
      }
    }
  }

  // Initialize configuration and Supabase
  if (startupError == null) {
    try {
      AppConfig.validate();
      await AppConfig.initialize();
    } catch (e) {
      startupError = 'Initialization error: $e';
    }
  }

  runApp(
    ProviderScope(
      child: startupError == null
          ? const MalangaCompanionApp()
          : _StartupErrorApp(message: startupError),
    ),
  );

  if (startupError != null) {
    debugPrint('Startup failed: $startupError');
  }
}

class _StartupErrorApp extends StatelessWidget {
  const _StartupErrorApp({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              message,
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ),
    );
  }
}
