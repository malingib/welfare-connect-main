import 'package:supabase_flutter/supabase_flutter.dart';

import 'supabase_service.dart';
import 'local_cache_service.dart';

class MemberWalletSnapshot {
  final double walletBalance;
  final double totalCredit;
  final double totalDebit;
  final List<Map<String, dynamic>> recentTransactions;
  final bool isDefaulting;
  final double arrearsTotal;
  final double penaltyTotal;
  final int unpaidCasesCount;

  const MemberWalletSnapshot({
    required this.walletBalance,
    required this.totalCredit,
    required this.totalDebit,
    required this.recentTransactions,
    required this.isDefaulting,
    required this.arrearsTotal,
    required this.penaltyTotal,
    required this.unpaidCasesCount,
  });

  Map<String, dynamic> toMap() => {
        'wallet_balance': walletBalance,
        'total_credit': totalCredit,
        'total_debit': totalDebit,
        'recent_transactions': recentTransactions,
        'is_defaulting': isDefaulting,
        'arrears_total': arrearsTotal,
        'penalty_total': penaltyTotal,
        'unpaid_cases_count': unpaidCasesCount,
      };

  factory MemberWalletSnapshot.fromMap(Map<String, dynamic> map) {
    return MemberWalletSnapshot(
      walletBalance: _number(map['wallet_balance']),
      totalCredit: _number(map['total_credit']),
      totalDebit: _number(map['total_debit']),
      recentTransactions: (map['recent_transactions'] as List? ?? const [])
          .whereType<Map>()
          .map((row) => row.cast<String, dynamic>())
          .toList(),
      isDefaulting: map['is_defaulting'] == true,
      arrearsTotal: _number(map['arrears_total']),
      penaltyTotal: _number(map['penalty_total']),
      unpaidCasesCount: (map['unpaid_cases_count'] as num?)?.toInt() ?? 0,
    );
  }

  static double _number(dynamic value) {
    if (value is num) return value.toDouble();
    return double.tryParse(value?.toString() ?? '') ?? 0;
  }
}

class MemberCaseSnapshot {
  final String id;
  final String caseNumber;
  final String caseType;
  final double contributionPerMember;
  final double amountPaid;
  final double remainingAmount;
  final double progress;
  final bool isFinalized;
  final bool paid;

  const MemberCaseSnapshot({
    required this.id,
    required this.caseNumber,
    required this.caseType,
    required this.contributionPerMember,
    required this.amountPaid,
    required this.remainingAmount,
    required this.progress,
    required this.isFinalized,
    required this.paid,
  });
}

class MemberDependant {
  final String id;
  final String name;
  final String? gender;
  final String? relationship;
  final String? dateOfBirth;
  final bool isDisabled;
  final bool isEligible;

  const MemberDependant({
    required this.id,
    required this.name,
    this.gender,
    this.relationship,
    this.dateOfBirth,
    this.isDisabled = false,
    this.isEligible = true,
  });

  factory MemberDependant.fromMap(Map<String, dynamic> map) {
    return MemberDependant(
      id: (map['id'] ?? '').toString(),
      name: (map['name'] ?? '').toString(),
      gender: map['gender']?.toString(),
      relationship: map['relationship']?.toString(),
      dateOfBirth: map['date_of_birth']?.toString(),
      isDisabled: map['is_disabled'] == true,
      isEligible: map['is_eligible'] != false,
    );
  }

  Map<String, dynamic> toInsertMap(String memberId) {
    return {
      'member_id': memberId,
      'name': name,
      'gender': gender,
      'relationship': relationship,
      'date_of_birth': dateOfBirth,
      'is_disabled': isDisabled,
      'is_eligible': isEligible,
    };
  }

  Map<String, dynamic> toUpdateMap() {
    return {
      'name': name,
      'gender': gender,
      'relationship': relationship,
      'date_of_birth': dateOfBirth,
      'is_disabled': isDisabled,
      'is_eligible': isEligible,
    };
  }
}

class AdminDashboardSnapshot {
  final int totalMembers;
  final int activeMembers;
  final int inactiveMembers;
  final int probationMembers;
  final int activeCases;
  final double totalContributions;
  final double pendingSuspenseTotal;
  final int pendingSuspenseCount;
  final List<Map<String, dynamic>> recentActivity;

  const AdminDashboardSnapshot({
    required this.totalMembers,
    required this.activeMembers,
    required this.inactiveMembers,
    required this.probationMembers,
    required this.activeCases,
    required this.totalContributions,
    required this.pendingSuspenseTotal,
    required this.pendingSuspenseCount,
    required this.recentActivity,
  });

  Map<String, dynamic> toMap() => {
        'total_members': totalMembers,
        'active_members': activeMembers,
        'inactive_members': inactiveMembers,
        'probation_members': probationMembers,
        'active_cases': activeCases,
        'total_contributions': totalContributions,
        'pending_suspense_total': pendingSuspenseTotal,
        'pending_suspense_count': pendingSuspenseCount,
        'recent_activity': recentActivity,
      };

  factory AdminDashboardSnapshot.fromMap(Map<String, dynamic> map) =>
      AdminDashboardSnapshot(
        totalMembers: (map['total_members'] as num?)?.toInt() ?? 0,
        activeMembers: (map['active_members'] as num?)?.toInt() ?? 0,
        inactiveMembers: (map['inactive_members'] as num?)?.toInt() ?? 0,
        probationMembers: (map['probation_members'] as num?)?.toInt() ?? 0,
        activeCases: (map['active_cases'] as num?)?.toInt() ?? 0,
        totalContributions: _number(map['total_contributions']),
        pendingSuspenseTotal: _number(map['pending_suspense_total']),
        pendingSuspenseCount:
            (map['pending_suspense_count'] as num?)?.toInt() ?? 0,
        recentActivity: (map['recent_activity'] as List? ?? const [])
            .whereType<Map>()
            .map((row) => row.cast<String, dynamic>())
            .toList(),
      );

  static double _number(dynamic value) => value is num
      ? value.toDouble()
      : double.tryParse(value?.toString() ?? '') ?? 0;
}

class _AdminMemberCounts {
  final int total;
  final int active;
  final int inactive;
  final int probation;

  const _AdminMemberCounts(
      this.total, this.active, this.inactive, this.probation);
}

class LiveDataService {
  final SupabaseClient _client = Supabase.instance.client;
  final SupabaseService _supabaseService = SupabaseService();
  final LocalCacheService _cache = LocalCacheService.instance;

  String _adminCacheScope(String appToken) {
    // Keep the bearer token out of SQLite keys while still isolating sessions.
    var hash = 0x811c9dc5;
    for (final unit in appToken.codeUnits) {
      hash = ((hash ^ unit) * 0x01000193) & 0xffffffff;
    }
    return 'admin:${hash.toRadixString(16)}';
  }

  Future<T?> _readAdminCache<T>({
    required String appToken,
    required String key,
    required bool forceRefresh,
    required T Function(Map<String, dynamic>) decode,
  }) async {
    if (appToken.isEmpty || forceRefresh) return null;
    final cached = await _cache.read(
      ownerScope: _adminCacheScope(appToken),
      key: key,
    );
    if (cached == null ||
        DateTime.now().difference(cached.savedAt) >=
            const Duration(seconds: 45)) {
      return null;
    }
    try {
      return decode(cached.value);
    } catch (_) {
      await _cache.remove(
        ownerScope: _adminCacheScope(appToken),
        key: key,
      );
      return null;
    }
  }

  Future<void> _writeAdminCache({
    required String appToken,
    required String key,
    required Map<String, dynamic> value,
  }) async {
    if (appToken.isEmpty) return;
    await _cache.write(
      ownerScope: _adminCacheScope(appToken),
      key: key,
      value: value,
    );
  }

  Future<void> clearAdminCache(String appToken) async {
    if (appToken.isNotEmpty) {
      await _cache.clearOwner(_adminCacheScope(appToken));
    }
  }

  Future<MemberWalletSnapshot> fetchMemberWalletData({
    required String memberId,
    required String appToken,
    bool forceRefresh = false,
  }) async {
    final ownerScope = 'member:$memberId';
    final cached = await _cache.read(
      ownerScope: ownerScope,
      key: 'wallet_snapshot',
    );
    if (!forceRefresh &&
        cached != null &&
        DateTime.now().difference(cached.savedAt) <
            const Duration(seconds: 30)) {
      return MemberWalletSnapshot.fromMap(cached.value);
    }

    final snapshot = await _fetchMemberWalletDataFromServer(
      memberId: memberId,
      appToken: appToken,
    );
    await _cache.write(
      ownerScope: ownerScope,
      key: 'wallet_snapshot',
      value: snapshot.toMap(),
    );
    return snapshot;
  }

