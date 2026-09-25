import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Filter, RefreshCw, FileText, Printer, Search, SortAsc, SortDesc } from 'lucide-react';
import { format, subMonths, startOfDay, endOfDay } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import DashboardLayout from '@/layouts/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Gender, Member, Case, CaseType } from '@/lib/types';
import { supabase } from '@/integrations/supabase/client';
import { persistentCache } from '@/lib/cache';
import ReportsSubnav from '@/components/reports/ReportsSubnav';
import { createReportFilename, exportRowsToCSV, exportRowsToXLSX } from '@/lib/reportExport';
import { invokeWithAppToken } from '@/lib/appAuth';
import {
  CASE_ROW_COLUMNS,
  REPORT_TRANSACTION_COLUMNS,
} from '@/lib/supabaseSelectColumns';
import { normalizeMemberStatus } from '@/lib/db-types';

import {
  ContributionTrendChart,
  MemberDemographicsChart,
  DefaulterAnalyticsChart,
  DateRangeFilter,
  MonthlyContribution,
  MemberDemographic,
  DefaulterByLocation,
  ReportDateRange,
} from '@/components/reports';

interface Transaction {
  id: string;
  amount: number;
  mpesa_reference: string | null;
  description: string | null;
  created_at: string;
  transaction_type: string;
  status?: string | null;
  member_id?: string;
  case_id?: string;
  [key: string]: unknown;
}

interface ReportSummary {
  total_members?: number;
  active_cases?: number;
  total_contributions?: number | string;
  total_registration_fees?: number | string;
  [key: string]: unknown;
}

interface DisciplineMetrics {
  active_count: number;
  inactive_count: number;
  probation_count: number;
  deceased_count: number;
  auto_inactive_total: number;
  reinstatement_total: number;
  reinstatement_penalty_total: number;
}

interface DisciplineTransition {
  id: string;
  member_id: string;
  member_number: string | null;
  member_name: string | null;
  from_status: string | null;
  to_status: string;
  reason: string;
  performed_by_role: string | null;
  created_at: string;
}

interface DisciplineReinstatement {
  id: string;
  member_id: string;
  member_number: string | null;
  member_name: string | null;
  penalty_transaction_id: string | null;
  unpaid_case_count_at_check: number;
  unpaid_total_at_check: number;
  probation_end_date: string;
  performed_by_role: string | null;
  created_at: string;
}

interface DisciplineUnpaidObligation {
  member_id: string;
  member_number: string;
  name: string;
  status: string;
  unpaid_case_count: number;
  unpaid_total: number;
}

interface DisciplineReportResponse {
  days: number;
  status_distribution: Record<string, number>;
  default_outcomes?: {
    streak_0: number;
    streak_1: number;
    streak_ge_2: number;
    members_tracked: number;
  };
  metrics: DisciplineMetrics;
  transitions: DisciplineTransition[];
  reinstatements: DisciplineReinstatement[];
  unpaid_obligations: DisciplineUnpaidObligation[];
  default_streaks?: Array<{
    member_id: string;
    member_number: string | null;
    member_name: string | null;
    member_status: string | null;
    current_streak: number;
    last_defaulted: boolean;
    updated_at: string;
    last_case_id: string | null;
  }>;
  late_payment_metrics?: {
    late_payment_count: number;
    late_payment_total: number;
  };
  late_payment_sample_metrics?: {
    late_payment_count: number;
    late_payment_total: number;
  };
  late_payment_scope?: {
    from_date: string;
    row_limit: number;
    sampled_row_count: number;
    full_row_count: number;
    sample_truncated: boolean;
  };
  late_payments?: Array<{
    id: string;
    member_id: string;
    member_number: string | null;
    member_name: string | null;
    member_status: string | null;
    case_id: string | null;
    case_number: string;
    amount: number;
    status: string;
    description: string | null;
    created_at: string;
  }>;
}

interface MembersListApiResponse {
  members: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

interface HeaderMap {
  key: string;
  label: string;
}

const INVALID_TRANSACTION_STATUSES = new Set(['failed', 'reversed', 'cancelled', 'canceled', 'voided', 'error']);

const normalizeType = (value: unknown) => String(value || '').trim().toLowerCase();
const normalizeStatus = (value: unknown) => String(value || '').trim().toLowerCase();

const isCountableTransaction = (tx: Transaction) => !INVALID_TRANSACTION_STATUSES.has(normalizeStatus(tx.status));
const isContributionTransaction = (tx: Transaction) => {
  const type = normalizeType(tx.transaction_type);
  return type === 'contribution' || type === 'contribution_refund' || type === 'case_wallet_deduction';
};
const isPositiveContribution = (tx: Transaction) => normalizeType(tx.transaction_type) === 'contribution';
const getContributionSignedAmount = (tx: Transaction) => {
  const amount = Math.abs(Number(tx.amount || 0));
  return normalizeType(tx.transaction_type) === 'contribution_refund' ? -amount : amount;
};
const isLatePaymentTransaction = (tx: Transaction) => {
  const type = normalizeType(tx.transaction_type);
  return type === 'arrears' || type === 'late_payment';
};
const isPenaltyTransaction = (tx: Transaction) => normalizeType(tx.transaction_type) === 'penalty';

const ITEMS_PER_PAGE = 20;

const getPageNumbers = (currentPage: number, totalPages: number) => {
  const pages: number[] = [];
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(start + 4, totalPages);
  for (let i = start; i <= end; i++) pages.push(i);
  return pages;
};

const contributionHeaders: HeaderMap[] = [
  { key: 'id', label: 'Transaction ID' },
  { key: 'case_number', label: 'Case Number' },
  { key: 'transaction_type', label: 'Type' },
  { key: 'amount', label: 'Amount (KES)' },
  { key: 'mpesa_reference', label: 'M-Pesa Ref' },
  { key: 'description', label: 'Description' },
  { key: 'created_at', label: 'Date' },
];

const defaulterHeaders: HeaderMap[] = [
  { key: 'memberNumber', label: 'Member #' },
  { key: 'name', label: 'Name' },
  { key: 'walletBalance', label: 'Balance (KES)' },
  { key: 'phoneNumber', label: 'Phone' },
  { key: 'residence', label: 'Residence' },
];

const memberHeaders: HeaderMap[] = [
  { key: 'memberNumber', label: 'Member #' },
  { key: 'name', label: 'Name' },
  { key: 'walletBalance', label: 'Balance' },
  { key: 'totalContributions', label: 'Total Contributed (KES)' },
  { key: 'transactionCount', label: 'Transactions' },
  { key: 'lastContributionDate', label: 'Last Contribution' },
  { key: 'residence', label: 'Residence' },
];

const transactionHeaders: HeaderMap[] = [
  { key: 'id', label: 'Transaction ID' },
  { key: 'created_at', label: 'Date' },
  { key: 'memberNumber', label: 'Member #' },
  { key: 'memberName', label: 'Member Name' },
  { key: 'transaction_type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'amount', label: 'Amount (KES)' },
  { key: 'mpesa_reference', label: 'M-Pesa Ref' },
  { key: 'description', label: 'Description' },
];

const disciplineTransitionHeaders: HeaderMap[] = [
  { key: 'created_at', label: 'Date' },
  { key: 'member_number', label: 'Member #' },
  { key: 'member_name', label: 'Name' },
  { key: 'from_status', label: 'From' },
  { key: 'to_status', label: 'To' },
  { key: 'reason', label: 'Reason' },
  { key: 'performed_by_role', label: 'Role' },
];

const disciplineReinstatementHeaders: HeaderMap[] = [
  { key: 'created_at', label: 'Date' },
  { key: 'member_number', label: 'Member #' },
  { key: 'member_name', label: 'Name' },
  { key: 'unpaid_case_count_at_check', label: 'Unpaid Cases at Check' },
  { key: 'unpaid_total_at_check', label: 'Unpaid Total at Check (KES)' },
  { key: 'probation_end_date', label: 'Probation End' },
  { key: 'performed_by_role', label: 'Role' },
];

const disciplineUnpaidHeaders: HeaderMap[] = [
  { key: 'member_number', label: 'Member #' },
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'unpaid_case_count', label: 'Unpaid Cases' },
  { key: 'unpaid_total', label: 'Unpaid Total (KES)' },
];

const disciplineDefaultStreakHeaders: HeaderMap[] = [
  { key: 'member_number', label: 'Member #' },
  { key: 'member_name', label: 'Name' },
  { key: 'member_status', label: 'Current Status' },
  { key: 'current_streak', label: 'Consecutive Defaults' },
  { key: 'last_defaulted', label: 'Defaulted In Last Finalized Case' },
  { key: 'updated_at', label: 'Last Evaluated At' },
];

const disciplineLatePaymentHeaders: HeaderMap[] = [
  { key: 'created_at', label: 'Date' },
  { key: 'member_number', label: 'Member #' },
  { key: 'member_name', label: 'Name' },
  { key: 'member_status', label: 'Current Status' },
  { key: 'case_number', label: 'Case #' },
  { key: 'amount', label: 'Amount (KES)' },
  { key: 'status', label: 'Status' },
  { key: 'description', label: 'Description' },
];

const REPORT_TX_BATCH = 2000;
const REPORT_TX_MAX = 10000;
const REPORT_TX_LOOKBACK_MONTHS = 12;

async function fetchReportTransactionsBatched(startDateIso: string): Promise<Transaction[]> {
  const rows: Transaction[] = [];
  for (let from = 0; rows.length < REPORT_TX_MAX; from += REPORT_TX_BATCH) {
    const to = from + REPORT_TX_BATCH - 1;
    const { data, error } = await supabase
      .from('transactions')
      .select(REPORT_TRANSACTION_COLUMNS)
      .gte('created_at', startDateIso)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as Transaction[]));
    if (data.length < REPORT_TX_BATCH) break;
  }
  return rows;
}

