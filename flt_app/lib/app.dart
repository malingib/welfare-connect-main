import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/app_colors.dart';
import 'core/router/app_router.dart';
import 'core/widgets/app_splash_screen.dart';
import 'features/auth/auth_controller.dart';

class MalangaCompanionApp extends ConsumerWidget {
  const MalangaCompanionApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    final authState = ref.watch(authControllerProvider);

    return MaterialApp.router(
      title: 'Malanga Welfare Companion',
      debugShowCheckedModeBanner: false,
      theme: appTheme,
      // Keep the existing light-only screens legible until dark colors are
      // applied consistently across the app.
      themeMode: ThemeMode.light,
      darkTheme: appTheme.copyWith(
        brightness: Brightness.dark,
        colorScheme: darkColorScheme,
        scaffoldBackgroundColor: darkColorScheme.surface,
        appBarTheme: AppBarTheme(
          backgroundColor: darkColorScheme.surfaceContainer,
          foregroundColor: darkColorScheme.onSurface,
          elevation: 0,
          centerTitle: false,
        ),
        cardTheme: appTheme.cardTheme.copyWith(
          color: darkColorScheme.surfaceContainerLow,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
            side: BorderSide(color: darkColorScheme.outlineVariant),
          ),
        ),
        inputDecorationTheme: appTheme.inputDecorationTheme.copyWith(
          fillColor: darkColorScheme.surfaceContainerLow,
          hintStyle: TextStyle(
            fontFamily: 'Manrope',
            fontSize: 14,
            color: darkColorScheme.onSurfaceVariant,
          ),
        ),
        dividerTheme: DividerThemeData(
          color: darkColorScheme.outlineVariant,
          thickness: 1,
        ),
      ),
      routerConfig: router,
      builder: (context, child) => authState.isLoading
          ? const AppSplashScreen()
          : child ?? const SizedBox.shrink(),
    );
  }
}