  Future<MemberWalletSnapshot> _fetchMemberWalletDataFromServer({
    required String memberId,
    required String appToken,
  }) async {
    final summaryResponse = await _supabaseService.invokeFunction(
      'api-member-summary',
      body: {'member_id': memberId},
      headers: {'x-app-token': appToken},
    );

    if (summaryResponse.status < 200 || summaryResponse.status >= 300) {
      throw Exception('Failed to load member summary');
    }

    final txResponse = await _supabaseService.invokeFunction(
      'api-member-transactions',
      body: {'member_id': memberId, 'page': 1, 'page_size': 50},
      headers: {'x-app-token': appToken},
    );

    if (txResponse.status < 200 || txResponse.status >= 300) {
      throw Exception('Failed to load member transactions');
    }

    final summary =
        (summaryResponse.data as Map?)?.cast<String, dynamic>() ?? const {};
    final member =
        (summary['member'] as Map?)?.cast<String, dynamic>() ?? const {};
    final txBody =
        (txResponse.data as Map?)?.cast<String, dynamic>() ?? const {};
    final txList = (txBody['transactions'] as List?)
            ?.whereType<Map>()
            .map((e) => e.cast<String, dynamic>())
            .toList() ??
        const <Map<String, dynamic>>[];

    double credits = 0;
    double debits = 0;
    double arrearsTotal = 0;
    double penaltyTotal = 0;
    for (final tx in txList) {
      final amount = _toDouble(tx['amount']);
      final type = (tx['transaction_type'] ?? '').toString().toLowerCase();
      final status = (tx['status'] ?? '').toString().toLowerCase();
      if (status == 'reversed' ||
          (status.isNotEmpty && status != 'completed')) {
        continue;
      }
      if (type == 'wallet_funding' ||
          type == 'deposit' ||
          type == 'contribution_refund' ||
          type == 'case_wallet_refund') {
        credits += amount.abs();
      } else if (type == 'contribution' ||
          type == 'case_wallet_deduction' ||
          type == 'disbursement' ||
          type == 'arrears' ||
          type == 'penalty' ||
          type == 'registration' ||
          type == 'renewal') {
        debits += amount.abs();
      }
      if (type == 'arrears') {
        arrearsTotal += amount.abs();
      }
      if (type == 'penalty') {
        penaltyTotal += amount.abs();
      }
    }
    final activeCases = (summary['active_cases_summary'] as List?)
            ?.whereType<Map>()
            .map((e) => e.cast<String, dynamic>())
            .toList() ??
        const <Map<String, dynamic>>[];
    final unpaidCasesCount = activeCases.where((c) => c['paid'] != true).length;
    final walletBalance = _toDouble(member['wallet_balance']);

    return MemberWalletSnapshot(
      walletBalance: walletBalance,
      totalCredit: credits,
      totalDebit: debits,
      recentTransactions: txList.take(5).toList(),
      isDefaulting:
          walletBalance < 0 || arrearsTotal > 0 || unpaidCasesCount > 0,
      arrearsTotal: arrearsTotal,
      penaltyTotal: penaltyTotal,
      unpaidCasesCount: unpaidCasesCount,
    );
  }

  Future<List<MemberCaseSnapshot>> fetchMemberCases({
    required String memberId,
    required String appToken,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-member-summary',
      body: {'member_id': memberId},
      headers: {'x-app-token': appToken},
    );

    if (response.status < 200 || response.status >= 300) {
      throw Exception('Failed to load member cases');
    }

    final payload =
        (response.data as Map?)?.cast<String, dynamic>() ?? const {};
    final cases = (payload['active_cases_summary'] as List?)
            ?.whereType<Map>()
            .map((e) => e.cast<String, dynamic>())
            .toList() ??
        const <Map<String, dynamic>>[];

    return cases.map((c) {
      final required = _toDouble(c['contribution_per_member']);
      final amountPaid = _toDouble(c['amount_paid']);
      final remaining = _toDouble(c['remaining_amount']);
      final normalizedPaid = amountPaid
          .clamp(0, required > 0 ? required : double.infinity)
          .toDouble();
      final progress = required <= 0
          ? ((c['paid'] == true) ? 1.0 : 0.0)
          : (normalizedPaid / required).clamp(0.0, 1.0).toDouble();
      return MemberCaseSnapshot(
        id: (c['id'] ?? '').toString(),
        caseNumber: (c['case_number'] ?? 'N/A').toString(),
        caseType: (c['case_type'] ?? 'unknown').toString(),
        contributionPerMember: required,
        amountPaid: normalizedPaid,
        remainingAmount: remaining > 0
            ? remaining
            : (required - normalizedPaid).clamp(0, double.infinity).toDouble(),
        progress: progress,
        isFinalized: c['is_finalized'] == true,
        paid: c['paid'] == true || (required > 0 && normalizedPaid >= required),
      );
    }).toList();
  }

  Future<List<MemberCaseSnapshot>> fetchPayableCases({
    required String memberId,
    required String appToken,
  }) async {
    // The member summary function applies registration-date eligibility and
    // server-side authorization. Do not rebuild that policy with public table
    // reads in the client.
    return fetchMemberCases(memberId: memberId, appToken: appToken);
  }

  Future<List<Map<String, dynamic>>> fetchMemberTransactions({
    required String memberId,
    required String appToken,
    int pageSize = 200,
  }) async {
    final txResponse = await _supabaseService.invokeFunction(
      'api-member-transactions',
      body: {'member_id': memberId, 'page': 1, 'page_size': pageSize},
      headers: {'x-app-token': appToken},
    );

    if (txResponse.status < 200 || txResponse.status >= 300) {
      throw Exception('Failed to load member transactions');
    }

    final txBody =
        (txResponse.data as Map?)?.cast<String, dynamic>() ?? const {};
    return (txBody['transactions'] as List?)
            ?.whereType<Map>()
            .map((e) => e.cast<String, dynamic>())
            .toList() ??
        const <Map<String, dynamic>>[];
  }

  Future<Map<String, dynamic>> fetchMemberSummary({
    required String memberId,
    required String appToken,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-member-summary',
      body: {'member_id': memberId},
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      throw Exception('Failed to load member summary');
    }
    return (response.data as Map?)?.cast<String, dynamic>() ?? const {};
  }

  Future<Map<String, dynamic>> buildMemberReport({
    required String memberId,
    required String appToken,
  }) async {
    final summary =
        await fetchMemberSummary(memberId: memberId, appToken: appToken);
    final tx = await fetchMemberTransactions(
      memberId: memberId,
      appToken: appToken,
      pageSize: 500,
    );
    final completed = tx.where((t) {
      final s = (t['status'] ?? '').toString();
      return s.isEmpty || s == 'completed';
    }).toList();
    final total = completed.length;
    final credits = completed.fold<double>(0, (sum, t) {
      final type = (t['transaction_type'] ?? '').toString();
      final amount = _toDouble(t['amount']).abs();
      if (type == 'wallet_funding' ||
          type == 'contribution_refund' ||
          type == 'case_wallet_refund') {
        return sum + amount;
      }
      return sum;
    });
    final debits = completed.fold<double>(0, (sum, t) {
      final type = (t['transaction_type'] ?? '').toString();
      final amount = _toDouble(t['amount']).abs();
      if (type == 'case_wallet_deduction' ||
          type == 'arrears' ||
          type == 'penalty' ||
          type == 'registration' ||
          type == 'renewal') {
        return sum + amount;
      }
      return sum;
    });
    final activeCases = (summary['active_cases_summary'] as List?)?.length ?? 0;
    return {
      'total_transactions': total,
      'total_credits': credits,
      'total_debits': debits,
      'active_cases': activeCases,
      'wallet_balance':
          _toDouble((summary['member'] as Map?)?['wallet_balance']),
    };
  }

  Future<List<Map<String, dynamic>>> searchMembers({
    required String query,
    required String excludeMemberId,
  }) async {
    if (query.trim().isEmpty) return const [];
    final rows = await _client
        .from('members')
        .select('id, name, member_number')
        .or('name.ilike.%$query%,member_number.ilike.%$query%')
        .neq('id', excludeMemberId)
        .limit(8);
    return (rows as List)
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .toList();
  }

