import 'package:supabase_flutter/supabase_flutter.dart';

import 'supabase_service.dart';

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
  final int activeCases;
  final double pendingSuspenseTotal;
  final int pendingSuspenseCount;
  final List<Map<String, dynamic>> recentActivity;

  const AdminDashboardSnapshot({
    required this.totalMembers,
    required this.activeCases,
    required this.pendingSuspenseTotal,
    required this.pendingSuspenseCount,
    required this.recentActivity,
  });
}

class LiveDataService {
  final SupabaseClient _client = Supabase.instance.client;
  final SupabaseService _supabaseService = SupabaseService();

  Future<MemberWalletSnapshot> fetchMemberWalletData({
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
  }) async {
    final memberResp = await _client
        .from('members')
        .select('status')
        .eq('id', memberId)
        .maybeSingle();
    final memberStatus =
        ((memberResp as Map?)?['status'] ?? '').toString().toLowerCase().trim();
    if (memberStatus != 'active' && memberStatus != 'probation') {
      return const [];
    }

    final rows = await _client
        .from('cases')
        .select(
            'id, case_number, case_type, contribution_per_member, is_active, is_finalized')
        .or('is_active.eq.true,is_finalized.eq.true');
    final raw = (rows as List)
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .toList();

    if (raw.isEmpty) return const [];

    final caseIds = raw.map((r) => '${r['id']}').toList();
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

    final mapped = raw.map((r) {
      final caseId = (r['id'] ?? '').toString();
      final required = _toDouble(r['contribution_per_member']);
      final netPaid =
          (paidByCase[caseId] ?? 0).clamp(0, double.infinity).toDouble();
      return MemberCaseSnapshot(
        id: caseId,
        caseNumber: (r['case_number'] ?? 'N/A').toString(),
        caseType: (r['case_type'] ?? 'unknown').toString(),
        contributionPerMember: required,
        amountPaid: netPaid,
        remainingAmount:
            (required - netPaid).clamp(0, double.infinity).toDouble(),
        progress:
            required <= 0 ? 0 : (netPaid / required).clamp(0.0, 1.0).toDouble(),
        isFinalized: r['is_finalized'] == true,
        paid: netPaid >= required && required > 0,
      );
    }).toList();

    mapped.sort((a, b) => a.caseNumber.compareTo(b.caseNumber));
    return mapped;
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
    final primaryResult = await (_client.rpc as dynamic)('transfer_funds', {
      'from_member_id': fromMemberId,
      'to_member_id': toMemberId,
      'amount': amount,
      'reference_text': referenceValue,
    });
    if (primaryResult.error != null) {
      final fallbackResult = await (_client.rpc as dynamic)('transfer_funds', {
        'from_member_id': fromMemberId,
        'to_member_id': toMemberId,
        'amount': amount,
        'reference': referenceValue,
      });
      if (fallbackResult.error != null) {
        throw Exception(fallbackResult.error.message ?? 'Transfer failed');
      }
    }
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
    return {
      'count': rows.length,
      'total': totalRequired,
    };
  }

  Future<void> updateMemberPin({
    required String memberId,
    required String oldPin,
    required String newPin,
  }) async {
    final response = await (_client.rpc as dynamic)('update_member_pin', {
      'p_member_id': memberId,
      'p_old_pin': oldPin,
      'p_new_pin': newPin,
    });
    if (response.error != null) {
      throw Exception(response.error.message ?? 'Failed to update PIN');
    }
    final data = response.data as Map<String, dynamic>?;
    if (data != null && data['success'] == false) {
      throw Exception((data['message'] ?? 'Failed to update PIN').toString());
    }
  }

  Future<AdminDashboardSnapshot> fetchAdminDashboard({String? appToken}) async {
    final members = await _client.from('members').select('id');
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

    return AdminDashboardSnapshot(
      totalMembers: (members as List).length,
      activeCases: (activeCases as List).length,
      pendingSuspenseTotal: suspenseTotal,
      pendingSuspenseCount: suspenseList.length,
      recentActivity: (recentTx as List)
          .whereType<Map>()
          .map((e) => e.cast<String, dynamic>())
          .toList(),
    );
  }

  Future<List<MemberDependant>> fetchDependants(String memberId) async {
    final rows = await _client
        .from('dependants')
        .select(
            'id, name, gender, relationship, date_of_birth, is_disabled, is_eligible')
        .eq('member_id', memberId)
        .order('name');
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
  }) async {
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
    final rows =
        await query.order('member_number', ascending: true).range(from, to);
    return (rows as List)
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .toList();
  }

  Future<List<Map<String, dynamic>>> fetchAdminCases({int limit = 200}) async {
    final rows = await _client
        .from('cases')
        .select(
            'id, case_number, case_type, contribution_per_member, expected_amount, actual_amount, is_active, is_finalized, created_at')
        .order('created_at', ascending: false)
        .limit(limit);
    return (rows as List)
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .toList();
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

  Future<List<Map<String, dynamic>>> fetchAdminTransactions({
    int page = 1,
    int pageSize = 30,
    String search = '',
  }) async {
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
    return (rows as List)
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .toList();
  }

  Future<void> reverseTransaction({
    required String transactionId,
    required String reason,
    String? adminUserId,
  }) async {
    final response = await (_client.rpc as dynamic)('revert_transaction', {
      'p_transaction_id': transactionId,
      'p_admin_id':
          (adminUserId != null && adminUserId.isNotEmpty) ? adminUserId : null,
      'p_reason': reason,
    });
    if (response.error != null) {
      throw Exception(
          response.error.message ?? 'Failed to reverse transaction');
    }
    final data = response.data as Map<String, dynamic>?;
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
    final response =
        await (_client.rpc as dynamic)('match_suspense_transactions');
    if (response.error != null) {
      throw Exception(response.error.message ?? 'Auto-match failed');
    }
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
        .order('name');
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
    return (response.data as Map?)?.cast<String, dynamic>() ?? const {};
  }

  Future<Map<String, dynamic>> fetchAdminCaseDetails({
    required String appToken,
    required String caseId,
  }) async {
    // Kept for compatibility with existing callers.
    // ignore: unused_local_variable
    final unusedAppToken = appToken;

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

    return {
      'case': {
        ...caseMap,
        'actual_amount': actualAmount,
        'paid': null,
      },
      'transactions': txList,
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

  Future<bool> testMpesaConnection({required String appToken}) async {
    final response = await _supabaseService.invokeFunction(
      'api-mpesa-test',
      headers: {'x-app-token': appToken},
    );
    return response.status >= 200 && response.status < 300;
  }
}
