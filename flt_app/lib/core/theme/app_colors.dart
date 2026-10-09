import 'package:flutter/material.dart';

/// Complete Design System Colors
class AppColors {
  // Primary - Forest Green
  static const primary = Color(0xFF1b3a19);
  static const onPrimary = Color(0xFFFFFFFF);
  static const primaryContainer = Color(0xFF31512e);
  static const onPrimaryContainer = Color(0xFF9ec396);
  static const primaryFixed = Color(0xFFc7edbe);
  static const primaryFixedDim = Color(0xFFabd0a3);
  static const inversePrimary = Color(0xFFabd0a3);
  static const onPrimaryFixed = Color(0xFF022105);
  static const onPrimaryFixedVariant = Color(0xFF2e4e2b);

  // Secondary - Slate Blue
  static const secondary = Color(0xFF565e74);
  static const onSecondary = Color(0xFFFFFFFF);
  static const secondaryContainer = Color(0xFFdae2fd);
  static const onSecondaryContainer = Color(0xFF5c647a);
  static const secondaryFixed = Color(0xFFdae2fd);
  static const secondaryFixedDim = Color(0xFFbec6e0);
  static const onSecondaryFixed = Color(0xFF131b2e);
  static const onSecondaryFixedVariant = Color(0xFF3f465c);

  // Tertiary - Golden Amber/Brown
  static const tertiary = Color(0xFF4b2c00);
  static const onTertiary = Color(0xFFFFFFFF);
  static const tertiaryContainer = Color(0xFF6a4000);
  static const onTertiaryContainer = Color(0xFFeaad64);
  static const tertiaryFixed = Color(0xFFffddb9);
  static const tertiaryFixedDim = Color(0xFFf9ba70);
  static const onTertiaryFixed = Color(0xFF2b1700);
  static const onTertiaryFixedVariant = Color(0xFF663e00);

  // Error
  static const error = Color(0xFFba1a1a);
  static const onError = Color(0xFFFFFFFF);
  static const errorContainer = Color(0xFFffdad6);
  static const onErrorContainer = Color(0xFF93000a);

  // Background & Surface
  static const background = Color(0xFFf9f9ff);
  static const onBackground = Color(0xFF111c2d);
  static const surface = Color(0xFFf9f9ff);
  static const onSurface = Color(0xFF111c2d);
  static const surfaceDim = Color(0xFFcfdaf2);
  static const surfaceBright = Color(0xFFf9f9ff);
  static const surfaceContainerLowest = Color(0xFFFFFFFF);
  static const surfaceContainerLow = Color(0xFFf0f3ff);
  static const surfaceContainer = Color(0xFFe7eeff);
  static const surfaceContainerHigh = Color(0xFFdee8ff);
  static const surfaceContainerHighest = Color(0xFFd8e3fb);
  static const surfaceVariant = Color(0xFFd8e3fb);
  static const onSurfaceVariant = Color(0xFF434840);

  // Inverse
  static const inverseSurface = Color(0xFF263143);
  static const inverseOnSurface = Color(0xFFecf1ff);

  // Outline & Tint
  static const outline = Color(0xFF73796f);
  static const outlineVariant = Color(0xFFc3c8bd);
  static const surfaceTint = Color(0xFF456641);
}

// Light ColorScheme using Material 3 tokens
final ColorScheme lightColorScheme = ColorScheme(
  brightness: Brightness.light,
  primary: AppColors.primary,
  onPrimary: AppColors.onPrimary,
  primaryContainer: AppColors.primaryContainer,
  onPrimaryContainer: AppColors.onPrimaryContainer,
  secondary: AppColors.secondary,
  onSecondary: AppColors.onSecondary,
  secondaryContainer: AppColors.secondaryContainer,
  onSecondaryContainer: AppColors.onSecondaryContainer,
  tertiary: AppColors.tertiary,
  onTertiary: AppColors.onTertiary,
  tertiaryContainer: AppColors.tertiaryContainer,
  onTertiaryContainer: AppColors.onTertiaryContainer,
  error: AppColors.error,
  onError: AppColors.onError,
  errorContainer: AppColors.errorContainer,
  onErrorContainer: AppColors.onErrorContainer,
  surface: AppColors.surface,
  onSurface: AppColors.onSurface,
  surfaceContainerLowest: AppColors.surfaceContainerLowest,
  surfaceContainerLow: AppColors.surfaceContainerLow,
  surfaceContainerHighest: AppColors.surfaceVariant,
  onSurfaceVariant: AppColors.onSurfaceVariant,
  outline: AppColors.outline,
  outlineVariant: AppColors.outlineVariant,
  surfaceTint: AppColors.surfaceTint,
);

final ColorScheme darkColorScheme = ColorScheme.fromSeed(
  seedColor: AppColors.primaryFixedDim,
  brightness: Brightness.dark,
  surface: const Color(0xFF151B15),
);