  Future<void> transferFunds({
    required String fromMemberId,
    required String toMemberId,
    required double amount,
    required String toMemberNumber,
  }) async {
    final referenceValue = 'Transfer to $toMemberNumber';
    final result = await _client.rpc(
      'transfer_funds',
      params: {
        'from_member_id': fromMemberId,
        'to_member_id': toMemberId,
        'amount': amount,
        'reference': referenceValue,
      },
    );
    if (result is Map && result['success'] == false) {
      throw Exception((result['message'] ?? 'Transfer failed').toString());
    }
    await _invalidateWallet(fromMemberId);
  }

  Future<void> payToCase({
    required String memberId,
    required String caseId,
    required String caseNumber,
    required double amount,
  }) async {
    final existing = await _client
        .from('transactions')
        .select('status, amount, transaction_type')
        .eq('member_id', memberId)
        .eq('case_id', caseId)
        .inFilter('transaction_type', [
      'contribution',
      'case_wallet_deduction',
      'contribution_refund',
      'case_wallet_refund',
    ]);

    final netPaid =
        (existing as List).whereType<Map>().fold<double>(0, (sum, row) {
      final status = (row['status'] ?? '').toString();
      if (status.isNotEmpty && status != 'completed') return sum;
      final txType = (row['transaction_type'] ?? '').toString();
      final txAmount = _toDouble(row['amount']);
      if (txType == 'contribution' || txType == 'case_wallet_deduction') {
        return sum + txAmount.abs();
      }
      if (txType == 'contribution_refund' || txType == 'case_wallet_refund') {
        return sum - txAmount.abs();
      }
      return sum;
    });

    if (netPaid > 0) {
      throw Exception('Case already paid');
    }

    await _client.from('transactions').insert({
      'member_id': memberId,
      'case_id': caseId,
      'amount': amount,
      'transaction_type': 'case_wallet_deduction',
      'status': 'completed',
      'description':
          'Case wallet deduction for case #$caseNumber (member portal)',
      'metadata': {'source': 'member_portal_pay_to_case'},
    });
    await _invalidateWallet(memberId);
  }

  Future<Map<String, dynamic>> payToCases({
    required String memberId,
    required List<MemberCaseSnapshot> selectedCases,
    required double walletBalance,
  }) async {
    if (selectedCases.isEmpty) {
      throw Exception('Choose one or more cases to pay first.');
    }

    final caseIds = selectedCases.map((c) => c.id).toList();
    final existing = await _client
        .from('transactions')
        .select('case_id, status, amount, transaction_type')
        .eq('member_id', memberId)
        .inFilter('case_id', caseIds)
        .inFilter('transaction_type', [
      'contribution',
      'case_wallet_deduction',
      'arrears',
      'contribution_refund',
      'case_wallet_refund',
    ]);

    final paidByCase = <String, double>{};
    for (final row in (existing as List).whereType<Map>()) {
      final status = (row['status'] ?? '').toString();
      if (status.isNotEmpty && status != 'completed') continue;
      final caseId = (row['case_id'] ?? '').toString();
      if (caseId.isEmpty) continue;
      final txType = (row['transaction_type'] ?? '').toString();
      final txAmount = _toDouble(row['amount']).abs();
      final current = paidByCase[caseId] ?? 0;
      if (txType == 'contribution' ||
          txType == 'case_wallet_deduction' ||
          txType == 'arrears') {
        paidByCase[caseId] = current + txAmount;
      } else if (txType == 'contribution_refund' ||
          txType == 'case_wallet_refund') {
        paidByCase[caseId] = current - txAmount;
      }
    }

    final rows = <Map<String, dynamic>>[];
    for (final c in selectedCases) {
      final requiredAmount = c.contributionPerMember;
      if (requiredAmount <= 0) {
        throw Exception(
            'Case #${c.caseNumber} has no valid contribution amount.');
      }
      final netPaid = (paidByCase[c.id] ?? 0).clamp(0, double.infinity);
      if (netPaid >= requiredAmount) {
        throw Exception('Already settled: #${c.caseNumber}.');
      }
      final remainingAmount =
          (requiredAmount - netPaid).clamp(0, double.infinity);
      if (remainingAmount <= 0) continue;
      final isLate = c.isFinalized;
      rows.add({
        'member_id': memberId,
        'case_id': c.id,
        'amount': remainingAmount,
        'transaction_type': isLate ? 'arrears' : 'case_wallet_deduction',
        'status': 'completed',
        'description': isLate
            ? 'Late case payment (default account) for case #${c.caseNumber} (member portal)'
            : 'Case wallet deduction for case #${c.caseNumber} (member portal)',
        'metadata': {
          'source': 'member_portal_pay_to_case',
          'late_case_payment': isLate,
          'paid_case_number': c.caseNumber,
          'required_amount': requiredAmount,
          'net_paid_before': netPaid,
          'remaining_amount': remainingAmount,
        },
      });
    }

    final totalRequired = rows.fold<double>(
      0,
      (sum, row) => sum + _toDouble(row['amount']),
    );
    if (totalRequired <= 0) {
      throw Exception('All selected cases are already settled.');
    }
    if (totalRequired > walletBalance) {
      throw Exception(
          'Required KES ${totalRequired.toStringAsFixed(2)}, but wallet has KES ${walletBalance.toStringAsFixed(2)}.');
    }

    await _client.from('transactions').insert(rows);
    await _invalidateWallet(memberId);
    return {
      'count': rows.length,
      'total': totalRequired,
    };
  }

  Future<void> _invalidateWallet(String memberId) => _cache.remove(
        ownerScope: 'member:$memberId',
        key: 'wallet_snapshot',
      );

  Future<void> updateMemberPin({
    required String memberId,
    required String oldPin,
    required String newPin,
  }) async {
    final data = await _client.rpc(
      'update_member_pin',
      params: {
        'p_member_id': memberId,
        'p_old_pin': oldPin,
        'p_new_pin': newPin,
      },
    ) as Map<String, dynamic>?;
    if (data != null && data['success'] == false) {
      throw Exception((data['message'] ?? 'Failed to update PIN').toString());
    }
  }

  Future<AdminDashboardSnapshot> fetchAdminDashboard({
    String? appToken,
    bool forceRefresh = false,
  }) async {
    final token = appToken ?? '';
    final cached = await _readAdminCache<AdminDashboardSnapshot>(
      appToken: token,
      key: 'dashboard',
      forceRefresh: forceRefresh,
      decode: AdminDashboardSnapshot.fromMap,
    );
    if (cached != null) return cached;
    final summaryRows = await _client.rpc('get_dashboard_summary');
    final summary = (summaryRows as List?)?.whereType<Map>().firstOrNull;
    final memberCounts = await _fetchAdminMemberCounts();
    final activeCases =
        await _client.from('cases').select('id').eq('is_active', true);
    final suspenseRows = await fetchSuspenseQueue(
      limit: 500,
      appToken: appToken,
    );

    final recentTx = await _client
        .from('transactions')
        .select('description, transaction_type, created_at, amount, status')
        .order('created_at', ascending: false)
        .limit(5);

    final suspenseList = (suspenseRows as List)
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .toList();
    final suspenseTotal = suspenseList.fold<double>(
        0, (sum, row) => sum + _toDouble(row['amount']));
    final result = AdminDashboardSnapshot(
      // The summary RPC returns a database aggregate, so it stays accurate
      // even when the REST API caps a page of member rows at 1,000.
      totalMembers: _toInt(summary?['total_members']) ?? memberCounts.total,
      activeMembers: memberCounts.active,
      inactiveMembers: memberCounts.inactive,
      probationMembers: memberCounts.probation,
      activeCases: (activeCases as List).length,
      totalContributions: _toDouble(summary?['total_contributions']),
      pendingSuspenseTotal: suspenseTotal,
      pendingSuspenseCount: suspenseList.length,
      recentActivity: (recentTx as List)
          .whereType<Map>()
          .map((e) => e.cast<String, dynamic>())
          .toList(),
    );
    await _writeAdminCache(
        appToken: token, key: 'dashboard', value: result.toMap());
    return result;
  }

  Future<_AdminMemberCounts> _fetchAdminMemberCounts() async {
    const pageSize = 1000;
    var total = 0;
    var active = 0;
    var inactive = 0;
    var probation = 0;

    for (var offset = 0;; offset += pageSize) {
      final rows = await _client
          .from('members')
          .select('status, is_active')
          .order('id')
          .range(offset, offset + pageSize - 1);
      final page = (rows as List).whereType<Map>();
      total += page.length;
      for (final row in page) {
        final status = '${row['status'] ?? ''}'.toLowerCase();
        if (status == 'probation' ||
            status == 'probabation' ||
            status == 'probabtion') {
          probation++;
        } else if (status == 'active' ||
            (status.isEmpty && row['is_active'] == true)) {
          active++;
        } else if (status == 'inactive' ||
            (status.isEmpty && row['is_active'] == false)) {
          inactive++;
        }
      }
      if (page.length < pageSize) break;
    }

    return _AdminMemberCounts(total, active, inactive, probation);
  }

