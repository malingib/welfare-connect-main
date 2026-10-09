import 'package:supabase_flutter/supabase_flutter.dart';

/// Central service for Supabase operations
class SupabaseService {
  static final SupabaseService _instance = SupabaseService._internal();
  factory SupabaseService() => _instance;
  SupabaseService._internal();

  SupabaseClient get client => Supabase.instance.client;

  Future<void> initialize() async {
    // Kept for backward compatibility with existing startup calls.
    // Client access is now lazy via the getter above.
  }

  // Auth operations
  Future<AuthResponse> signIn({
    required String email,
    required String password,
  }) async {
    return await client.auth.signInWithPassword(
      email: email,
      password: password,
    );
  }

  Future<AuthResponse> signUp({
    required String email,
    required String password,
  }) async {
    return await client.auth.signUp(
      email: email,
      password: password,
    );
  }

  Future<void> signOut() async {
    await client.auth.signOut();
  }

  User? get currentUser => client.auth.currentUser;
  Session? get currentSession => client.auth.currentSession;

  // Generic CRUD helpers
  Future<List<dynamic>> fetch(String table) async {
    final response = await client.from(table).select();
    return response as List<dynamic>;
  }

  Future<Map<String, dynamic>?> fetchOne(
    String table,
    String column,
    dynamic value,
  ) async {
    final response =
        await client.from(table).select().eq(column, value).maybeSingle();
    return response;
  }

  Future<Map<String, dynamic>> insert(
      String table, Map<String, dynamic> data) async {
    final response = await client.from(table).insert(data).single();
    return response;
  }

  Future<Map<String, dynamic>> update(
    String table,
    String column,
    dynamic value,
    Map<String, dynamic> data,
  ) async {
    final response =
        await client.from(table).update(data).eq(column, value).single();
    return response;
  }

  Future<void> delete(String table, String column, dynamic value) async {
    await client.from(table).delete().eq(column, value);
  }

  // Realtime subscription helper
  void subscribe(String table, void Function(dynamic) callback) {
    client
        .from(table)
        .stream(primaryKey: ['id']).listen((data) => callback(data));
  }

  // Edge Function helper
  Future<FunctionResponse> invokeFunction(
    String functionName, {
    Map<String, dynamic>? body,
    Map<String, String>? headers,
  }) async {
    return await client.functions
        .invoke(
          functionName,
          body: body,
          headers: headers,
        )
        .timeout(
          const Duration(seconds: 20),
          onTimeout: () => throw Exception(
            'The server did not respond in time. Check your connection and try again.',
          ),
        );
  }
}
