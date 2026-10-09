import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'app_colors.dart';

/// App Theme - Material 3 with Nature-Focused Professionalism design system
ThemeData get appTheme {
  final colorScheme = lightColorScheme;

  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: AppColors.background,

    // Text Theme with Manrope
    textTheme: GoogleFonts.manropeTextTheme().copyWith(
      displayLarge: GoogleFonts.manrope(
        fontSize: 40,
        fontWeight: FontWeight.w800,
        letterSpacing: -0.02,
        height: 1.2,
      ),
      headlineLarge: GoogleFonts.manrope(
        fontSize: 32,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.01,
        height: 1.25,
      ),
      headlineMedium: GoogleFonts.manrope(
        fontSize: 24,
        fontWeight: FontWeight.w700,
        height: 1.33,
      ),
      titleLarge: GoogleFonts.manrope(
        fontSize: 20,
        fontWeight: FontWeight.w600,
        height: 1.4,
      ),
      bodyLarge: GoogleFonts.manrope(
        fontSize: 16,
        fontWeight: FontWeight.w400,
        height: 1.5,
      ),
      bodyMedium: GoogleFonts.manrope(
        fontSize: 14,
        fontWeight: FontWeight.w400,
        height: 1.43,
      ),
      labelLarge: GoogleFonts.manrope(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.1,
        height: 1.43,
      ),
      labelSmall: GoogleFonts.manrope(
        fontSize: 11,
        fontWeight: FontWeight.w500,
        letterSpacing: 0.5,
        height: 1.45,
      ),
    ),

    // App Bar Theme
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.primaryContainer,
      foregroundColor: AppColors.onPrimary,
      elevation: 0,
      centerTitle: false,
    ),

    // Card Theme
    cardTheme: CardThemeData(
      color: AppColors.surfaceContainerLowest,
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
      ),
      margin: EdgeInsets.zero,
    ),

    // Elevated Button Theme
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.onPrimary,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
        textStyle: const TextStyle(
          fontFamily: 'Manrope',
          fontWeight: FontWeight.w600,
          fontSize: 14,
        ),
      ),
    ),

    // Outlined Button Theme
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.primary,
        side: const BorderSide(color: AppColors.primaryContainer),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
        textStyle: const TextStyle(
          fontFamily: 'Manrope',
          fontWeight: FontWeight.w600,
          fontSize: 14,
        ),
      ),
    ),

    // Text Button Theme
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: AppColors.primaryContainer,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        textStyle: const TextStyle(
          fontFamily: 'Manrope',
          fontWeight: FontWeight.w600,
          fontSize: 14,
        ),
      ),
    ),

    // Input Decoration Theme (Text Fields)
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      // Keep text fields visually distinct from the white form/card surface.
      fillColor: AppColors.surfaceContainerLow,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: AppColors.outlineVariant),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: AppColors.outlineVariant),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide:
            const BorderSide(color: AppColors.primaryContainer, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: AppColors.error, width: 2),
      ),
      hintStyle: TextStyle(
        fontFamily: 'Manrope',
        fontSize: 14,
        color: AppColors.onSurfaceVariant.withValues(alpha: 0.6),
      ),
      labelStyle: const TextStyle(
        fontFamily: 'Manrope',
        fontWeight: FontWeight.w600,
        fontSize: 14,
      ),
    ),

    // Bottom Navigation Bar Theme
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: AppColors.inverseSurface,
      selectedItemColor: AppColors.surfaceTint,
      unselectedItemColor: AppColors.onSurfaceVariant,
      type: BottomNavigationBarType.fixed,
      elevation: 0,
    ),

    // Divider Theme
    dividerTheme: const DividerThemeData(
      color: AppColors.surfaceVariant,
      thickness: 1,
    ),

    // Chip Theme
    chipTheme: ChipThemeData(
      backgroundColor: AppColors.surfaceContainerHigh,
      selectedColor: AppColors.primaryContainer,
      labelStyle: const TextStyle(
        fontFamily: 'Manrope',
        fontWeight: FontWeight.w600,
        fontSize: 14,
      ),
      shape: const StadiumBorder(),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
    ),

    // Scrollbar Theme
    scrollbarTheme: ScrollbarThemeData(
      thumbColor:
          WidgetStateProperty.all(AppColors.outline.withValues(alpha: 0.5)),
      trackColor: WidgetStateProperty.all(Colors.transparent),
    ),
  );
}