  Future<List<MemberDependant>> fetchDependants(String memberId) async {
    final rows = await _client
        .from('dependants')
        .select(
            'id, name, gender, relationship, date_of_birth, is_disabled, is_eligible')
        .eq('member_id', memberId)
        .order('name')
        .timeout(
          const Duration(seconds: 20),
          onTimeout: () => throw Exception(
            'The server did not respond in time. Check your connection and try again.',
          ),
        );
    return (rows as List)
        .whereType<Map>()
        .map((e) => MemberDependant.fromMap(e.cast<String, dynamic>()))
        .toList();
  }

  Future<MemberDependant> addDependant({
    required String memberId,
    required MemberDependant dependant,
  }) async {
    final result = await _client
        .from('dependants')
        .insert(dependant.toInsertMap(memberId))
        .select(
            'id, name, gender, relationship, date_of_birth, is_disabled, is_eligible')
        .single();
    return MemberDependant.fromMap((result as Map).cast<String, dynamic>());
  }

  Future<MemberDependant> updateDependant({
    required String dependantId,
    required MemberDependant dependant,
  }) async {
    final result = await _client
        .from('dependants')
        .update(dependant.toUpdateMap())
        .eq('id', dependantId)
        .select(
            'id, name, gender, relationship, date_of_birth, is_disabled, is_eligible')
        .single();
    return MemberDependant.fromMap((result as Map).cast<String, dynamic>());
  }

  Future<void> deleteDependant(String dependantId) async {
    await _client.from('dependants').delete().eq('id', dependantId);
  }

  Future<List<Map<String, dynamic>>> fetchAdminMembers({
    int page = 1,
    int pageSize = 25,
    String search = '',
    String status = 'all',
    String active = 'all',
    String appToken = '',
    bool forceRefresh = false,
  }) async {
    final cacheKey = 'members:$page:$pageSize:${search.trim()}:$status:$active';
    final cached = await _readAdminCache<List<Map<String, dynamic>>>(
      appToken: appToken,
      key: cacheKey,
      forceRefresh: forceRefresh,
      decode: (value) => (value['rows'] as List)
          .whereType<Map>()
          .map((row) => row.cast<String, dynamic>())
          .toList(),
    );
    if (cached != null) return cached;
    final from = (page - 1) * pageSize;
    final to = from + pageSize - 1;
    var query = _client.from('members').select(
        'id, member_number, name, phone_number, wallet_balance, status, is_active');
    if (search.trim().isNotEmpty) {
      final q = search.trim();
      query = query.or(
        'name.ilike.%$q%,member_number.ilike.%$q%,phone_number.ilike.%$q%',
      );
    }
    if (status != 'all') {
      query = query.eq('status', status);
    }
    if (active == 'active') {
      query = query.eq('is_active', true);
    } else if (active == 'inactive') {
      query = query.eq('is_active', false);
    }
    // member_number is text, so ordering it directly puts 10 before 2.
    // This generated numeric column is indexed in the database and must be
    // used before range() so ordering remains correct across page boundaries.
    final rows = await query
        .order('member_number_numeric', ascending: true)
        .order('member_number', ascending: true)
        .range(from, to);
    final result = (rows as List)
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .toList();
    await _writeAdminCache(
      appToken: appToken,
      key: cacheKey,
      value: {'rows': result},
    );
    return result;
  }

  Future<List<Map<String, dynamic>>> fetchAllAdminMembers({
    String search = '',
    String status = 'all',
    String active = 'all',
  }) async {
    const pageSize = 1000;
    final members = <Map<String, dynamic>>[];
    for (var page = 1;; page++) {
      final rows = await fetchAdminMembers(
        page: page,
        pageSize: pageSize,
        search: search,
        status: status,
        active: active,
      );
      members.addAll(rows);
      if (rows.length < pageSize) return members;
    }
  }

