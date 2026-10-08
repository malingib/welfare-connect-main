import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Secure storage wrapper for tokens and sensitive data
class StorageService {
  static final StorageService _instance = StorageService._internal();
  factory StorageService() => _instance;
  StorageService._internal();

  static const FlutterSecureStorage _storage = FlutterSecureStorage();

  static const String _keyAuthToken = 'auth_token';
  static const String _keyUserEmail = 'user_email';
  static const String _keyUserRole = 'user_role';
  static const String _keyIsAdmin = 'is_admin';
  static const String _keyMemberId = 'member_id';
  static const String _keyMemberName = 'member_name';
  static const String _keyRememberMe = 'remember_me';

  Future<void> saveAuthToken(String token) async {
    await _storage.write(key: _keyAuthToken, value: token);
  }

  Future<String?> getAuthToken() async {
    return await _storage.read(key: _keyAuthToken);
  }

  Future<void> saveUserEmail(String email) async {
    await _storage.write(key: _keyUserEmail, value: email);
  }

  Future<String?> getUserEmail() async {
    return await _storage.read(key: _keyUserEmail);
  }

  Future<void> saveUserRole(String role) async {
    await _storage.write(key: _keyUserRole, value: role);
  }

  Future<String?> getUserRole() async {
    return await _storage.read(key: _keyUserRole);
  }

  Future<void> saveIsAdmin(bool isAdmin) async {
    await _storage.write(key: _keyIsAdmin, value: isAdmin ? 'true' : 'false');
  }

  Future<bool> getIsAdmin() async {
    final value = await _storage.read(key: _keyIsAdmin);
    return value == 'true';
  }

  Future<void> saveMemberId(String memberId) async {
    await _storage.write(key: _keyMemberId, value: memberId);
  }

  Future<String?> getMemberId() async {
    return await _storage.read(key: _keyMemberId);
  }

  Future<void> saveMemberName(String memberName) async {
    await _storage.write(key: _keyMemberName, value: memberName);
  }

  Future<String?> getMemberName() async {
    return await _storage.read(key: _keyMemberName);
  }

  Future<void> saveRememberMe(bool value) async {
    await _storage.write(key: _keyRememberMe, value: value ? 'true' : 'false');
  }

  Future<bool> getRememberMe() async {
    // Existing installs predate this preference; preserve their saved session.
    return (await _storage.read(key: _keyRememberMe)) != 'false';
  }

  Future<void> clearAll() async {
    await _storage.deleteAll();
  }
}