const Reports = () => {
  const navigate = useNavigate();
  const { toast: showToast } = useToast();
  const [activeTab, setActiveTab] = useState('contributions');
  const [locationFilter, setLocationFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [dateRange, setDateRange] = useState<ReportDateRange>({
    startDate: subMonths(new Date(), 1),
    endDate: new Date(),
    preset: 'month'
  });

  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [transactionSearchTerm, setTransactionSearchTerm] = useState('');
  const [transactionTypeFilter, setTransactionTypeFilter] = useState('all');
  const [transactionStatusFilter, setTransactionStatusFilter] = useState('all');
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [caseFilterSearch, setCaseFilterSearch] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const [members, setMembers] = useState<Member[]>(() => persistentCache.get<Member[]>('reports-members') || []);
  const [cases, setCases] = useState<Case[]>(() => persistentCache.get<Case[]>('reports-cases') || []);
  const [transactions, setTransactions] = useState<Transaction[]>(() => persistentCache.get<Transaction[]>('reports-tx') || []);
  const [summary, setSummary] = useState<ReportSummary | null>(() => persistentCache.get<ReportSummary>('reports-summary') || null);
  const [defaultersList, setDefaultersList] = useState<Member[]>(() => persistentCache.get<Member[]>('reports-defaulters') || []);
  const [disciplineReport, setDisciplineReport] = useState<DisciplineReportResponse | null>(
    () => persistentCache.get<DisciplineReportResponse>('reports-discipline') || null
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'members') {
      setSearchTerm('');
    }
    if (activeTab !== 'transactions') {
      setTransactionSearchTerm('');
      setTransactionTypeFilter('all');
      setTransactionStatusFilter('all');
    }
  }, [activeTab]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCaseIds]);

  useEffect(() => {
    setCurrentPage(1);
  }, [transactionSearchTerm, transactionTypeFilter, transactionStatusFilter]);

  useEffect(() => {
    setSortColumn(null);
    setSortDirection('asc');
  }, [activeTab]);

  const fetchAll = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
      setLoading(true);
    } else if (!persistentCache.has('reports-members')) {
      setLoading(true);
    }

    try {
      const fetchMembersViaApi = async () => {
        const rows: Array<Record<string, unknown>> = [];
        const limit = 300;
        let offset = 0;

        for (;;) {
          const result = await invokeWithAppToken<MembersListApiResponse>('api-members-list', {
            search: '',
            status: 'all',
            limit,
            offset,
          });
          const batch = Array.isArray(result?.members) ? result.members : [];
          rows.push(...batch);
          if (!result?.has_more || batch.length === 0) break;
          offset += limit;
        }

        return rows;
      };

      const reportStartIso = startOfDay(subMonths(new Date(), REPORT_TX_LOOKBACK_MONTHS)).toISOString();

      const [summaryRes, memberRows, casesRes, reportTransactions, defaulterRows] = await Promise.all([
        (supabase.rpc as any)('get_dashboard_summary'),
        fetchMembersViaApi(),
        supabase.from('cases').select(CASE_ROW_COLUMNS),
        fetchReportTransactionsBatched(reportStartIso),
        supabase.from('active_defaulters').select('id, member_number, name, phone_number, wallet_balance, status, is_active').limit(5000),
      ]);

      if (summaryRes.data) {
        const s = summaryRes.data[0] || summaryRes.data;
        setSummary(s);
        persistentCache.set('reports-summary', s, 10 * 60 * 1000);
      }

      const mappedMembers: Member[] = (memberRows || []).map((m: any) => ({
        ...m,
        id: m.id,
        memberNumber: m.member_number,
        name: m.name,
        gender: m.gender as Gender,
        dateOfBirth: m.date_of_birth ? new Date(m.date_of_birth) : new Date(),
        nationalIdNumber: m.national_id_number || '',
        phoneNumber: m.phone_number || '',
        emailAddress: m.email_address || '',
        residence: m.residence || '',
        registrationDate: m.registration_date ? new Date(m.registration_date) : new Date(),
        walletBalance: Number(m.wallet_balance) || 0,
        isActive: m.is_active,
        status: normalizeMemberStatus(m.status, m.is_active),
        nextOfKin:
          m.next_of_kin && typeof m.next_of_kin === "object"
            ? {
                name: String((m.next_of_kin as Record<string, unknown>).name || ""),
                relationship: String((m.next_of_kin as Record<string, unknown>).relationship || ""),
                phoneNumber: String(
                  (m.next_of_kin as Record<string, unknown>).phoneNumber ||
                    (m.next_of_kin as Record<string, unknown>).phone_number ||
                    "",
                ),
              }
            : { name: "", relationship: "", phoneNumber: "" },
        dependants: []
      }));
      setMembers(mappedMembers);
      persistentCache.set('reports-members', mappedMembers, 10 * 60 * 1000);

      const mappedCases: Case[] = (casesRes.data || []).map((c: any) => ({
        ...c,
        id: c.id,
        caseNumber: c.case_number,
        affectedMemberId: c.affected_member_id,
        caseType: c.case_type as CaseType,
        contributionPerMember: Number(c.contribution_per_member) || 0,
        startDate: c.start_date ? new Date(c.start_date) : new Date(),
        endDate: c.end_date ? new Date(c.end_date) : new Date(),
        expectedAmount: Number(c.expected_amount) || 0,
        actualAmount: Number(c.actual_amount) || 0,
        dependantId: c.dependant_id || undefined,
        isActive: c.is_active,
        isFinalized: c.is_finalized,
        createdAt: c.created_at ? new Date(c.created_at) : new Date(),
      }));
      setCases(mappedCases);
      persistentCache.set('reports-cases', mappedCases, 10 * 60 * 1000);

      const mappedDefaulters: Member[] = (defaulterRows?.data || []).map((d: any) => ({
        id: d.id,
        memberNumber: d.member_number || '',
        name: d.name || '',
        phoneNumber: d.phone_number || '',
        walletBalance: Number(d.wallet_balance) || 0,
        residence: '',
        isActive: d.is_active,
        status: normalizeMemberStatus(d.status, d.is_active),
        gender: '' as Gender,
        dateOfBirth: new Date(),
        nationalIdNumber: '',
        emailAddress: '',
        registrationDate: new Date(),
        nextOfKin: { name: '', relationship: '', phoneNumber: '' },
        dependants: []
      }));
      setDefaultersList(mappedDefaulters);
      persistentCache.set('reports-defaulters', mappedDefaulters, 10 * 60 * 1000);

      const txs: Transaction[] = reportTransactions;
      setTransactions(txs);
      persistentCache.set('reports-tx', txs, 10 * 60 * 1000);

      try {
        const discipline = await invokeWithAppToken<DisciplineReportResponse>('api-discipline-report', { days: 180 });
        setDisciplineReport(discipline);
        persistentCache.set('reports-discipline', discipline, 10 * 60 * 1000);
      } catch (disciplineError) {
        console.error('Error fetching discipline report data:', disciplineError);
      }

    } catch (error) {
      console.error('Error fetching data:', error);
      showToast({
        title: 'Error',
        description: 'Failed to fetch report data. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      const txDate = new Date(tx.created_at);
      return txDate >= dateRange.startDate && txDate <= endOfDay(dateRange.endDate);
    });
  }, [transactions, dateRange]);

  const filteredMembers = useMemo(() => {
    return members.filter(m => locationFilter === 'all' || (m.residence || '').toLowerCase() === locationFilter.toLowerCase());
  }, [members, locationFilter]);

  const defaulters = useMemo(() => {
    let result: Member[];
    if (defaultersList.length > 0) {
      const lookup = new Map(members.map(m => [m.id, m]));
      result = defaultersList.map(d => {
        const existing = lookup.get(d.id);
        if (existing) return existing;
        return d;
      });
    } else {
      result = members.filter(m => m.walletBalance < 0);
    }
    if (locationFilter !== 'all') {
      result = result.filter(m => (m.residence || '').toLowerCase() === locationFilter.toLowerCase());
    }
    return result;
  }, [members, defaultersList, locationFilter]);

  const uniqueLocations = useMemo(() => {
    return [...new Set(members.map(m => m.residence).filter(Boolean))].sort();
  }, [members]);

  const stats = useMemo(() => ({
    totalMembers: summary?.total_members || members.length,
    activeCases: summary?.active_cases || cases.filter(c => c.isActive).length,
    totalContributions: Number(summary?.total_contributions) || 0,
    totalRegistrationFees: Number(summary?.total_registration_fees) || 0,
  }), [summary, members.length, cases]);

  const memberLookup = useMemo(() => {
    const map = new Map<string, { memberNumber: string; name: string; residence: string }>();
    members.forEach((member) => {
      map.set(member.id, {
        memberNumber: member.memberNumber || '',
        name: member.name || '',
        residence: member.residence || '',
      });
    });
    return map;
  }, [members]);

  const caseLookup = useMemo(() => {
    const map = new Map<string, { caseNumber: string; caseType: string }>();
    cases.forEach((c) => {
      map.set(c.id, {
        caseNumber: c.caseNumber || '',
        caseType: String(c.caseType || ''),
      });
    });
    return map;
  }, [cases]);

  const caseFilterOptions = useMemo(() => {
    return cases
      .map((c) => ({
        id: c.id,
        label: `#${c.caseNumber} - ${String(c.caseType || '').toUpperCase()}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [cases]);

  const filteredCaseFilterOptions = useMemo(() => {
    const term = caseFilterSearch.trim().toLowerCase();
    if (!term) return caseFilterOptions;
    return caseFilterOptions.filter((c) => c.label.toLowerCase().includes(term));
  }, [caseFilterOptions, caseFilterSearch]);

  const contributionsData = useMemo(() => {
    return filteredTransactions
      .filter((tx) => isCountableTransaction(tx) && isContributionTransaction(tx))
      .filter((tx) => selectedCaseIds.length === 0 || (tx.case_id ? selectedCaseIds.includes(tx.case_id) : false))
      .map((tx) => ({
        ...tx,
        case_number: tx.case_id ? caseLookup.get(tx.case_id)?.caseNumber || '-' : '-',
        case_type: tx.case_id ? caseLookup.get(tx.case_id)?.caseType || '' : '',
        amount: getContributionSignedAmount(tx),
      }));
  }, [filteredTransactions, selectedCaseIds, caseLookup]);

  const contributionTrendData: MonthlyContribution[] = useMemo(() => {
    const grouped = new Map<string, { month: string; monthKey: number; amount: number; count: number }>();

    contributionsData
      .forEach((tx) => {
        const txDate = new Date(tx.created_at);
        const monthKey = txDate.getFullYear() * 100 + (txDate.getMonth() + 1);
        const key = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}`;
        const existing = grouped.get(key) || {
          month: format(txDate, 'MMM yyyy'),
          monthKey,
          amount: 0,
          count: 0,
        };

        existing.amount += Number(tx.amount || 0);
        existing.count += 1;
        grouped.set(key, existing);
      });

    return Array.from(grouped.values())
      .sort((a, b) => a.monthKey - b.monthKey)
      .map(({ month, amount, count }) => ({ month, amount, count }));
  }, [contributionsData]);

  const genderDistribution: MemberDemographic[] = useMemo(() => {
    const counts: Record<string, number> = { male: 0, female: 0 };
    members.forEach(m => {
      if (m.gender) counts[m.gender] = (counts[m.gender] || 0) + 1;
    });
    return [
      { label: 'Male', value: counts.male, color: '#3b82f6' },
      { label: 'Female', value: counts.female, color: '#ec4899' }
    ].filter(d => d.value > 0);
  }, [members]);

  const residenceDistribution: MemberDemographic[] = useMemo(() => {
    const counts: Record<string, number> = {};
    members.forEach(m => {
      if (m.residence) counts[m.residence] = (counts[m.residence] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, value]) => ({ label, value, color: '#8b5cf6' }))
      .sort((a, b) => b.value - a.value);
  }, [members]);

  const statusDistribution: MemberDemographic[] = useMemo(() => {
    const counts: Record<string, number> = {
      Active: 0,
      Inactive: 0,
      Probation: 0,
      Deceased: 0,
    };
    members.forEach((m) => {
      const raw = String((m as any).status || '').toLowerCase();
      const status = raw === 'probation' ? 'Probation' : raw === 'deceased' ? 'Deceased' : raw === 'inactive' ? 'Inactive' : 'Active';
      counts[status] = (counts[status] || 0) + 1;
    });
    const colors: Record<string, string> = {
      Active: '#10b981',
      Inactive: '#6b7280',
      Probation: '#f59e0b',
      Deceased: '#dc2626',
    };
    return Object.entries(counts)
      .map(([label, value]) => ({
        label,
        value,
        color: colors[label] || '#64748b',
      }))
      .sort((a, b) => b.value - a.value);
  }, [members]);

  const disciplineStatusDistributionData = useMemo(() => {
    if (!disciplineReport?.status_distribution) return [];
    return Object.entries(disciplineReport.status_distribution).map(([status, count]) => ({
      status,
      count: Number(count || 0),
    }));
  }, [disciplineReport]);

  const latePaymentReconciliation = useMemo(() => {
    const metricsCount = Number(disciplineReport?.late_payment_sample_metrics?.late_payment_count || 0);
    const metricsTotal = Number(disciplineReport?.late_payment_sample_metrics?.late_payment_total || 0);
    const rowCount = (disciplineReport?.late_payments || []).length;
    const rowTotal = (disciplineReport?.late_payments || []).reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0);

    const countDiff = metricsCount - rowCount;
    const totalDiff = metricsTotal - rowTotal;
    const countMatch = countDiff === 0;
    const totalMatch = Math.abs(totalDiff) < 0.0001;

    return {
      metricsCount,
      metricsTotal,
      rowCount,
      rowTotal,
      countDiff,
      totalDiff,
      countMatch,
      totalMatch,
      isMatch: countMatch && totalMatch,
      fullCount: Number(disciplineReport?.late_payment_metrics?.late_payment_count || 0),
      fullTotal: Number(disciplineReport?.late_payment_metrics?.late_payment_total || 0),
      scope: disciplineReport?.late_payment_scope || null,
    };
  }, [disciplineReport]);

  const disciplineAccountReconciliation = useMemo(() => {
    const days = Number(disciplineReport?.days || 180);
    const fromTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const inScope = (tx: Transaction) => new Date(String(tx.created_at)).getTime() >= fromTime;
    const successful = (tx: Transaction) => {
      const s = String(tx.status || '').toLowerCase();
      return s === '' || s === 'completed' || s === 'success';
    };

    const arrearsRows = transactions.filter((tx) => inScope(tx) && successful(tx) && isLatePaymentTransaction(tx));
    const penaltyRows = transactions.filter((tx) => inScope(tx) && successful(tx) && isPenaltyTransaction(tx));

    const arrearsLedgerCount = arrearsRows.length;
    const arrearsLedgerTotal = arrearsRows.reduce((sum, tx) => sum + Math.abs(Number(tx.amount || 0)), 0);
    const lateCount = Number(disciplineReport?.late_payment_metrics?.late_payment_count || 0);
    const lateTotal = Number(disciplineReport?.late_payment_metrics?.late_payment_total || 0);

    const penaltyLedgerCount = penaltyRows.length;
    const penaltyLedgerTotal = penaltyRows.reduce((sum, tx) => sum + Math.abs(Number(tx.amount || 0)), 0);
    const reinstatementCount = Number(disciplineReport?.metrics?.reinstatement_total || 0);
    const reinstatementPenaltyTotal = Number(disciplineReport?.metrics?.reinstatement_penalty_total || 0);

    return {
      days,
      arrearsLedgerCount,
      arrearsLedgerTotal,
      lateCount,
      lateTotal,
      arrearsCountDiff: arrearsLedgerCount - lateCount,
      arrearsTotalDiff: arrearsLedgerTotal - lateTotal,
      penaltyLedgerCount,
      penaltyLedgerTotal,
      reinstatementCount,
      reinstatementPenaltyTotal,
      penaltyCountDiff: penaltyLedgerCount - reinstatementCount,
      penaltyTotalDiff: penaltyLedgerTotal - reinstatementPenaltyTotal,
    };
  }, [disciplineReport, transactions]);

  const defaulterByLocation: DefaulterByLocation[] = useMemo(() => {
    const grouped: Record<string, DefaulterByLocation> = {};
    defaulters.forEach(d => {
      const residence = d.residence || 'Unknown';
      if (!grouped[residence]) {
        grouped[residence] = { residence, count: 0, totalAmount: 0 };
      }
      grouped[residence].count += 1;
      grouped[residence].totalAmount += Math.abs(d.walletBalance);
    });
    return Object.values(grouped);
  }, [defaulters]);

  const searchAndFilterData = useCallback((data: Record<string, unknown>[]) => {
    if (!searchTerm) return data;
    const search = searchTerm.toLowerCase();
    return data.filter(item => 
      Object.values(item).some(val => 
        String(val).toLowerCase().includes(search)
      )
    );
  }, [searchTerm]);

  const sortData = useCallback((data: Record<string, unknown>[]) => {
    if (!sortColumn) return data;

    const compareMemberNumber = (a: unknown, b: unknown) => {
      const aText = String(a || '');
      const bText = String(b || '');
      const aDigits = Number((aText.match(/\d+/)?.[0] || 'NaN'));
      const bDigits = Number((bText.match(/\d+/)?.[0] || 'NaN'));
      if (!Number.isNaN(aDigits) && !Number.isNaN(bDigits) && aDigits !== bDigits) {
        return aDigits - bDigits;
      }
      return aText.localeCompare(bText, undefined, { numeric: true, sensitivity: 'base' });
    };

    const compareMaybeDate = (a: unknown, b: unknown) => {
      const aTime = new Date(String(a || '')).getTime();
      const bTime = new Date(String(b || '')).getTime();
      if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
        return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
      }
      return aTime - bTime;
    };

    return [...data].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let result = 0;
      if (sortColumn === 'memberNumber') {
        result = compareMemberNumber(aVal, bVal);
      } else if (sortColumn === 'created_at' || sortColumn === 'lastContributionDate') {
        result = compareMaybeDate(aVal, bVal);
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        result = aVal - bVal;
      } else {
        result = String(aVal).localeCompare(String(bVal), undefined, { numeric: true, sensitivity: 'base' });
      }

      if (result < 0) return sortDirection === 'asc' ? -1 : 1;
      if (result > 0) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [sortColumn, sortDirection]);

  const handleSort = useCallback((column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }, [sortColumn]);

  const contributionAnalytics = useMemo(() => {
    const totalAmount = contributionsData.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const count = contributionsData.length;
    const uniqueContributors = new Set(
      contributionsData.map((tx) => tx.member_id).filter(Boolean) as string[]
    ).size;

    const rangeMs = dateRange.endDate.getTime() - dateRange.startDate.getTime();
    const previousRangeEnd = new Date(dateRange.startDate.getTime() - 1);
    const previousRangeStart = new Date(previousRangeEnd.getTime() - rangeMs);
    const previousTotal = transactions
      .filter((tx) => {
        if (!isCountableTransaction(tx) || !isContributionTransaction(tx)) return false;
        if (selectedCaseIds.length > 0 && (!tx.case_id || !selectedCaseIds.includes(tx.case_id))) return false;
        const txDate = new Date(tx.created_at);
        return txDate >= previousRangeStart && txDate <= previousRangeEnd;
      })
      .reduce((sum, tx) => sum + getContributionSignedAmount(tx), 0);

    const growthRate = previousTotal > 0 ? ((totalAmount - previousTotal) / previousTotal) * 100 : null;
    return { totalAmount, count, uniqueContributors, growthRate };
  }, [contributionsData, dateRange.endDate, dateRange.startDate, transactions, selectedCaseIds]);

  const arrearsAnalytics = useMemo(() => {
    const filtered = transactions.filter((tx) => {
      if (!isCountableTransaction(tx) || !isLatePaymentTransaction(tx)) return false;
      if (selectedCaseIds.length > 0 && (!tx.case_id || !selectedCaseIds.includes(tx.case_id))) return false;
      const txDate = new Date(String(tx.created_at));
      return txDate >= dateRange.startDate && txDate <= dateRange.endDate;
    });
    return {
      count: filtered.length,
      total: filtered.reduce((sum, tx) => sum + Math.abs(Number(tx.amount || 0)), 0),
    };
  }, [transactions, selectedCaseIds, dateRange.startDate, dateRange.endDate]);

  const penaltyAnalytics = useMemo(() => {
    const filtered = transactions.filter((tx) => {
      if (!isCountableTransaction(tx) || !isPenaltyTransaction(tx)) return false;
      const txDate = new Date(String(tx.created_at));
      return txDate >= dateRange.startDate && txDate <= dateRange.endDate;
    });
    return {
      count: filtered.length,
      total: filtered.reduce((sum, tx) => sum + Math.abs(Number(tx.amount || 0)), 0),
    };
  }, [transactions, dateRange.startDate, dateRange.endDate]);

  const transactionTypeOptions = useMemo(() => {
    return Array.from(new Set(transactions.map((tx) => tx.transaction_type).filter(Boolean))).sort();
  }, [transactions]);

  const transactionStatusOptions = useMemo(() => {
    return Array.from(
      new Set(
        transactions
          .map((tx) => (typeof tx.status === 'string' ? tx.status.toLowerCase() : ''))
          .filter(Boolean)
      )
    ).sort();
  }, [transactions]);

  const transactionDetailsData = useMemo(() => {
    const search = transactionSearchTerm.trim().toLowerCase();
    return filteredTransactions
      .filter((tx) => transactionTypeFilter === 'all' || tx.transaction_type === transactionTypeFilter)
      .filter((tx) => {
        if (transactionStatusFilter === 'all') return true;
        return String(tx.status || 'unknown').toLowerCase() === transactionStatusFilter;
      })
      .map((tx) => {
        const member = tx.member_id ? memberLookup.get(tx.member_id) : undefined;
        return {
          ...tx,
          memberName: member?.name || '-',
          memberNumber: member?.memberNumber || '-',
          status: String(tx.status || 'unknown'),
          amount: Math.abs(Number(tx.amount || 0)),
        };
      })
      .filter((tx) => {
        if (!search) return true;
        const searchableValues = [
          tx.id,
          tx.memberName,
          tx.memberNumber,
          tx.transaction_type,
          tx.status,
          tx.mpesa_reference || '',
          tx.description || '',
        ];
        return searchableValues.some((value) => String(value).toLowerCase().includes(search));
      });
  }, [filteredTransactions, memberLookup, transactionSearchTerm, transactionTypeFilter, transactionStatusFilter]);

  const transactionsByDateData = useMemo(() => {
    const grouped = new Map<string, { date: string; dateKey: number; amount: number; count: number }>();

    transactionDetailsData.forEach((tx) => {
      const txDate = new Date(String(tx.created_at));
      const dateKey = txDate.getTime();
      const date = format(txDate, 'MMM dd');
      const raw = Number(tx.amount || 0);
      const type = normalizeType(tx.transaction_type);
      const signedAmount = type === 'disbursement' || type === 'contribution_refund' ? -Math.abs(raw) : Math.abs(raw);
      const key = format(txDate, 'yyyy-MM-dd');
      const existing = grouped.get(key) || { date, dateKey, amount: 0, count: 0 };

      existing.amount += signedAmount;
      existing.count += 1;
      grouped.set(key, existing);
    });

    return Array.from(grouped.values())
      .sort((a, b) => a.dateKey - b.dateKey)
      .slice(-30)
      .map(({ date, amount, count }) => ({ date, amount, count }));
  }, [transactionDetailsData]);

  const memberReportData = useMemo(() => {
    const summaryByMember = new Map<string, { totalContributions: number; transactionCount: number; lastContributionDate: Date | null }>();
    transactions
      .filter((tx) => isCountableTransaction(tx) && isContributionTransaction(tx))
      .forEach((tx) => {
      if (!tx.member_id) return;
      const existing = summaryByMember.get(tx.member_id) || {
        totalContributions: 0,
        transactionCount: 0,
        lastContributionDate: null,
      };
      const txDate = new Date(tx.created_at);
      const currentLast = existing.lastContributionDate;
      summaryByMember.set(tx.member_id, {
        totalContributions: existing.totalContributions + getContributionSignedAmount(tx),
        transactionCount: existing.transactionCount + 1,
        lastContributionDate: isPositiveContribution(tx) && (!currentLast || txDate > currentLast) ? txDate : currentLast,
      });
    });

    return filteredMembers.map((member) => {
      const txSummary = summaryByMember.get(member.id);
      return {
        ...member,
        totalContributions: txSummary?.totalContributions || 0,
        transactionCount: txSummary?.transactionCount || 0,
        lastContributionDate: txSummary?.lastContributionDate ? txSummary.lastContributionDate.toISOString() : '',
        lastContributionDateDisplay: txSummary?.lastContributionDate ? format(txSummary.lastContributionDate, 'MMM dd, yyyy') : '-',
      };
    });
  }, [transactions, filteredMembers]);

  const paginatedContributions = useMemo(() => {
    const searched = searchAndFilterData(contributionsData as Record<string, unknown>[]);
    const sorted = sortData(searched);
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return {
      data: sorted.slice(start, end),
      total: sorted.length,
      totalPages: Math.max(1, Math.ceil(sorted.length / ITEMS_PER_PAGE))
    };
  }, [contributionsData, searchAndFilterData, sortData, currentPage]);

  const paginatedDefaulters = useMemo(() => {
    const searched = searchAndFilterData(defaulters as unknown as Record<string, unknown>[]);
    const sorted = sortData(searched);
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return {
      data: sorted.slice(start, end),
      total: sorted.length,
      totalPages: Math.max(1, Math.ceil(sorted.length / ITEMS_PER_PAGE))
    };
  }, [defaulters, searchAndFilterData, sortData, currentPage]);

  const paginatedTransactionDetails = useMemo(() => {
    const searched = searchAndFilterData(transactionDetailsData as Record<string, unknown>[]);
    const sorted = sortData(searched);
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return {
      data: sorted.slice(start, end),
      total: sorted.length,
      totalPages: Math.max(1, Math.ceil(sorted.length / ITEMS_PER_PAGE))
    };
  }, [transactionDetailsData, searchAndFilterData, sortData, currentPage]);

  const paginatedMembers = useMemo(() => {
    const searched = searchAndFilterData(memberReportData as unknown as Record<string, unknown>[]);
    const sorted = sortData(searched);
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return {
      data: sorted.slice(start, end),
      total: sorted.length,
      totalPages: Math.max(1, Math.ceil(sorted.length / ITEMS_PER_PAGE))
    };
  }, [memberReportData, searchAndFilterData, sortData, currentPage]);

  useEffect(() => {
    if (activeTab !== 'members') return;
    setSortColumn((prev) => prev || 'memberNumber');
    setSortDirection((prev) => (sortColumn ? prev : 'asc'));
  }, [activeTab, sortColumn]);

  const handleDateRangeApply = (startDate: Date, endDate: Date, preset?: 'month' | 'quarter' | 'year' | 'custom') => {
    setDateRange({ startDate, endDate, preset });
    setCurrentPage(1);
  };

  const handleRefresh = () => {
    persistentCache.clear();
    fetchAll(true);
  };

  const handleExportXlsx = async (baseName: string, rows: Record<string, unknown>[], headers: HeaderMap[]) => {
    if (!rows.length) {
      showToast({
        title: 'No data to export',
        description: 'Adjust filters or date range and try again.',
        variant: 'destructive',
      });
      return;
    }
    await exportRowsToXLSX(createReportFilename(baseName, 'xlsx'), rows, headers);
    showToast({ title: 'Export complete', description: 'Excel file downloaded.' });
  };

  const handleExportCsv = (baseName: string, rows: Record<string, unknown>[], headers: HeaderMap[]) => {
    if (!rows.length) {
      showToast({
        title: 'No data to export',
        description: 'Adjust filters or date range and try again.',
        variant: 'destructive',
      });
      return;
    }
    exportRowsToCSV(createReportFilename(baseName, 'csv'), rows, headers);
    showToast({ title: 'Export complete', description: 'CSV file downloaded.' });
  };

  const renderPagination = (totalPages: number) => {
    const pageNumbers = getPageNumbers(currentPage, totalPages);
    return (
      <Pagination className="mt-4">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious 
              href="#" 
              onClick={(e) => { e.preventDefault(); setCurrentPage(p => Math.max(1, p - 1)); }}
              className={currentPage === 1 ? 'pointer-events-none opacity-50' : ''}
            />
          </PaginationItem>
          {pageNumbers.map(pageNum => (
            <PaginationItem key={pageNum}>
              <PaginationLink 
                href="#" 
                onClick={(e) => { e.preventDefault(); setCurrentPage(pageNum); }}
                isActive={currentPage === pageNum}
              >
                {pageNum}
              </PaginationLink>
            </PaginationItem>
          ))}
          {totalPages > 5 && currentPage < totalPages - 2 && (
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
          )}
          <PaginationItem>
            <PaginationNext 
              href="#" 
              onClick={(e) => { e.preventDefault(); setCurrentPage(p => Math.min(totalPages, p + 1)); }}
              className={currentPage >= totalPages ? 'pointer-events-none opacity-50' : ''}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-8 p-3 sm:p-6 min-h-screen bg-background">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
          <Card className="shadow-sm border-l-4 border-primary/70 hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Members</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-extrabold">
                {loading ? <Skeleton className="h-9 w-20" /> : stats.totalMembers}
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-sm border-l-4 border-primary/50 hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Active Cases</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-extrabold">
                {loading ? <Skeleton className="h-9 w-20" /> : stats.activeCases}
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-sm border-l-4 border-accent/70 hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Contributions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-extrabold">
                {loading ? <Skeleton className="h-9 w-32" /> : `KES ${stats.totalContributions.toLocaleString()}`}
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-sm border-l-4 border-accent/50 hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Registration Fees</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-extrabold">
                {loading ? <Skeleton className="h-9 w-32" /> : `KES ${stats.totalRegistrationFees.toLocaleString()}`}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black mb-1 text-primary tracking-tight">Reports</h1>
            <p className="text-lg text-muted-foreground font-medium">Analytics and exported data</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button 
              variant="outline" 
              className="shadow-sm border-2 font-semibold" 
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
            <Button variant="outline" className="shadow-sm border-2 font-semibold" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
            <DateRangeFilter 
              onApply={handleDateRangeApply}
              initialStartDate={dateRange.startDate}
              initialEndDate={dateRange.endDate}
            />
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="w-full sm:w-[200px] border-2 font-medium bg-white">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by Location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {uniqueLocations.map(loc => <SelectItem key={loc} value={loc}>{loc}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ReportsSubnav />

        <Tabs defaultValue="contributions" className="space-y-8" onValueChange={setActiveTab}>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl border bg-white p-1 shadow-sm sm:grid-cols-5">
            <TabsTrigger value="contributions" className="min-h-10 whitespace-normal rounded-lg px-2 py-2 text-xs font-bold leading-tight transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground sm:text-sm">Contributions</TabsTrigger>
            <TabsTrigger value="transactions" className="min-h-10 whitespace-normal rounded-lg px-2 py-2 text-xs font-bold leading-tight transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground sm:text-sm">Transactions</TabsTrigger>
            <TabsTrigger value="defaulters" className="min-h-10 whitespace-normal rounded-lg px-2 py-2 text-xs font-bold leading-tight transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground sm:text-sm">Defaulters</TabsTrigger>
            <TabsTrigger value="members" className="min-h-10 whitespace-normal rounded-lg px-2 py-2 text-xs font-bold leading-tight transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground sm:text-sm">Member List</TabsTrigger>
            <TabsTrigger value="discipline" className="min-h-10 whitespace-normal rounded-lg px-2 py-2 text-xs font-bold leading-tight transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground sm:text-sm">Discipline</TabsTrigger>
          </TabsList>

          <TabsContent value="contributions" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Contributions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">KES {contributionAnalytics.totalAmount.toLocaleString()}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Contribution Transactions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{contributionAnalytics.count.toLocaleString()}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Unique Contributors</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{contributionAnalytics.uniqueContributors.toLocaleString()}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Range Growth</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${contributionAnalytics.growthRate != null && contributionAnalytics.growthRate < 0 ? 'text-destructive' : 'text-primary'}`}>
                    {contributionAnalytics.growthRate == null ? 'N/A' : `${contributionAnalytics.growthRate >= 0 ? '+' : ''}${contributionAnalytics.growthRate.toFixed(1)}%`}
                  </div>
                  <p className="text-xs text-muted-foreground">Compared with previous range</p>
                </CardContent>
              </Card>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Late Payments Collected</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">KES {arrearsAnalytics.total.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">{arrearsAnalytics.count.toLocaleString()} late-payment transactions in range</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Reinstatement Penalties Collected</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">KES {penaltyAnalytics.total.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">{penaltyAnalytics.count.toLocaleString()} penalty transactions in range</p>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Transaction Category Legend</CardTitle>
                <CardDescription>How collections are categorized in analytics and exports.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-1">
                <p><span className="font-semibold text-foreground">Case payments:</span> `contribution`, `case_wallet_deduction`</p>
                <p><span className="font-semibold text-foreground">Late/closed-case payments:</span> `late_payment` (legacy: `arrears`)</p>
                <p><span className="font-semibold text-foreground">Reinstatement penalty:</span> `penalty`</p>
              </CardContent>
            </Card>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-2">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Late Payments (Count)</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold">{Number(disciplineReport?.late_payment_metrics?.late_payment_count || 0).toLocaleString()}</div></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Late Payments (Total)</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold">KES {Number(disciplineReport?.late_payment_metrics?.late_payment_total || 0).toLocaleString()}</div></CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Late Payment Reconciliation</CardTitle>
                <CardDescription>Checks sampled API metrics against sampled detailed rows (same scope).</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Count Match</div>
                    <div className={`text-xl font-bold ${latePaymentReconciliation.countMatch ? 'text-green-700' : 'text-red-700'}`}>
                      {latePaymentReconciliation.countMatch ? 'MATCH' : 'MISMATCH'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Sample metrics: {latePaymentReconciliation.metricsCount.toLocaleString()} | Rows: {latePaymentReconciliation.rowCount.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Amount Match</div>
                    <div className={`text-xl font-bold ${latePaymentReconciliation.totalMatch ? 'text-green-700' : 'text-red-700'}`}>
                      {latePaymentReconciliation.totalMatch ? 'MATCH' : 'MISMATCH'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Sample metrics: KES {latePaymentReconciliation.metricsTotal.toLocaleString()} | Rows: KES {latePaymentReconciliation.rowTotal.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Delta (Metrics - Rows)</div>
                    <div className={`text-xl font-bold ${latePaymentReconciliation.isMatch ? 'text-green-700' : 'text-red-700'}`}>
                      KES {latePaymentReconciliation.totalDiff.toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Count delta: {latePaymentReconciliation.countDiff.toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="mt-4 text-xs text-muted-foreground">
                  Full range total: {latePaymentReconciliation.fullCount.toLocaleString()} rows, KES {latePaymentReconciliation.fullTotal.toLocaleString()}
                  {latePaymentReconciliation.scope?.sample_truncated ? ` (sample limited to ${latePaymentReconciliation.scope.row_limit.toLocaleString()} rows)` : ''}
                </div>
              </CardContent>
            </Card>

            <ContributionTrendChart 
              data={contributionTrendData}
              title="Contribution Trends"
              description={`Monthly contributions from ${format(dateRange.startDate, 'MMM dd, yyyy')} to ${format(dateRange.endDate, 'MMM dd, yyyy')}`}
            />

            <Card className="shadow-xl border-t-4 border-primary">
              <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b pb-6">
                <div>
                  <CardTitle className="text-2xl font-bold">Contribution History</CardTitle>
                  <CardDescription className="text-base font-medium">Historical member contributions</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="lg" className="border-2 font-bold w-full sm:min-w-[220px] justify-start">
                        {selectedCaseIds.length === 0 ? 'All cases' : `${selectedCaseIds.length} case(s) selected`}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[95vw] sm:w-[320px] p-3" align="end">
                      <div className="space-y-3">
                        <Input
                          placeholder="Search cases..."
                          value={caseFilterSearch}
                          onChange={(e) => setCaseFilterSearch(e.target.value)}
                        />
                        <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                          {filteredCaseFilterOptions.map((option) => (
                            <label key={option.id} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={selectedCaseIds.includes(option.id)}
                                onCheckedChange={(checked) => {
                                  setSelectedCaseIds((prev) => {
                                    if (checked) return prev.includes(option.id) ? prev : [...prev, option.id];
                                    return prev.filter((id) => id !== option.id);
                                  });
                                }}
                              />
                              <span>{option.label}</span>
                            </label>
                          ))}
                          {filteredCaseFilterOptions.length === 0 && (
                            <p className="text-xs text-muted-foreground py-2">No cases match your search.</p>
                          )}
                        </div>
                        <div className="flex justify-between gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedCaseIds([])}
                            disabled={selectedCaseIds.length === 0}
                          >
                            Clear
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedCaseIds(caseFilterOptions.map((c) => c.id))}
                            disabled={caseFilterOptions.length === 0 || selectedCaseIds.length === caseFilterOptions.length}
                          >
                            Select all
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button 
                    variant="outline" 
                    size="lg" 
                    className="border-2 font-bold" 
                    onClick={() => handleExportXlsx('executive_contributions', contributionsData as unknown as Record<string, unknown>[], contributionHeaders)}
                  >
                    <Download className="h-5 w-5 mr-2" /> Export Excel
                  </Button>
                  <Button 
                    variant="outline" 
                    size="lg" 
                    className="border-2 font-bold" 
                    onClick={() => handleExportCsv('executive_contributions', contributionsData as unknown as Record<string, unknown>[], contributionHeaders)}
                  >
                    <FileText className="h-5 w-5 mr-2" /> Export CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
<div className="overflow-x-auto"><Table>
                      <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50 font-bold border-b-2">
                      <TableHead className="font-bold text-black text-lg cursor-pointer" onClick={() => handleSort('id')}>
                        Transaction ID {sortColumn === 'id' && (sortDirection === 'asc' ? <SortAsc className="inline h-4 w-4" /> : <SortDesc className="inline h-4 w-4" />)}
                      </TableHead>
                      <TableHead className="font-bold text-black text-lg cursor-pointer" onClick={() => handleSort('case_number')}>
                        Case {sortColumn === 'case_number' && (sortDirection === 'asc' ? <SortAsc className="inline h-4 w-4" /> : <SortDesc className="inline h-4 w-4" />)}
                      </TableHead>
                      <TableHead className="font-bold text-black text-lg cursor-pointer" onClick={() => handleSort('transaction_type')}>
                        Type {sortColumn === 'transaction_type' && (sortDirection === 'asc' ? <SortAsc className="inline h-4 w-4" /> : <SortDesc className="inline h-4 w-4" />)}
                      </TableHead>
                      <TableHead className="font-bold text-black text-lg cursor-pointer" onClick={() => handleSort('amount')}>
                        Amount (KES) {sortColumn === 'amount' && (sortDirection === 'asc' ? <SortAsc className="inline h-4 w-4" /> : <SortDesc className="inline h-4 w-4" />)}
                      </TableHead>
                      <TableHead className="font-bold text-black text-lg">M-Pesa Ref</TableHead>
                      <TableHead className="font-bold text-black text-lg">Description</TableHead>
                      <TableHead className="font-bold text-black text-lg cursor-pointer" onClick={() => handleSort('created_at')}>
                        Date {sortColumn === 'created_at' && (sortDirection === 'asc' ? <SortAsc className="inline h-4 w-4" /> : <SortDesc className="inline h-4 w-4" />)}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      [...Array(5)].map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={7} className="py-6">
                            <Skeleton className="h-6 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : paginatedContributions.total === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No data available
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedContributions.data.map(tx => (
                        <TableRow key={tx.id} className="hover:bg-muted/40 transition-colors">
                          <TableCell className="font-medium text-primary">{String(tx.id).substring(0, 8)}</TableCell>
                          <TableCell className="font-medium">{String(tx.case_number || '-')}</TableCell>
                          <TableCell className="capitalize">{String(tx.transaction_type || '').replace(/_/g, ' ')}</TableCell>
                          <TableCell className={`font-bold ${Number(tx.amount) < 0 ? 'text-destructive' : 'text-primary'}`}>{Number(tx.amount).toLocaleString()}</TableCell>
                          <TableCell className="text-muted-foreground font-mono">{tx.mpesa_reference || '-'}</TableCell>
                          <TableCell className="max-w-xs truncate font-medium">{tx.description}</TableCell>
                          <TableCell className="text-muted-foreground">{format(new Date(tx.created_at), 'MMM dd, yyyy')}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table></div>

                {!loading && renderPagination(paginatedContributions.totalPages)}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="transactions" className="space-y-6">
            <Card className="shadow-lg border-t-4 border-primary/70">
              <CardHeader>
                <CardTitle className="text-xl font-bold">Transactions by Date and Amount</CardTitle>
                <CardDescription>Daily net amount and volume (last 30 days in current filters)</CardDescription>
              </CardHeader>
              <CardContent>
                {transactionsByDateData.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No transaction data available for chart</p>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={transactionsByDateData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => `KES ${Number(value).toLocaleString()}`} />
                      <Tooltip
                        formatter={(value: number, name: string) => {
                          if (name === 'count') return [Number(value).toLocaleString(), 'Transactions'];
                          return [`KES ${Number(value).toLocaleString()}`, 'Net Amount'];
                        }}
                      />
                      <Bar dataKey="amount" fill="#2563eb" radius={[4, 4, 0, 0]} name="amount" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-xl border-t-4 border-primary">
              <CardHeader className="space-y-4 border-b pb-6">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-2xl font-bold">Transaction Details</CardTitle>
                    <CardDescription className="text-base font-medium">Full transaction report with filters and export</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="lg"
                      className="border-2 font-bold"
                      onClick={() => handleExportXlsx('executive_transactions', transactionDetailsData as unknown as Record<string, unknown>[], transactionHeaders)}
                    >
                      <Download className="h-5 w-5 mr-2" /> Export Excel
                    </Button>
                    <Button
                      variant="outline"
                      size="lg"
                      className="border-2 font-bold"
                      onClick={() => handleExportCsv('executive_transactions', transactionDetailsData as unknown as Record<string, unknown>[], transactionHeaders)}
                    >
                      <FileText className="h-5 w-5 mr-2" /> Export CSV
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="relative md:col-span-2">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search by member, transaction, reference..."
                      className="pl-10"
                      value={transactionSearchTerm}
                      onChange={(e) => setTransactionSearchTerm(e.target.value)}
                    />
                  </div>
                  <Select value={transactionTypeFilter} onValueChange={setTransactionTypeFilter}>
                    <SelectTrigger className="border-2 font-medium">
                      <SelectValue placeholder="Filter by type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      {transactionTypeOptions.map((option) => (
                        <SelectItem key={option} value={option} className="capitalize">
                          {option.replace(/_/g, ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={transactionStatusFilter} onValueChange={setTransactionStatusFilter}>
                    <SelectTrigger className="border-2 font-medium">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="unknown">Unknown</SelectItem>
                      {transactionStatusOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
<div className="overflow-x-auto"><Table>
                      <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2">
                      <TableHead className="font-bold text-foreground text-lg cursor-pointer" onClick={() => handleSort('id')}>Transaction ID</TableHead>
                      <TableHead className="font-bold text-foreground text-lg cursor-pointer" onClick={() => handleSort('created_at')}>Date</TableHead>
                      <TableHead className="font-bold text-foreground text-lg">Member</TableHead>
                      <TableHead className="font-bold text-foreground text-lg cursor-pointer" onClick={() => handleSort('transaction_type')}>Type</TableHead>
                      <TableHead className="font-bold text-foreground text-lg cursor-pointer" onClick={() => handleSort('status')}>Status</TableHead>
                      <TableHead className="font-bold text-foreground text-lg cursor-pointer" onClick={() => handleSort('amount')}>Amount (KES)</TableHead>
                      <TableHead className="font-bold text-foreground text-lg">Reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      [...Array(5)].map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={7}>
                            <Skeleton className="h-6 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : paginatedTransactionDetails.total === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No transaction data available
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedTransactionDetails.data.map((tx) => (
                        <TableRow key={String(tx.id)} className="hover:bg-muted/40 transition-colors">
                          <TableCell className="font-medium text-primary">{String(tx.id).substring(0, 8)}</TableCell>
                          <TableCell className="text-muted-foreground">{format(new Date(String(tx.created_at)), 'MMM dd, yyyy HH:mm')}</TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{String(tx.memberName || '-')}</span>
                              <span className="text-xs text-muted-foreground">{String(tx.memberNumber || '-')}</span>
                            </div>
                          </TableCell>
                          <TableCell className="capitalize">{String(tx.transaction_type || '').replace(/_/g, ' ')}</TableCell>
                          <TableCell>
                            <Badge variant={String(tx.status).toLowerCase() === 'success' ? 'default' : 'secondary'}>
                              {String(tx.status || 'unknown')}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-bold">{Number(tx.amount || 0).toLocaleString()}</TableCell>
                          <TableCell className="font-mono text-muted-foreground">{String(tx.mpesa_reference || '-')}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table></div>

                {!loading && renderPagination(paginatedTransactionDetails.totalPages)}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="defaulters" className="space-y-6">
            <DefaulterAnalyticsChart 
              byLocation={defaulterByLocation}
              totalDefaulters={defaulters.length}
              totalAmountOwed={defaulters.reduce((sum, d) => sum + Math.abs(d.walletBalance), 0)}
              title="Defaulters Analytics"
              description="Analysis of members with negative wallet balances"
            />

            <Card className="shadow-xl border-t-4 border-primary">
              <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b pb-6">
                <div>
                  <CardTitle className="text-2xl font-bold flex items-center text-foreground">
                    Defaulters List
                    <span className="ml-3 px-3 py-1 bg-muted text-foreground rounded-full text-sm font-black">{defaulters.length} Total</span>
                  </CardTitle>
                  <CardDescription className="text-base font-medium">Members with negative wallet balances</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline"
                    size="lg" 
                    className="font-black shadow-lg"
                    onClick={() => handleExportXlsx('executive_defaulters', defaulters as unknown as Record<string, unknown>[], defaulterHeaders)}
                  >
                    <Download className="h-5 w-5 mr-2" /> Download Excel
                  </Button>
                  <Button 
                    variant="outline" 
                    size="lg" 
                    className="border-2 font-bold" 
                    onClick={() => handleExportCsv('executive_defaulters', defaulters as unknown as Record<string, unknown>[], defaulterHeaders)}
                  >
                    <FileText className="h-5 w-5 mr-2" /> Export CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
<div className="overflow-x-auto"><Table>
                      <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2">
                      <TableHead className="font-bold text-foreground text-lg cursor-pointer" onClick={() => handleSort('memberNumber')}>
                        Member # {sortColumn === 'memberNumber' && (sortDirection === 'asc' ? <SortAsc className="inline h-4 w-4" /> : <SortDesc className="inline h-4 w-4" />)}
                      </TableHead>
                      <TableHead className="font-bold text-foreground text-lg cursor-pointer" onClick={() => handleSort('name')}>
                        Name {sortColumn === 'name' && (sortDirection === 'asc' ? <SortAsc className="inline h-4 w-4" /> : <SortDesc className="inline h-4 w-4" />)}
                      </TableHead>
                      <TableHead className="font-bold text-foreground text-lg cursor-pointer" onClick={() => handleSort('walletBalance')}>
                        Balance (KES) {sortColumn === 'walletBalance' && (sortDirection === 'asc' ? <SortAsc className="inline h-4 w-4" /> : <SortDesc className="inline h-4 w-4" />)}
                      </TableHead>
                      <TableHead className="font-bold text-foreground text-lg">Phone</TableHead>
                      <TableHead className="font-bold text-foreground text-lg cursor-pointer" onClick={() => handleSort('residence')}>
                        Residence {sortColumn === 'residence' && (sortDirection === 'asc' ? <SortAsc className="inline h-4 w-4" /> : <SortDesc className="inline h-4 w-4" />)}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedDefaulters.total === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No data available
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedDefaulters.data.map(m => (
                        <TableRow key={String(m.id)} className="hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => navigate(`/members/${String(m.id)}`)}>
                          <TableCell className="font-black text-primary">{String(m.memberNumber || '')}</TableCell>
                          <TableCell className="font-bold text-gray-900">{String(m.name || '')}</TableCell>
                          <TableCell className="text-destructive font-extrabold text-lg">{Number(m.walletBalance || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-muted-foreground font-medium">{String(m.phoneNumber || '')}</TableCell>
                          <TableCell className="font-medium text-gray-700">{String(m.residence || '')}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table></div>

                {renderPagination(paginatedDefaulters.totalPages)}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="members" className="space-y-6">
            <MemberDemographicsChart 
              genderDistribution={genderDistribution}
              residenceDistribution={residenceDistribution}
              statusDistribution={statusDistribution}
              title="Member Demographics"
              description="Distribution of members by various attributes"
            />

            <Card className="shadow-xl border-t-4 border-black">
              <CardHeader className="flex flex-row items-center justify-between border-b pb-6">
                <CardTitle className="text-2xl font-bold">General Member List</CardTitle>
                <div className="flex gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search members..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 w-full sm:w-[250px]"
                    />
                  </div>
                  <Button 
                    variant="outline" 
                    className="border-2 font-bold" 
                    onClick={() => handleExportXlsx('executive_members', memberReportData as unknown as Record<string, unknown>[], memberHeaders)}
                  >
                    <Download className="h-5 w-5 mr-2" /> Export Excel
                  </Button>
                  <Button 
                    variant="outline" 
                    className="border-2 font-bold" 
                    onClick={() => handleExportCsv('executive_members', memberReportData as unknown as Record<string, unknown>[], memberHeaders)}
                  >
                    <FileText className="h-5 w-5 mr-2" /> Export CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
<div className="overflow-x-auto"><Table>
                      <TableHeader>
                    <TableRow className="border-b-2 bg-muted/50 hover:bg-muted/50">
                      <TableHead className="font-bold text-black text-lg cursor-pointer" onClick={() => handleSort('memberNumber')}>
                        Member # {sortColumn === 'memberNumber' && (sortDirection === 'asc' ? <SortAsc className="inline h-4 w-4" /> : <SortDesc className="inline h-4 w-4" />)}
                      </TableHead>
                      <TableHead className="font-bold text-black text-lg cursor-pointer" onClick={() => handleSort('name')}>
                        Name {sortColumn === 'name' && (sortDirection === 'asc' ? <SortAsc className="inline h-4 w-4" /> : <SortDesc className="inline h-4 w-4" />)}
                      </TableHead>
                      <TableHead className="font-bold text-black text-lg cursor-pointer" onClick={() => handleSort('walletBalance')}>
                        Balance {sortColumn === 'walletBalance' && (sortDirection === 'asc' ? <SortAsc className="inline h-4 w-4" /> : <SortDesc className="inline h-4 w-4" />)}
                      </TableHead>
                      <TableHead className="font-bold text-black text-lg">Status</TableHead>
                      <TableHead className="font-bold text-black text-lg cursor-pointer" onClick={() => handleSort('totalContributions')}>
                        Total Contributed {sortColumn === 'totalContributions' && (sortDirection === 'asc' ? <SortAsc className="inline h-4 w-4" /> : <SortDesc className="inline h-4 w-4" />)}
                      </TableHead>
                      <TableHead className="font-bold text-black text-lg cursor-pointer" onClick={() => handleSort('transactionCount')}>
                        Transactions {sortColumn === 'transactionCount' && (sortDirection === 'asc' ? <SortAsc className="inline h-4 w-4" /> : <SortDesc className="inline h-4 w-4" />)}
                      </TableHead>
                      <TableHead className="font-bold text-black text-lg">Last Contribution</TableHead>
                      <TableHead className="font-bold text-black text-lg cursor-pointer" onClick={() => handleSort('residence')}>
                        Residence {sortColumn === 'residence' && (sortDirection === 'asc' ? <SortAsc className="inline h-4 w-4" /> : <SortDesc className="inline h-4 w-4" />)}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedMembers.total === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          No data available
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedMembers.data.map(m => (
                        <TableRow key={String(m.id)} className="hover:bg-muted/40 transition-colors">
                          <TableCell className="font-bold">{String(m.memberNumber || '')}</TableCell>
                          <TableCell className="font-medium">{String(m.name || '')}</TableCell>
                          <TableCell className={Number(m.walletBalance || 0) < 0 ? 'text-destructive font-bold' : 'text-primary font-bold'}>
                            {Number(m.walletBalance || 0).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="capitalize bg-muted text-foreground hover:bg-muted">
                              {String(m.status || (m.isActive ? 'active' : 'inactive')).replace(/_/g, ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-semibold">{Number(m.totalContributions || 0).toLocaleString()}</TableCell>
                          <TableCell>{Number(m.transactionCount || 0).toLocaleString()}</TableCell>
                          <TableCell>{String(m.lastContributionDateDisplay || '-')}</TableCell>
                          <TableCell>{String(m.residence || '')}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table></div>

                {renderPagination(paginatedMembers.totalPages)}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="discipline" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Auto-Inactive Total</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold">{Number(disciplineReport?.metrics?.auto_inactive_total || 0).toLocaleString()}</div></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Reinstatements</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold">{Number(disciplineReport?.metrics?.reinstatement_total || 0).toLocaleString()}</div></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Reinstatement Penalties</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold">KES {Number(disciplineReport?.metrics?.reinstatement_penalty_total || 0).toLocaleString()}</div></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Inactive Members</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold">{Number(disciplineReport?.metrics?.inactive_count || 0).toLocaleString()}</div></CardContent>
              </Card>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Streak 0 Members</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold">{Number(disciplineReport?.default_outcomes?.streak_0 || 0).toLocaleString()}</div></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Streak 1 Members</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold">{Number(disciplineReport?.default_outcomes?.streak_1 || 0).toLocaleString()}</div></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Streak 2+ Members</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold">{Number(disciplineReport?.default_outcomes?.streak_ge_2 || 0).toLocaleString()}</div></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Tracked Members</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold">{Number(disciplineReport?.default_outcomes?.members_tracked || 0).toLocaleString()}</div></CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Status Distribution (Rule-Aware)</CardTitle>
                <CardDescription>Directly sourced from discipline reporting API.</CardDescription>
              </CardHeader>
              <CardContent>
                {disciplineStatusDistributionData.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No status distribution data available.</p>
                ) : (
                  <div className="overflow-x-auto"><Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Members</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {disciplineStatusDistributionData.map((row) => (
                        <TableRow key={row.status}>
                          <TableCell className="capitalize">{row.status.replace(/_/g, ' ')}</TableCell>
                          <TableCell className="text-right font-semibold">{row.count.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Daily Reconciliation Widget</CardTitle>
                <CardDescription>
                  Finance cross-check for last {disciplineAccountReconciliation.days} day(s): account ledger totals vs discipline-rule metrics.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-md border p-4 space-y-2">
                    <div className="font-semibold">Late-Payment Ledger vs Late-Payment Metric</div>
                    <div className="text-sm text-muted-foreground">
                      Ledger late payments: {disciplineAccountReconciliation.arrearsLedgerCount.toLocaleString()} tx, KES {disciplineAccountReconciliation.arrearsLedgerTotal.toLocaleString()}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Late payments metric: {disciplineAccountReconciliation.lateCount.toLocaleString()} tx, KES {disciplineAccountReconciliation.lateTotal.toLocaleString()}
                    </div>
                    <div className={`text-sm font-medium ${disciplineAccountReconciliation.arrearsCountDiff === 0 ? 'text-green-700' : 'text-amber-700'}`}>
                      Count delta: {disciplineAccountReconciliation.arrearsCountDiff.toLocaleString()}
                    </div>
                    <div className={`text-sm font-medium ${Math.abs(disciplineAccountReconciliation.arrearsTotalDiff) < 0.0001 ? 'text-green-700' : 'text-amber-700'}`}>
                      Amount delta: KES {disciplineAccountReconciliation.arrearsTotalDiff.toLocaleString()}
                    </div>
                  </div>

                  <div className="rounded-md border p-4 space-y-2">
                    <div className="font-semibold">Penalty Account vs Reinstatements</div>
                    <div className="text-sm text-muted-foreground">
                      Ledger penalty: {disciplineAccountReconciliation.penaltyLedgerCount.toLocaleString()} tx, KES {disciplineAccountReconciliation.penaltyLedgerTotal.toLocaleString()}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Reinstatement metric: {disciplineAccountReconciliation.reinstatementCount.toLocaleString()} events, KES {disciplineAccountReconciliation.reinstatementPenaltyTotal.toLocaleString()}
                    </div>
                    <div className={`text-sm font-medium ${disciplineAccountReconciliation.penaltyCountDiff === 0 ? 'text-green-700' : 'text-amber-700'}`}>
                      Count delta: {disciplineAccountReconciliation.penaltyCountDiff.toLocaleString()}
                    </div>
                    <div className={`text-sm font-medium ${Math.abs(disciplineAccountReconciliation.penaltyTotalDiff) < 0.0001 ? 'text-green-700' : 'text-amber-700'}`}>
                      Amount delta: KES {disciplineAccountReconciliation.penaltyTotalDiff.toLocaleString()}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Late Payments</CardTitle>
                  <CardDescription>Closed-case settlements collected after close (late payments, incl. legacy arrears).</CardDescription>
                  {disciplineReport?.late_payment_scope?.sample_truncated && (
                    <p className="mt-1 text-xs text-amber-700">
                      Showing latest {disciplineReport.late_payment_scope.sampled_row_count.toLocaleString()} of {disciplineReport.late_payment_scope.full_row_count.toLocaleString()} rows.
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleExportXlsx('discipline_late_payments', (disciplineReport?.late_payments || []) as unknown as Record<string, unknown>[], disciplineLatePaymentHeaders)}>
                    <Download className="h-4 w-4 mr-2" />Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleExportCsv('discipline_late_payments', (disciplineReport?.late_payments || []) as unknown as Record<string, unknown>[], disciplineLatePaymentHeaders)}>
                    <FileText className="h-4 w-4 mr-2" />CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
<div className="overflow-x-auto"><Table>
                      <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Member</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Case</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(disciplineReport?.late_payments || []).length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No late payments found.</TableCell></TableRow>
                    ) : (
                      (disciplineReport?.late_payments || []).slice(0, 300).map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{format(new Date(row.created_at), 'MMM dd, yyyy HH:mm')}</TableCell>
                          <TableCell>#{row.member_number || '-'} {row.member_name || '-'}</TableCell>
                          <TableCell className="capitalize">{String(row.member_status || '-').replace(/_/g, ' ')}</TableCell>
                          <TableCell>{row.case_number || '-'}</TableCell>
                          <TableCell className="text-right font-semibold">KES {Number(row.amount || 0).toLocaleString()}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Consecutive Default Outcomes</CardTitle>
                  <CardDescription>Current streak counters derived from finalized-case evaluations.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleExportXlsx('discipline_default_streaks', (disciplineReport?.default_streaks || []) as unknown as Record<string, unknown>[], disciplineDefaultStreakHeaders)}>
                    <Download className="h-4 w-4 mr-2" />Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleExportCsv('discipline_default_streaks', (disciplineReport?.default_streaks || []) as unknown as Record<string, unknown>[], disciplineDefaultStreakHeaders)}>
                    <FileText className="h-4 w-4 mr-2" />CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
<div className="overflow-x-auto"><Table>
                      <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Consecutive Defaults</TableHead>
                      <TableHead>Last Finalized Case Default</TableHead>
                      <TableHead>Last Evaluated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(disciplineReport?.default_streaks || []).length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No default streak records found.</TableCell></TableRow>
                    ) : (
                      (disciplineReport?.default_streaks || []).slice(0, 300).map((row) => (
                        <TableRow key={row.member_id}>
                          <TableCell>#{row.member_number || '-'} {row.member_name || '-'}</TableCell>
                          <TableCell className="capitalize">{String(row.member_status || '-').replace(/_/g, ' ')}</TableCell>
                          <TableCell className="text-right font-semibold">{Number(row.current_streak || 0).toLocaleString()}</TableCell>
                          <TableCell>{row.last_defaulted ? 'Yes' : 'No'}</TableCell>
                          <TableCell>{format(new Date(row.updated_at), 'MMM dd, yyyy HH:mm')}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Status Transition Audit</CardTitle>
                  <CardDescription>Recent transition events used for discipline reporting and audits.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleExportXlsx('discipline_transitions', (disciplineReport?.transitions || []) as unknown as Record<string, unknown>[], disciplineTransitionHeaders)}>
                    <Download className="h-4 w-4 mr-2" />Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleExportCsv('discipline_transitions', (disciplineReport?.transitions || []) as unknown as Record<string, unknown>[], disciplineTransitionHeaders)}>
                    <FileText className="h-4 w-4 mr-2" />CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
<div className="overflow-x-auto"><Table>
                      <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Member</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(disciplineReport?.transitions || []).length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No transitions found.</TableCell></TableRow>
                    ) : (
                      (disciplineReport?.transitions || []).slice(0, 120).map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{format(new Date(row.created_at), 'MMM dd, yyyy HH:mm')}</TableCell>
                          <TableCell>#{row.member_number || '-'} {row.member_name || '-'}</TableCell>
                          <TableCell className="capitalize">{(row.from_status || '-').replace(/_/g, ' ')}</TableCell>
                          <TableCell className="capitalize font-semibold">{(row.to_status || '-').replace(/_/g, ' ')}</TableCell>
                          <TableCell>{(row.reason || '').replace(/_/g, ' ')}</TableCell>
                          <TableCell>{row.performed_by_role || '-'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Reinstatement Timeline</CardTitle>
                  <CardDescription>Reinstatement events with pre-check obligations snapshot.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleExportXlsx('discipline_reinstatements', (disciplineReport?.reinstatements || []) as unknown as Record<string, unknown>[], disciplineReinstatementHeaders)}>
                    <Download className="h-4 w-4 mr-2" />Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleExportCsv('discipline_reinstatements', (disciplineReport?.reinstatements || []) as unknown as Record<string, unknown>[], disciplineReinstatementHeaders)}>
                    <FileText className="h-4 w-4 mr-2" />CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
<div className="overflow-x-auto"><Table>
                      <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Member</TableHead>
                      <TableHead>Unpaid Cases at Check</TableHead>
                      <TableHead>Unpaid Total at Check</TableHead>
                      <TableHead>Probation End</TableHead>
                      <TableHead>Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(disciplineReport?.reinstatements || []).length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No reinstatement events found.</TableCell></TableRow>
                    ) : (
                      (disciplineReport?.reinstatements || []).slice(0, 120).map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{format(new Date(row.created_at), 'MMM dd, yyyy HH:mm')}</TableCell>
                          <TableCell>#{row.member_number || '-'} {row.member_name || '-'}</TableCell>
                          <TableCell>{Number(row.unpaid_case_count_at_check || 0).toLocaleString()}</TableCell>
                          <TableCell>KES {Number(row.unpaid_total_at_check || 0).toLocaleString()}</TableCell>
                          <TableCell>{row.probation_end_date}</TableCell>
                          <TableCell>{row.performed_by_role || '-'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Unpaid Obligation Reconciliation</CardTitle>
                  <CardDescription>Members with unpaid active/closed-case obligations.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleExportXlsx('discipline_unpaid_obligations', (disciplineReport?.unpaid_obligations || []) as unknown as Record<string, unknown>[], disciplineUnpaidHeaders)}>
                    <Download className="h-4 w-4 mr-2" />Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleExportCsv('discipline_unpaid_obligations', (disciplineReport?.unpaid_obligations || []) as unknown as Record<string, unknown>[], disciplineUnpaidHeaders)}>
                    <FileText className="h-4 w-4 mr-2" />CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
<div className="overflow-x-auto"><Table>
                      <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Unpaid Cases</TableHead>
                      <TableHead>Unpaid Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(disciplineReport?.unpaid_obligations || []).length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No unpaid obligations found.</TableCell></TableRow>
                    ) : (
                      (disciplineReport?.unpaid_obligations || []).slice(0, 200).map((row) => (
                        <TableRow key={row.member_id}>
                          <TableCell>#{row.member_number} {row.name}</TableCell>
                          <TableCell className="capitalize">{String(row.status || '').replace(/_/g, ' ')}</TableCell>
                          <TableCell>{Number(row.unpaid_case_count || 0).toLocaleString()}</TableCell>
                          <TableCell className="font-semibold">KES {Number(row.unpaid_total || 0).toLocaleString()}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table></div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Reports;