  Future<String> fetchNextMemberNumber() async {
    const pageSize = 1000;
    var offset = 0;
    var largestNumber = 0;
    while (true) {
      final rows = await _client
          .from('members')
          .select('member_number')
          .range(offset, offset + pageSize - 1);
      final page = (rows as List).whereType<Map>();
      for (final row in page) {
        final value = '${row['member_number'] ?? ''}'.trim();
        if (value.startsWith('M')) continue;
        final number = int.tryParse(value);
        if (number != null && number > largestNumber) largestNumber = number;
      }
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return '${largestNumber + 1}';
  }

  Future<List<Map<String, dynamic>>> fetchRegistrationTransactions() async {
    const pageSize = 1000;
    final transactions = <Map<String, dynamic>>[];
    for (var offset = 0;; offset += pageSize) {
      final rows = await _client
          .from('transactions')
          .select(
              'id, member_id, amount, transaction_type, payment_method, mpesa_reference, reference, description, status, created_at, members(name, member_number)')
          .ilike('description', 'Registration%')
          .order('created_at', ascending: false)
          .range(offset, offset + pageSize - 1);
      final page = (rows as List)
          .whereType<Map>()
          .map((row) => row.cast<String, dynamic>())
          .toList();
      transactions.addAll(page);
      if (page.length < pageSize) return transactions;
    }
  }

  Future<Map<String, dynamic>> createAdminMember({
    required String memberNumber,
    required String name,
    required String gender,
    required String dateOfBirth,
    required String nationalIdNumber,
    required String residence,
    required Map<String, dynamic> nextOfKin,
    required List<Map<String, dynamic>> dependants,
    required double registrationFee,
    required bool feePaid,
    String? phoneNumber,
    String? emailAddress,
    String? pin,
  }) async {
    final duplicate = await _client.rpc(
      'member_number_exists',
      params: {
        'p_member_number': memberNumber,
        'p_exclude_member_id': null,
      },
    );
    if (duplicate == true) {
      throw Exception('Member number $memberNumber already exists.');
    }

    final result = await _client.rpc(
      'insert_member',
      params: {
        'p_member_number': memberNumber,
        'p_name': name,
        'p_gender': gender,
        'p_date_of_birth': dateOfBirth,
        'p_national_id_number': nationalIdNumber,
        'p_phone_number': phoneNumber,
        'p_email_address': emailAddress,
        'p_residence': residence,
        'p_next_of_kin': nextOfKin,
        'p_wallet_balance': 0,
        'p_is_active': true,
        'p_registration_date':
            DateTime.now().toIso8601String().substring(0, 10),
        'p_dependants': dependants,
        'p_pin': pin,
        'p_registration_fee': registrationFee,
        'p_fee_paid': feePaid,
      },
    );
    final payload = (result as Map?)?.cast<String, dynamic>() ?? const {};
    if (payload['success'] != true || payload['id'] == null) {
      throw Exception(
          payload['message']?.toString() ?? 'Member registration failed.');
    }
    return payload;
  }

  Future<void> createManagedMemberUser({
    required String appToken,
    required String username,
    required String password,
    required String name,
    required String memberId,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-users-admin',
      body: {
        'action': 'create',
        'username': username,
        'password': password,
        'name': name,
        'role': 'member',
        'is_active': true,
        'member_id': memberId,
      },
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(payload?['error']?.toString() ??
          'Could not create login credentials.');
    }
  }

  Future<void> sendMemberWelcomeSms({
    required String appToken,
    required String memberId,
    required String memberNumber,
    required String name,
    required String phoneNumber,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'send-sms',
      body: {
        'recipients': [
          {
            'phoneNumber': phoneNumber,
            'name': name,
            'memberNumber': memberNumber,
            'memberId': memberId,
          }
        ],
        'message':
            'Malanga Welfare: Welcome {name}. Your member number is {memberNumber}. Member portal: {portalLink}',
        'triggerKey': 'welcome_member',
        'source': 'member_registration',
      },
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(payload?['error']?.toString() ?? 'Welcome SMS failed.');
    }
  }

  Future<List<Map<String, dynamic>>> fetchAdminCases({
    int limit = 200,
    String appToken = '',
    bool forceRefresh = false,
  }) async {
    final cacheKey = 'cases:$limit';
    final cached = await _readAdminCache<List<Map<String, dynamic>>>(
      appToken: appToken,
      key: cacheKey,
      forceRefresh: forceRefresh,
      decode: (value) => (value['rows'] as List)
          .whereType<Map>()
          .map((row) => row.cast<String, dynamic>())
          .toList(),
    );
    if (cached != null) return cached;
    final rows = await _client
        .from('cases')
        .select(
            'id, case_number, case_type, contribution_per_member, expected_amount, actual_amount, is_active, is_finalized, created_at')
        .order('created_at', ascending: false)
        .limit(limit);
    final result = (rows as List)
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .toList();
    await _writeAdminCache(
        appToken: appToken, key: cacheKey, value: {'rows': result});
    return result;
  }

  Future<void> finalizeCase(
      {required String caseId, required double actualAmount}) async {
    await _client.from('cases').update({
      'is_finalized': true,
      'is_active': false,
      'actual_amount': actualAmount,
    }).eq('id', caseId);
  }

  Future<void> reopenCase({required String caseId}) async {
    await _client.from('cases').update({
      'is_finalized': false,
      'is_active': true,
    }).eq('id', caseId);
  }

  Future<void> deleteAdminCase({required String caseId}) async {
    await _client.from('cases').delete().eq('id', caseId);
  }

  Future<List<Map<String, dynamic>>> fetchAdminTransactions({
    int page = 1,
    int pageSize = 30,
    String search = '',
    String appToken = '',
    bool forceRefresh = false,
  }) async {
    final cacheKey = 'transactions:$page:$pageSize:${search.trim()}';
    final cached = await _readAdminCache<List<Map<String, dynamic>>>(
      appToken: appToken,
      key: cacheKey,
      forceRefresh: forceRefresh,
      decode: (value) => (value['rows'] as List)
          .whereType<Map>()
          .map((row) => row.cast<String, dynamic>())
          .toList(),
    );
    if (cached != null) return cached;
    final from = (page - 1) * pageSize;
    final to = from + pageSize - 1;
    var query = _client.from('transactions').select(
        'id, member_id, amount, transaction_type, status, payment_method, description, created_at');
    if (search.trim().isNotEmpty) {
      final q = search.trim();
      query = query.or(
        'description.ilike.%$q%,transaction_type.ilike.%$q%,status.ilike.%$q%,payment_method.ilike.%$q%',
      );
    }
    final rows =
        await query.order('created_at', ascending: false).range(from, to);
    final result = (rows as List)
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .toList();
    await _writeAdminCache(
        appToken: appToken, key: cacheKey, value: {'rows': result});
    return result;
  }

  Future<void> reverseTransaction({
    required String transactionId,
    required String reason,
    String? adminUserId,
  }) async {
    final data = await _client.rpc(
      'revert_transaction',
      params: {
        'p_transaction_id': transactionId,
        'p_admin_id': (adminUserId != null && adminUserId.isNotEmpty)
            ? adminUserId
            : null,
        'p_reason': reason,
      },
    ) as Map<String, dynamic>?;
    if (data != null && data['success'] == false) {
      throw Exception(
          (data['message'] ?? 'Failed to reverse transaction').toString());
    }
  }

  Future<List<Map<String, dynamic>>> fetchSuspenseQueue({
    int limit = 150,
    String? appToken,
  }) async {
    // Prefer backend API path used by web/admin auth model (service-role read).
    if (appToken != null && appToken.isNotEmpty) {
      try {
        final response = await _supabaseService.invokeFunction(
          'api-suspense-list',
          body: {'limit': limit},
          headers: {'x-app-token': appToken},
        );
        if (response.status >= 200 && response.status < 300) {
          final payload =
              (response.data as Map?)?.cast<String, dynamic>() ?? const {};
          final list = (payload['transactions'] as List?)
                  ?.whereType<Map>()
                  .map((e) => e.cast<String, dynamic>())
                  .toList() ??
              const <Map<String, dynamic>>[];
          return list;
        }
      } catch (_) {
        // Fall back to direct query below.
      }
    }

    final rows = await _client
        .from('wrong_mpesa_transactions')
        .select(
            'id, amount, phone_number, reference, mpesa_receipt_number, transaction_date, status, intended_case_id')
        .inFilter('status', ['pending', 'PENDING_REVIEW'])
        .order('transaction_date', ascending: false)
        .limit(limit);
    return (rows as List)
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .toList();
  }

  Future<void> autoMatchSuspense() async {
    await _client.rpc('match_suspense_transactions');
  }

  Future<void> matchSuspenseWithMember({
    required String appToken,
    required String suspenseId,
    required String memberId,
    String? caseId,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-suspense-match',
      body: {
        'suspense_id': suspenseId,
        'member_id': memberId,
        'case_id': caseId,
      },
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(payload?['error']?.toString() ?? 'Match failed');
    }
  }

  Future<void> markSuspenseStatus({
    required String suspenseId,
    required String status,
  }) async {
    await _client
        .from('wrong_mpesa_transactions')
        .update({'status': status}).eq('id', suspenseId);
  }

  Future<Map<String, dynamic>?> fetchSettings(
      {required String appToken}) async {
    final response = await _supabaseService.invokeFunction(
      'api-settings',
      body: {'action': 'get'},
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(
          payload?['error']?.toString() ?? 'Failed to load settings');
    }
    final payload =
        (response.data as Map?)?.cast<String, dynamic>() ?? const {};
    return (payload['settings'] as Map?)?.cast<String, dynamic>();
  }

  Future<Map<String, dynamic>?> updateSettings({
    required String appToken,
    required Map<String, dynamic> settings,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-settings',
      body: {'action': 'update', 'settings': settings},
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(
          payload?['error']?.toString() ?? 'Failed to update settings');
    }
    final payload =
        (response.data as Map?)?.cast<String, dynamic>() ?? const {};
    return (payload['settings'] as Map?)?.cast<String, dynamic>();
  }

  Future<List<String>> fetchResidences() async {
    final rows = await _client
        .from('residences')
        .select('name')
        .not('name', 'is', null)
        .order('name')
        .timeout(
          const Duration(seconds: 20),
          onTimeout: () => throw Exception(
            'The server did not respond in time. Check your connection and try again.',
          ),
        );
    return rows
        .whereType<Map>()
        .map((row) => row['name']?.toString().trim() ?? '')
        .where((name) => name.isNotEmpty)
        .toSet()
        .toList();
  }

  Future<void> createResidence({required String name}) async {
    await _client.from('residences').insert({'name': name.trim()});
  }

  Future<Map<String, dynamic>> fetchReportsSummary({
    required String appToken,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-reports-summary',
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(
          payload?['error']?.toString() ?? 'Failed to load reports summary');
    }
    final payload =
        (response.data as Map?)?.cast<String, dynamic>() ?? const {};
    return (payload['report'] as Map?)?.cast<String, dynamic>() ?? const {};
  }

  Future<List<Map<String, dynamic>>> fetchAdminUsers({
    required String appToken,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-users-admin',
      body: {'action': 'list'},
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(payload?['error']?.toString() ?? 'Failed to load users');
    }
    final payload =
        (response.data as Map?)?.cast<String, dynamic>() ?? const {};
    return (payload['users'] as List?)
            ?.whereType<Map>()
            .map((e) => e.cast<String, dynamic>())
            .toList() ??
        const <Map<String, dynamic>>[];
  }

  Future<void> updateAdminUserStatus({
    required String appToken,
    required String userId,
    required bool isActive,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-users-admin',
      body: {
        'action': 'update_status',
        'user_id': userId,
        'is_active': isActive,
      },
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(
          payload?['error']?.toString() ?? 'Failed to update status');
    }
  }

  Future<void> updateAdminUserRole({
    required String appToken,
    required String userId,
    required String role,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-users-admin',
      body: {
        'action': 'update_role',
        'user_id': userId,
        'role': role,
      },
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(payload?['error']?.toString() ?? 'Failed to update role');
    }
  }

  Future<String?> resetAdminUserPassword({
    required String appToken,
    required String userId,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-users-admin',
      body: {
        'action': 'reset_password',
        'user_id': userId,
      },
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(
          payload?['error']?.toString() ?? 'Failed to reset password');
    }
    final payload =
        (response.data as Map?)?.cast<String, dynamic>() ?? const {};
    final temp = payload['temporary_password'];
    return temp?.toString();
  }

  Future<void> createAdminUser({
    required String appToken,
    required String username,
    required String name,
    required String password,
    required String role,
    String? email,
    String? memberId,
    bool isActive = true,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-users-admin',
      body: {
        'action': 'create',
        'username': username,
        'name': name,
        'password': password,
        'role': role,
        'email': email,
        'member_id': memberId,
        'is_active': isActive,
      },
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(payload?['error']?.toString() ?? 'Failed to create user');
    }
  }

  Future<Map<String, dynamic>> fetchAdminMemberDetails({
    required String appToken,
    required String memberId,
    bool forceRefresh = false,
  }) async {
    final cacheKey = 'member_detail:$memberId';
    final cached = await _readAdminCache<Map<String, dynamic>>(
      appToken: appToken,
      key: cacheKey,
      forceRefresh: forceRefresh,
      decode: (value) => value,
    );
    if (cached != null) return cached;
    final result = await _fetchAdminMemberDetailsFromServer(
      appToken: appToken,
      memberId: memberId,
    );
    await _writeAdminCache(appToken: appToken, key: cacheKey, value: result);
    return result;
  }

  Future<Map<String, dynamic>> _fetchAdminMemberDetailsFromServer({
    required String appToken,
    required String memberId,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-member-details',
      body: {'member_id': memberId},
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(
          payload?['error']?.toString() ?? 'Failed to load member details');
    }
    final payload =
        (response.data as Map?)?.cast<String, dynamic>() ?? <String, dynamic>{};
    try {
      final directMember = await _client
          .from('members')
          .select(
              'id, member_number, name, gender, date_of_birth, national_id_number, phone_number, email_address, residence, next_of_kin, registration_date, probation_end_date, wallet_balance, is_active, status')
          .eq('id', memberId)
          .maybeSingle();
      final dependantRows = await _client
          .from('dependants')
          .select(
              'id, member_id, name, gender, relationship, date_of_birth, is_disabled, is_eligible')
          .eq('member_id', memberId)
          .order('name');
      final directCases = await _client
          .from('cases')
          .select(
              'id, case_number, case_type, contribution_per_member, expected_amount, actual_amount, start_date, end_date, is_active, is_finalized, created_at')
          .eq('affected_member_id', memberId)
          .order('created_at', ascending: false)
          .limit(30);
      if (directMember != null) {
        final apiMember =
            (payload['member'] as Map?)?.cast<String, dynamic>() ??
                <String, dynamic>{};
        payload['member'] = {
          ...apiMember,
          ...(directMember as Map).cast<String, dynamic>(),
        };
      }
      payload['dependants'] = (dependantRows as List)
          .whereType<Map>()
          .map((row) => row.cast<String, dynamic>())
          .toList();
      payload['cases'] = (directCases as List)
          .whereType<Map>()
          .map((row) => row.cast<String, dynamic>())
          .toList();
    } catch (_) {
      // The app-token endpoint still provides the core summary if direct
      // detail-table reads are restricted by row-level security.
    }
    return payload;
  }

  Future<void> updateAdminMemberProfile({
    required String memberId,
    required Map<String, dynamic> updates,
  }) async {
    await _client.from('members').update(updates).eq('id', memberId);
  }

  Future<Map<String, dynamic>> fetchAdminCaseDetails({
    required String appToken,
    required String caseId,
    bool forceRefresh = false,
  }) async {
    final cacheKey = 'case_detail:$caseId';
    final cached = await _readAdminCache<Map<String, dynamic>>(
      appToken: appToken,
      key: cacheKey,
      forceRefresh: forceRefresh,
      decode: (value) => value,
    );
    if (cached != null) return cached;
    final result = await _fetchAdminCaseDetailsFromServer(
      appToken: appToken,
      caseId: caseId,
    );
    await _writeAdminCache(appToken: appToken, key: cacheKey, value: result);
    return result;
  }

  Future<Map<String, dynamic>> _fetchAdminCaseDetailsFromServer({
    required String appToken,
    required String caseId,
  }) async {
    final caseRef = caseId.trim();
    final normalizedCaseNumber =
        caseRef.startsWith('#') ? caseRef.substring(1).trim() : caseRef;
    if (caseRef.isEmpty) {
      throw Exception('Case reference is required');
    }

    var direct = await _client
        .from('cases')
        .select(
            'id, case_number, case_type, affected_member_id, dependant_id, contribution_per_member, expected_amount, actual_amount, start_date, end_date, is_active, is_finalized, created_at, updated_at')
        .or('id.eq.$caseRef,case_number.eq.$caseRef')
        .maybeSingle();
    if (direct == null && normalizedCaseNumber.isNotEmpty) {
      direct = await _client
          .from('cases')
          .select(
              'id, case_number, case_type, affected_member_id, dependant_id, contribution_per_member, expected_amount, actual_amount, start_date, end_date, is_active, is_finalized, created_at, updated_at')
          .eq('case_number', normalizedCaseNumber)
          .maybeSingle();
    }
    if (direct == null) {
      throw Exception(
          'Case not found (case_ref: $caseRef, normalized_case_number: $normalizedCaseNumber)');
    }

    final caseMap = (direct as Map).cast<String, dynamic>();
    final memberId = caseMap['affected_member_id']?.toString();
    if (memberId != null && memberId.isNotEmpty) {
      Map<String, dynamic> affectedMember = {};
      try {
        final memberResponse = await _supabaseService.invokeFunction(
          'api-member-details',
          body: {'member_id': memberId},
          headers: {'x-app-token': appToken},
        );
        if (memberResponse.status >= 200 && memberResponse.status < 300) {
          final data = (memberResponse.data as Map?)?.cast<String, dynamic>();
          affectedMember =
              (data?['member'] as Map?)?.cast<String, dynamic>() ?? {};
        }
      } catch (_) {
        // Try the authenticated database client below as a fallback.
      }
      try {
        final member = await _client
            .from('members')
            .select('id, name, member_number, gender')
            .eq('id', memberId)
            .maybeSingle();
        if (member != null) {
          affectedMember = {
            ...affectedMember,
            ...(member as Map).cast<String, dynamic>(),
          };
        }
      } catch (_) {
        // The service role response still supplies the member name and number.
      }
      caseMap['affected_member'] = affectedMember;
    }
    final dependantId = caseMap['dependant_id']?.toString();
    if (dependantId != null && dependantId.isNotEmpty) {
      try {
        final dependant = await _client
            .from('dependants')
            .select('id, name, gender, relationship')
            .eq('id', dependantId)
            .maybeSingle();
        caseMap['affected_dependant'] = dependant;
      } catch (_) {
        // Dependant details are optional; the member profile remains available.
      }
    }
    final txRows = await _client
        .from('transactions')
        .select('id, member_id, amount, transaction_type, status, created_at')
        .eq('case_id', (caseMap['id'] ?? '').toString())
        .inFilter('transaction_type', [
      'contribution',
      'contribution_refund',
      'case_wallet_deduction',
      'case_wallet_refund',
      'arrears',
    ]).order('created_at', ascending: false);
    final txList = (txRows as List)
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .where((t) {
      final s = (t['status'] ?? '').toString();
      return s.isEmpty || s == 'completed';
    }).toList();
    final contributions = txList
        .where((t) => (t['transaction_type'] == 'contribution' ||
            t['transaction_type'] == 'case_wallet_deduction' ||
            t['transaction_type'] == 'arrears'))
        .fold<double>(0, (sum, t) => sum + _toDouble(t['amount']).abs());
    final refunds = txList
        .where((t) => (t['transaction_type'] == 'contribution_refund' ||
            t['transaction_type'] == 'case_wallet_refund'))
        .fold<double>(0,
            (sum, t) => sum + _toDouble(t['amount']).clamp(0, double.infinity));
    final actualAmount =
        (contributions - refunds).clamp(0, double.infinity).toDouble();
    final paymentStatusRows = await _client.rpc(
      'get_case_payment_compliance_rows_for_case',
      params: {'p_case_id': caseMap['id']},
    );
    final complianceRows = (paymentStatusRows as List)
        .whereType<Map>()
        .map((row) => row.cast<String, dynamic>())
        .toList();
    final memberIds = complianceRows
        .map((row) => row['member_id']?.toString() ?? '')
        .where((id) => id.isNotEmpty)
        .toSet()
        .toList();
    final phoneByMemberId = <String, String>{};
    for (var start = 0; start < memberIds.length; start += 100) {
      final rows = await _client
          .from('members')
          .select('id, phone_number')
          .inFilter('id', memberIds.skip(start).take(100).toList());
      for (final row in (rows as List).whereType<Map>()) {
        final member = row.cast<String, dynamic>();
        phoneByMemberId['${member['id']}'] = '${member['phone_number'] ?? ''}';
      }
    }
    final paymentRowsWithPhones = complianceRows.map((row) {
      final phone = row['phone_number']?.toString().trim();
      return {
        ...row,
        'phone_number': phone?.isNotEmpty == true
            ? phone
            : phoneByMemberId['${row['member_id']}'],
      };
    }).toList();

    return {
      'case': {
        ...caseMap,
        'actual_amount': actualAmount,
        'paid': null,
      },
      'transactions': txList,
      'payment_status': paymentRowsWithPhones,
    };
  }

  Future<Map<String, dynamic>> fetchAccountsSummary({
    required String appToken,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-accounts-summary',
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(
          payload?['error']?.toString() ?? 'Failed to load accounts summary');
    }
    final payload =
        (response.data as Map?)?.cast<String, dynamic>() ?? const {};
    return (payload['accounts'] as Map?)?.cast<String, dynamic>() ?? const {};
  }

  Future<Map<String, dynamic>> bulkDeductCase({
    required String appToken,
    required String caseId,
    required List<String> memberIds,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-case-bulk-deduct',
      body: {
        'case_id': caseId,
        'member_ids': memberIds,
      },
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(payload?['error']?.toString() ?? 'Bulk deduction failed');
    }
    return (response.data as Map?)?.cast<String, dynamic>() ?? const {};
  }

  Future<Map<String, dynamic>> updateMemberStatus({
    required String appToken,
    required String memberId,
    required String status,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-member-status-update',
      body: {
        'member_id': memberId,
        'status': status,
      },
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(
          payload?['error']?.toString() ?? 'Failed to update member status');
    }
    return (response.data as Map?)?.cast<String, dynamic>() ?? const {};
  }

  Future<Map<String, dynamic>> collectMemberFee({
    required String appToken,
    required String memberId,
    required String feeType,
    required double amount,
    String? reference,
    String? description,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-collect-fee',
      body: {
        'member_id': memberId,
        'fee_type': feeType,
        'amount': amount,
        'reference': reference,
        'description': description,
      },
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(payload?['error']?.toString() ?? 'Failed to collect fee');
    }
    return (response.data as Map?)?.cast<String, dynamic>() ?? const {};
  }

  Future<Map<String, dynamic>> adminRecordCasePayment({
    required String appToken,
    required String memberId,
    required String caseId,
    required double amount,
    String transactionType = 'case_wallet_deduction',
    String? description,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-admin-record-case-payment',
      body: {
        'member_id': memberId,
        'case_id': caseId,
        'amount': amount,
        'transaction_type': transactionType,
        'description': description,
      },
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(
          payload?['error']?.toString() ?? 'Failed to record case payment');
    }
    return (response.data as Map?)?.cast<String, dynamic>() ?? const {};
  }

  Future<Map<String, dynamic>> adminRecordWalletFunding({
    required String appToken,
    required String memberId,
    required double amount,
    String? description,
    String? mpesaReference,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-admin-wallet-funding',
      body: {
        'member_id': memberId,
        'amount': amount,
        'description': description,
        'mpesa_reference': mpesaReference,
      },
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(
          payload?['error']?.toString() ?? 'Failed to record wallet funding');
    }
    return (response.data as Map?)?.cast<String, dynamic>() ?? const {};
  }

  double _toDouble(dynamic value) {
    if (value == null) return 0;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString()) ?? 0;
  }

