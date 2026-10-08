import 'dart:async';

import 'package:dio/dio.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Converts transport/backend failures into messages that are useful to users
/// without leaking implementation details or database errors.
String userFacingError(Object? error, {String fallback = 'Something went wrong. Please try again.'}) {
  if (error == null) return fallback;
  if (error is TimeoutException || error is DioException && error.type == DioExceptionType.connectionTimeout) {
    return 'The request took too long. Check your connection and try again.';
  }
  if (error is DioException && error.type == DioExceptionType.connectionError) {
    return 'No internet connection. Check your network and try again.';
  }
  if (error is FunctionException) {
    final status = error.status;
    if (status == 401 || status == 403) return 'Your session has expired. Please sign in again.';
    if (status >= 500) return 'The service is temporarily unavailable. Please try again shortly.';
  }
  if (error is PostgrestException) {
    final message = error.message.toLowerCase();
    if (message.contains('jwt') || message.contains('unauthorized') || message.contains('permission')) {
      return 'Your session has expired. Please sign in again.';
    }
  }

  final raw = error.toString().replaceFirst(RegExp(r'^Exception:\s*'), '').trim();
  if (raw.isEmpty || raw.contains('SocketException') || raw.contains('Failed host lookup')) {
    return 'Unable to connect right now. Check your network and try again.';
  }
  if (raw.length > 180 || raw.contains(' at ') || raw.contains('PostgrestException')) {
    return fallback;
  }
  return raw;
}