  int? _toInt(dynamic value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    return int.tryParse('$value');
  }

  Future<List<Map<String, dynamic>>> fetchReportContributions(
      {required String appToken, Map<String, dynamic>? filters}) async {
    try {
      final response = await _supabaseService.invokeFunction(
        'api-reports-summary',
        headers: {'x-app-token': appToken},
      );
      if (response.status < 200 || response.status >= 300) {
        return const <Map<String, dynamic>>[];
      }
      final payload =
          (response.data as Map?)?.cast<String, dynamic>() ?? const {};
      final report =
          (payload['report'] as Map?)?.cast<String, dynamic>() ?? const {};
      final monthlyData = (report['monthly_contributions'] as List?)
              ?.whereType<Map>()
              .map((e) => e.cast<String, dynamic>())
              .toList() ??
          const <Map<String, dynamic>>[];
      return monthlyData;
    } catch (_) {
      return const <Map<String, dynamic>>[];
    }
  }

  Future<List<Map<String, dynamic>>> fetchReportTransactions(
      {required String appToken, Map<String, dynamic>? filters}) async {
    final limit = (filters?['limit'] as int?) ?? 200;
    final offset = (filters?['offset'] as int?) ?? 0;
    try {
      final response = await _supabaseService.invokeFunction(
        'api-transactions-list',
        body: {
          'limit': limit,
          'offset': offset,
          'type': filters?['type'],
        },
        headers: {'x-app-token': appToken},
      );
      if (response.status < 200 || response.status >= 300) {
        return const <Map<String, dynamic>>[];
      }
      final payload =
          (response.data as Map?)?.cast<String, dynamic>() ?? const {};
      return (payload['transactions'] as List?)
              ?.whereType<Map>()
              .map((e) => e.cast<String, dynamic>())
              .toList() ??
          const <Map<String, dynamic>>[];
    } catch (_) {
      return const <Map<String, dynamic>>[];
    }
  }

  Future<List<Map<String, dynamic>>> fetchReportDefaulters(
      {required String appToken, Map<String, dynamic>? filters}) async {
    try {
      final response = await _supabaseService.invokeFunction(
        'api-members-list',
        body: {'status': 'all'},
        headers: {'x-app-token': appToken},
      );
      if (response.status < 200 || response.status >= 300) {
        return const <Map<String, dynamic>>[];
      }
      final payload =
          (response.data as Map?)?.cast<String, dynamic>() ?? const {};
      final members = (payload['members'] as List?)
              ?.whereType<Map>()
              .map((e) => e.cast<String, dynamic>())
              .where((m) => _toDouble(m['wallet_balance']) < 0)
              .toList() ??
          const <Map<String, dynamic>>[];
      return members;
    } catch (_) {
      return const <Map<String, dynamic>>[];
    }
  }

  Future<List<Map<String, dynamic>>> fetchReportMembers(
      {required String appToken, Map<String, dynamic>? filters}) async {
    try {
      final response = await _supabaseService.invokeFunction(
        'api-members-list',
        body: {'status': 'all'},
        headers: {'x-app-token': appToken},
      );
      if (response.status < 200 || response.status >= 300) {
        return const <Map<String, dynamic>>[];
      }
      final payload =
          (response.data as Map?)?.cast<String, dynamic>() ?? const {};
      return (payload['members'] as List?)
              ?.whereType<Map>()
              .map((e) => e.cast<String, dynamic>())
              .toList() ??
          const <Map<String, dynamic>>[];
    } catch (_) {
      return const <Map<String, dynamic>>[];
    }
  }

  Future<List<Map<String, dynamic>>> fetchReportDiscipline(
      {required String appToken, Map<String, dynamic>? filters}) async {
    final days = (filters?['days'] as int?) ?? 180;
    try {
      final response = await _supabaseService.invokeFunction(
        'api-discipline-report',
        body: {'days': days},
        headers: {'x-app-token': appToken},
      );
      if (response.status < 200 || response.status >= 300) {
        return const <Map<String, dynamic>>[];
      }
      final payload =
          (response.data as Map?)?.cast<String, dynamic>() ?? const {};
      final transitions = (payload['transitions'] as List?)
              ?.whereType<Map>()
              .map((e) => e.cast<String, dynamic>())
              .toList() ??
          const <Map<String, dynamic>>[];
      return transitions;
    } catch (_) {
      return const <Map<String, dynamic>>[];
    }
  }

  Future<Map<String, dynamic>> fetchFiscalStats(
      {required String appToken, Map<String, dynamic>? filters}) async {
    try {
      final response = await _supabaseService.invokeFunction(
        'api-reports-summary',
        headers: {'x-app-token': appToken},
      );
      if (response.status < 200 || response.status >= 300) {
        return const {};
      }
      final payload =
          (response.data as Map?)?.cast<String, dynamic>() ?? const {};
      return (payload['report'] as Map?)?.cast<String, dynamic>() ?? const {};
    } catch (_) {
      return const {};
    }
  }

  Future<List<Map<String, dynamic>>> fetchFiscalContributions(
      {required String appToken, Map<String, dynamic>? filters}) async {
    try {
      final response = await _supabaseService.invokeFunction(
        'api-reports-summary',
        headers: {'x-app-token': appToken},
      );
      if (response.status < 200 || response.status >= 300) {
        return const <Map<String, dynamic>>[];
      }
      final payload =
          (response.data as Map?)?.cast<String, dynamic>() ?? const {};
      final report =
          (payload['report'] as Map?)?.cast<String, dynamic>() ?? const {};
      return (report['monthly_contributions'] as List?)
              ?.whereType<Map>()
              .map((e) => e.cast<String, dynamic>())
              .toList() ??
          const <Map<String, dynamic>>[];
    } catch (_) {
      return const <Map<String, dynamic>>[];
    }
  }

  Future<List<Map<String, dynamic>>> fetchCaseFundingSummary(
      {required String appToken, Map<String, dynamic>? filters}) async {
    try {
      final response = await _supabaseService.invokeFunction(
        'api-cases-list',
        body: {
          'status': filters?['status'],
          'type': filters?['type'],
        },
        headers: {'x-app-token': appToken},
      );
      if (response.status < 200 || response.status >= 300) {
        return const <Map<String, dynamic>>[];
      }
      final payload =
          (response.data as Map?)?.cast<String, dynamic>() ?? const {};
      return (payload['cases'] as List?)
              ?.whereType<Map>()
              .map((e) => e.cast<String, dynamic>())
              .toList() ??
          const <Map<String, dynamic>>[];
    } catch (_) {
      return const <Map<String, dynamic>>[];
    }
  }

  Future<List<Map<String, dynamic>>> fetchMemberContributionsReport(
      {required String appToken, Map<String, dynamic>? filters}) async {
    try {
      final response = await _supabaseService.invokeFunction(
        'api-members-list',
        body: {'status': 'all'},
        headers: {'x-app-token': appToken},
      );
      if (response.status < 200 || response.status >= 300) {
        return const <Map<String, dynamic>>[];
      }
      final payload =
          (response.data as Map?)?.cast<String, dynamic>() ?? const {};
      final members = (payload['members'] as List?)
              ?.whereType<Map>()
              .map((e) => e.cast<String, dynamic>())
              .toList() ??
          const <Map<String, dynamic>>[];
      return members;
    } catch (_) {
      return const <Map<String, dynamic>>[];
    }
  }

  Future<List<Map<String, dynamic>>> fetchComplianceCasePayments(
      {required String appToken, Map<String, dynamic>? filters}) async {
    try {
      final response = await _supabaseService.invokeFunction(
        'api-reports-summary',
        headers: {'x-app-token': appToken},
      );
      if (response.status < 200 || response.status >= 300) {
        return const <Map<String, dynamic>>[];
      }
      final payload =
          (response.data as Map?)?.cast<String, dynamic>() ?? const {};
      final report =
          (payload['report'] as Map?)?.cast<String, dynamic>() ?? const {};
      return (report['case_payments_compliance'] as List?)
              ?.whereType<Map>()
              .map((e) => e.cast<String, dynamic>())
              .toList() ??
          const <Map<String, dynamic>>[];
    } catch (_) {
      return const <Map<String, dynamic>>[];
    }
  }

  Future<List<Map<String, dynamic>>> fetchAuditTrail(
      {required String appToken, Map<String, dynamic>? filters}) async {
    try {
      final response = await _supabaseService.invokeFunction(
        'api-reports-summary',
        headers: {'x-app-token': appToken},
      );
      if (response.status < 200 || response.status >= 300) {
        return const <Map<String, dynamic>>[];
      }
      final payload =
          (response.data as Map?)?.cast<String, dynamic>() ?? const {};
      final report =
          (payload['report'] as Map?)?.cast<String, dynamic>() ?? const {};
      return (report['audit_entries'] as List?)
              ?.whereType<Map>()
              .map((e) => e.cast<String, dynamic>())
              .toList() ??
          const <Map<String, dynamic>>[];
    } catch (_) {
      return const <Map<String, dynamic>>[];
    }
  }

  Future<List<Map<String, dynamic>>> fetchReversalsAudit(
      {required String appToken, Map<String, dynamic>? filters}) async {
    try {
      final response = await _supabaseService.invokeFunction(
        'api-reports-summary',
        headers: {'x-app-token': appToken},
      );
      if (response.status < 200 || response.status >= 300) {
        return const <Map<String, dynamic>>[];
      }
      final payload =
          (response.data as Map?)?.cast<String, dynamic>() ?? const {};
      final report =
          (payload['report'] as Map?)?.cast<String, dynamic>() ?? const {};
      return (report['reversals'] as List?)
              ?.whereType<Map>()
              .map((e) => e.cast<String, dynamic>())
              .toList() ??
          const <Map<String, dynamic>>[];
    } catch (_) {
      return const <Map<String, dynamic>>[];
    }
  }

  Future<List<Map<String, dynamic>>> fetchComplianceIssues(
      {required String appToken, Map<String, dynamic>? filters}) async {
    try {
      final response = await _supabaseService.invokeFunction(
        'api-reports-summary',
        headers: {'x-app-token': appToken},
      );
      if (response.status < 200 || response.status >= 300) {
        return const <Map<String, dynamic>>[];
      }
      final payload =
          (response.data as Map?)?.cast<String, dynamic>() ?? const {};
      final report =
          (payload['report'] as Map?)?.cast<String, dynamic>() ?? const {};
      return (report['compliance_issues'] as List?)
              ?.whereType<Map>()
              .map((e) => e.cast<String, dynamic>())
              .toList() ??
          const <Map<String, dynamic>>[];
    } catch (_) {
      return const <Map<String, dynamic>>[];
    }
  }

  Future<void> updateTransactionDescription({
    required String transactionId,
    required String description,
    String? caseId,
  }) async {
    await _client.from('transactions').update({
      'description': description,
    }).eq('id', transactionId);
  }

  Future<void> deleteCase({required String caseId}) async {
    await _client.from('cases').delete().eq('id', caseId);
  }

  Future<void> deleteMember({required String memberId}) async {
    await _client.from('members').delete().eq('id', memberId);
  }

  Future<Map<String, dynamic>> importMembers({
    required String appToken,
    required List<Map<String, dynamic>> members,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-members-import',
      body: {'members': members},
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(
          payload?['error']?.toString() ?? 'Failed to import members');
    }
    final payload =
        (response.data as Map?)?.cast<String, dynamic>() ?? const {};
    return payload;
  }

  Future<List<Map<String, dynamic>>> fetchSmsTemplates(
      {required String appToken}) async {
    final response = await _supabaseService.invokeFunction(
      'api-sms-templates',
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      throw Exception('Failed to load SMS templates');
    }
    final payload =
        (response.data as Map?)?.cast<String, dynamic>() ?? const {};
    return (payload['templates'] as List?)
            ?.whereType<Map>()
            .map((e) => e.cast<String, dynamic>())
            .toList() ??
        const <Map<String, dynamic>>[];
  }

  Future<Map<String, dynamic>> updateSmsTemplate({
    required String appToken,
    required String triggerKey,
    required Map<String, dynamic> updates,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-sms-templates',
      body: {'trigger_key': triggerKey, ...updates},
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(
          payload?['error']?.toString() ?? 'Failed to update template');
    }
    final payload =
        (response.data as Map?)?.cast<String, dynamic>() ?? const {};
    return (payload['template'] as Map?)?.cast<String, dynamic>() ?? const {};
  }

  Future<List<Map<String, dynamic>>> fetchSmsAlertSettings({
    required String appToken,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-sms-alert-settings',
      body: {'action': 'list'},
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(
          payload?['error']?.toString() ?? 'Failed to load SMS recipients');
    }
    final payload =
        (response.data as Map?)?.cast<String, dynamic>() ?? const {};
    return (payload['settings'] as List?)
            ?.whereType<Map>()
            .map((row) => row.cast<String, dynamic>())
            .toList() ??
        const <Map<String, dynamic>>[];
  }

  Future<Map<String, dynamic>> updateSmsAlertRecipients({
    required String appToken,
    required String triggerKey,
    required List<String> adminUserIds,
  }) async {
    final response = await _supabaseService.invokeFunction(
      'api-sms-alert-settings',
      body: {
        'action': 'update',
        'trigger_key': triggerKey,
        'admin_user_ids': adminUserIds,
      },
      headers: {'x-app-token': appToken},
    );
    if (response.status < 200 || response.status >= 300) {
      final payload = (response.data as Map?)?.cast<String, dynamic>();
      throw Exception(
          payload?['error']?.toString() ?? 'Failed to save SMS recipients');
    }
    final payload =
        (response.data as Map?)?.cast<String, dynamic>() ?? const {};
    return (payload['setting'] as Map?)?.cast<String, dynamic>() ?? const {};
  }

  Future<bool> testMpesaConnection({required String appToken}) async {
    final response = await _supabaseService.invokeFunction(
      'api-mpesa-test',
      headers: {'x-app-token': appToken},
    );
    return response.status >= 200 && response.status < 300;
  }
}
