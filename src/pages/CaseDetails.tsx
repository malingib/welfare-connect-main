import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from '@/components/ui/use-toast';
import { ChevronLeft, Edit, User, Calendar, DollarSign, CheckCircle, TimerOff, Clock, ArrowRight, RotateCcw, FileSpreadsheet, FileText } from 'lucide-react';
import DashboardLayout from '@/layouts/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Case, CaseType } from '@/lib/types';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { DbCase, DbMember, mapDbCaseToCase } from '@/lib/db-types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Database } from '@/integrations/supabase/types';
import { persistentCache } from '@/lib/cache';
import { auditStamp, buildSupabaseFunctionUrl, getAppToken } from '@/lib/appAuth';
import { createReportFilename, exportRowsToCSV, exportRowsToXLSX } from '@/lib/reportExport';
import { CASE_ROW_COLUMNS, MEMBER_DETAIL_COLUMNS } from '@/lib/supabaseSelectColumns';

type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type MemberUpdate = Database["public"]["Tables"]["members"]["Update"];

type CaseContributionTransactionRow = {
  id: string;
  member_id: string | null;
  amount: number | null;
  created_at: string;
  transaction_type: string | null;
  status?: string | null;
  members?: {
    name?: string | null;
    member_number?: string | null;
  } | {
    name?: string | null;
    member_number?: string | null;
  }[] | null;
};

type CaseContributionActivity = {
  memberId: string;
  memberName: string;
  memberNumber: string;
  grossContributed: number;
  refunded: number;
  netContributed: number;
  lastActivity: string | null;
};

type CasePaymentComplianceRow = {
  case_id: string;
  case_number: string;
  member_id: string;
  member_number: string;
  member_name: string;
  member_status: string;
  phone_number?: string | null;
  expected_amount: number | string | null;
  gross_paid: number | string | null;
  total_refunded: number | string | null;
  net_paid: number | string | null;
  outstanding_amount: number | string | null;
  reinstatement_penalty_due: number | string | null;
  total_due: number | string | null;
  payment_compliance: 'paid' | 'partial' | 'unpaid';
};

const PAGE_SIZE = 1000;
const WALLET_BALANCE_EPSILON = 0.009;

const buildCaseDescriptionPatterns = (caseNumber: string) => {
  const patterns = new Set<string>();
  const trimmed = String(caseNumber || '').trim();
  const isNumericOnly = /^\d+$/.test(trimmed);

  if (trimmed) {
    patterns.add(trimmed);
    patterns.add(`Case #${trimmed}`);
    patterns.add(`Case ${trimmed}`);
  }

  const digitsRaw = trimmed.replace(/\D/g, '');
  const parsedDigits = digitsRaw ? parseInt(digitsRaw, 10) : NaN;
  const digits = !isNaN(parsedDigits) && parsedDigits > 0 ? String(parsedDigits) : '';

  if (digits && (!trimmed || digits !== trimmed || isNumericOnly)) {
    patterns.add(`Case ${digits}`);
    patterns.add(`Case #${digits}`);
  }

  return Array.from(patterns);
};

const buildCaseDescriptionOrFilter = (caseNumber: string) => {
  const patterns = buildCaseDescriptionPatterns(caseNumber);
  const clauses: string[] = [];
  for (const pattern of patterns) {
    clauses.push(`description.ilike.%${pattern}%`);
  }
  return clauses.join(',');
};

const invalidateCaseCaches = () => {
  persistentCache.invalidate('cases-list');
  persistentCache.invalidate('cases-mpesa-v2');
  persistentCache.invalidate('members-list');
};

const resolveMemberRecord = (members: CaseContributionTransactionRow['members']) => {
  if (Array.isArray(members)) {
    return members[0] || null;
  }
  return members || null;
};

const fetchCaseContributionTransactions = async (caseId: string, caseNumber: string) => {
  const fetchPaged = async (applyFilter: (query: any) => any) => {
    const rows: CaseContributionTransactionRow[] = [];
    let from = 0;

    while (true) {
      const baseQuery = (supabase as any)
        .from('transactions')
        .select(`
          id,
          member_id,
          amount,
          created_at,
          transaction_type,
          status,
          members (
            name,
            member_number
          )
        `)
        .in('transaction_type', [
          'contribution',
          'contribution_refund',
          'case_wallet_deduction',
          'case_wallet_refund',
          'arrears',
          'late_payment',
        ]);
 
      const { data, error } = await applyFilter(baseQuery)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;

      const batch = (data || []) as CaseContributionTransactionRow[];
      rows.push(...batch);

      if (batch.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    return rows;
  };

  // Primary source of truth: transactions explicitly linked to this case.
  const linkedTransactions = await fetchPaged((query) => query.eq('case_id', caseId));
  if (linkedTransactions.length > 0) {
    return linkedTransactions;
  }

  // Legacy fallback for older transactions that were stored without case_id.
  const descriptionFilter = buildCaseDescriptionOrFilter(caseNumber);
  if (!descriptionFilter) return [];
  return fetchPaged((query) => query.or(descriptionFilter));
};

const calculateContributionTotals = (transactions: CaseContributionTransactionRow[]) => {
  let totalContributions = 0;
  let totalRefunds = 0;

  for (const tx of transactions) {
    if (tx.status && tx.status !== 'completed') continue;
    const amount = Number(tx.amount) || 0;
    const type = String(tx.transaction_type || '').toLowerCase();

    if (type === 'contribution' || type === 'case_wallet_deduction' || type === 'arrears' || type === 'late_payment') {
      totalContributions += Math.abs(amount);
      continue;
    }

    if (type === 'contribution_refund' || type === 'case_wallet_refund') {
      if (amount > 0) {
        totalRefunds += amount;
      } else {
        totalContributions += amount;
      }
    }
  }

  return { totalContributions, totalRefunds };
};

const buildContributionActivity = (transactions: CaseContributionTransactionRow[]) => {
  const activityByMember = new Map<string, CaseContributionActivity>();

  for (const tx of transactions) {
    if (!tx.member_id) continue;
    if (tx.status && tx.status !== 'completed') continue;

    const member = resolveMemberRecord(tx.members);
    const existing = activityByMember.get(tx.member_id) || {
      memberId: tx.member_id,
      memberName: member?.name || 'Unknown',
      memberNumber: member?.member_number || '',
      grossContributed: 0,
      refunded: 0,
      netContributed: 0,
      lastActivity: tx.created_at,
    };

    const amount = Number(tx.amount) || 0;
    if (tx.transaction_type === 'contribution' || tx.transaction_type === 'case_wallet_deduction' || tx.transaction_type === 'arrears' || tx.transaction_type === 'late_payment') {
      existing.grossContributed += Math.abs(amount);
    }

    if (tx.transaction_type === 'contribution_refund' || tx.transaction_type === 'case_wallet_refund') {
      // Refunds can be positive (refund amount) or negative (deduction)
      if (amount >= 0) {
        // Positive amount adds to refunded total
        existing.refunded += amount;
      } else {
        // Negative amount is a deduction - subtract from grossContributed
        existing.grossContributed += amount; // Adding negative reduces gross
      }
    }

    if (!existing.lastActivity || new Date(tx.created_at) > new Date(existing.lastActivity)) {
      existing.lastActivity = tx.created_at;
    }

    existing.netContributed = existing.grossContributed - existing.refunded;
    activityByMember.set(tx.member_id, existing);
  }

  return Array.from(activityByMember.values()).sort((a, b) => a.memberName.localeCompare(b.memberName));
};

const recalculateMemberWalletBalances = async (memberIds: string[]) => {
  // Note: Database trigger automatically updates wallet_balances when transactions are inserted
  // This function is kept for potential future use but no longer needed after trigger deployment
  console.log('Wallet balances will be auto-updated by database trigger for members:', memberIds);
};

const syncCaseActualAmount = async (caseId: string, caseNumber: string) => {
  const transactions = await fetchCaseContributionTransactions(caseId, caseNumber);
  const { totalContributions, totalRefunds } = calculateContributionTotals(transactions);
  const netCollected = Math.max(0, totalContributions - totalRefunds);

  const { error } = await (supabase as any)
    .from('cases')
    .update({ actual_amount: netCollected })
    .eq('id', caseId);

  if (error) throw error;

  return netCollected;
};

const fetchCasePageData = async (caseId: string) => {
  const { data: caseData, error: caseError } = await supabase
    .from('cases')
    .select(CASE_ROW_COLUMNS)
    .eq('id', caseId)
    .maybeSingle();

  if (caseError) throw caseError;
  if (!caseData) throw new Error('Case not found');

  const dbCase = caseData as DbCase;

  const { data: memberData, error: memberError } = await supabase
    .from('members')
    .select(MEMBER_DETAIL_COLUMNS)
    .eq('id', dbCase.affected_member_id)
    .maybeSingle();

  if (memberError) throw memberError;

  const mappedCase = mapDbCaseToCase(dbCase, memberData as DbMember);
  const transactions = await fetchCaseContributionTransactions(caseId, mappedCase.caseNumber);
  const { totalContributions, totalRefunds } = calculateContributionTotals(transactions);

  const { count: memberCount, error: membersError } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .in('status', ['active', 'probation']);

  if (membersError) throw membersError;

  const collectedAmount = Math.max(0, totalContributions - totalRefunds);

  // Sync the cached actual_amount to keep it fresh for MemberCases.tsx etc.
  syncCaseActualAmount(caseId, mappedCase.caseNumber).catch(() => {});

  return {
    mappedCase,
    memberCount: memberCount || 0,
    collectedAmount,
    contributionPerMember: Number(dbCase.contribution_per_member) || 0,
  };
};

// Contributions Tab Component
function ContributionsTab({ caseId, caseNumber, contributionPerMember, refreshKey }: {
  caseId: string;
  caseNumber: string;
  contributionPerMember: number;
  refreshKey: number;
}) {
  const [contributions, setContributions] = useState<CasePaymentComplianceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'partial' | 'unpaid'>('all');

  const rows = contributions.map((row) => ({
    ...row,
    expectedAmount: Number(row.expected_amount) || 0,
    grossPaid: Number(row.gross_paid) || 0,
    refunded: Number(row.total_refunded) || 0,
    netPaid: Number(row.net_paid) || 0,
    outstanding: Number(row.outstanding_amount) || 0,
    penaltyDue: Number(row.reinstatement_penalty_due) || 0,
    totalDue: Number(row.total_due) || 0,
  }));
  const eligibleRows = rows.filter((row) => row.member_status === 'active' || row.member_status === 'probation');
  const visibleRows = statusFilter === 'all' ? eligibleRows : eligibleRows.filter((row) => row.payment_compliance === statusFilter);
  const countFor = (status: 'paid' | 'partial' | 'unpaid') => eligibleRows.filter((row) => row.payment_compliance === status).length;
  const isUnpaidExport = statusFilter === 'unpaid';
  const exportHeaders = isUnpaidExport
    ? [
        { key: 'memberNumber', label: 'Member Number' },
        { key: 'memberName', label: 'Member Name' },
        { key: 'expectedKes', label: 'Expected (KES)' },
        { key: 'phoneNumber', label: 'Phone' },
        { key: 'paymentStatus', label: 'Payment Status' },
      ]
    : [
        { key: 'memberNumber', label: 'Member Number' },
        { key: 'memberName', label: 'Member Name' },
        { key: 'memberStatus', label: 'Member Status' },
        { key: 'expectedKes', label: 'Expected (KES)' },
        { key: 'grossPaidKes', label: 'Gross Paid (KES)' },
        { key: 'refundedKes', label: 'Refunded (KES)' },
        { key: 'netPaidKes', label: 'Net Paid (KES)' },
        { key: 'outstandingKes', label: 'Outstanding Case Balance (KES)' },
        { key: 'penaltyDueKes', label: 'Reinstatement Penalty Due (KES)' },
        { key: 'totalDueKes', label: 'Total Due (KES)' },
        { key: 'paymentStatus', label: 'Payment Status' },
      ];
  const exportRows = () =>
    visibleRows.map((row) =>
      isUnpaidExport
        ? {
            memberNumber: row.member_number || '',
            memberName: row.member_name,
            expectedKes: Number(row.expectedAmount.toFixed(2)),
            phoneNumber: row.phone_number ? String(row.phone_number) : '',
            paymentStatus: row.payment_compliance,
          }
        : {
            memberNumber: row.member_number || '',
            memberName: row.member_name,
            memberStatus: row.member_status,
            expectedKes: Number(row.expectedAmount.toFixed(2)),
            grossPaidKes: Number(row.grossPaid.toFixed(2)),
            refundedKes: Number(row.refunded.toFixed(2)),
            netPaidKes: Number(row.netPaid.toFixed(2)),
            outstandingKes: Number(row.outstanding.toFixed(2)),
            penaltyDueKes: Number(row.penaltyDue.toFixed(2)),
            totalDueKes: Number(row.totalDue.toFixed(2)),
            paymentStatus: row.payment_compliance,
          },
    );
  const ensureExportRows = () => {
    if (visibleRows.length > 0) return true;
    toast({ title: 'No data to export', description: `${statusFilter === 'all' ? 'No eligible members' : `No members with status "${statusFilter}"`} for this case.`, variant: 'destructive' });
    return false;
  };
  const handleExportXlsx = async () => {
    if (!ensureExportRows()) return;
    const suffix = statusFilter === 'all' ? 'payment_status' : `payment_status_${statusFilter}`;
    await exportRowsToXLSX(createReportFilename(`case_${caseNumber}_${suffix}`, 'xlsx'), exportRows(), exportHeaders);
    toast({ title: 'Export complete', description: `Exported ${visibleRows.length} member payment statuses.` });
  };
  const handleExportCsv = () => {
    if (!ensureExportRows()) return;
    const suffix = statusFilter === 'all' ? 'payment_status' : `payment_status_${statusFilter}`;
    exportRowsToCSV(createReportFilename(`case_${caseNumber}_${suffix}`, 'csv'), exportRows(), exportHeaders);
    toast({ title: 'Export complete', description: `Exported ${visibleRows.length} member payment statuses.` });
  };

  useEffect(() => {
    const loadContributions = async () => {
      try {
        setLoading(true);
        const { data, error } = await (supabase as any).rpc('get_case_payment_compliance_rows_for_case', { p_case_id: caseId });
        if (error) throw error;
        let rows = (data || []) as CasePaymentComplianceRow[];
        // Fallback: if RPC hasn't been migrated yet and phone_number is missing, fetch it via members table
        const needsPhone = rows.length > 0 && rows.every((r) => r.phone_number === undefined);
        if (needsPhone) {
          const ids = Array.from(new Set(rows.map((r) => r.member_id).filter(Boolean)));
          const chunk = 120;
          const phoneById: Record<string, string> = {};
          for (let i = 0; i < ids.length; i += chunk) {
            const slice = ids.slice(i, i + chunk);
            const { data: memberRows } = await supabase.from('members').select('id, phone_number').in('id', slice);
            for (const mr of (memberRows || []) as { id: string; phone_number: string | null }[]) {
              if (mr.id) phoneById[mr.id] = mr.phone_number || '';
            }
          }
          rows = rows.map((r) => ({ ...r, phone_number: phoneById[r.member_id] || null }));
        }
        setContributions(rows);
      } catch (error) {
        console.error('Error loading case payment status:', error);
        toast({ title: 'Could not load payment status', description: 'Please refresh and try again.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    void loadContributions();
  }, [caseId, refreshKey]);

  if (loading) return <div className="text-center py-8">Loading member payment status...</div>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <p className="font-medium">Member Payment Status</p>
          <p className="text-sm text-muted-foreground">Applicable members, including auto-inactive members with a reinstatement penalty. Expected: KES {contributionPerMember.toLocaleString()} per member.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{eligibleRows.length} of {rows.length} eligible</Badge>
          <Button variant="outline" size="sm" onClick={handleExportXlsx}><FileSpreadsheet className="h-4 w-4 mr-2" />Excel</Button>
          <Button variant="outline" size="sm" onClick={handleExportCsv}><FileText className="h-4 w-4 mr-2" />CSV</Button>
        </div>
      </div>
      <div className="border rounded-md overflow-x-auto">
        <div className="flex flex-wrap gap-2 border-b p-3">
          <Button size="sm" variant={statusFilter === 'all' ? 'default' : 'outline'} onClick={() => setStatusFilter('all')}>All ({eligibleRows.length})</Button>
          <Button size="sm" variant={statusFilter === 'paid' ? 'default' : 'outline'} onClick={() => setStatusFilter('paid')}>Paid ({countFor('paid')})</Button>
          <Button size="sm" variant={statusFilter === 'partial' ? 'default' : 'outline'} onClick={() => setStatusFilter('partial')}>Partial ({countFor('partial')})</Button>
          <Button size="sm" variant={statusFilter === 'unpaid' ? 'default' : 'outline'} onClick={() => setStatusFilter('unpaid')}>Unpaid ({countFor('unpaid')})</Button>
        </div>
        {(() => {
          const isUnpaidView = statusFilter === 'unpaid';
          return (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  {isUnpaidView ? (
                    <>
                      <TableHead>Phone</TableHead>
                      <TableHead>Status</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Refunded</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Case Due</TableHead>
                      <TableHead className="text-right">Penalty Due</TableHead>
                      <TableHead className="text-right">Total Due</TableHead>
                      <TableHead>Status</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isUnpaidView ? 4 : 9} className="text-center text-muted-foreground py-8">
                      No members match this payment status
                    </TableCell>
                  </TableRow>
                ) : isUnpaidView ? (
                  visibleRows.map((row) => (
                    <TableRow key={row.member_id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{row.member_name}</div>
                          <div className="text-xs text-muted-foreground">#{row.member_number || ''} · {row.member_status}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">KES {row.expectedAmount.toLocaleString()}</TableCell>
                      <TableCell className="text-muted-foreground">{row.phone_number ? String(row.phone_number) : '-'}</TableCell>
                      <TableCell>
                        <Badge variant="destructive">Unpaid</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  visibleRows.map((row) => (
                    <TableRow key={row.member_id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{row.member_name}</div>
                          <div className="text-xs text-muted-foreground">#{row.member_number || ''} · {row.member_status}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">KES {row.expectedAmount.toLocaleString()}</TableCell>
                      <TableCell className="text-right">KES {row.grossPaid.toLocaleString()}</TableCell>
                      <TableCell className="text-right">KES {row.refunded.toLocaleString()}</TableCell>
                      <TableCell className="text-right">KES {row.netPaid.toLocaleString()}</TableCell>
                      <TableCell className="text-right">KES {row.outstanding.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{row.penaltyDue > 0 ? `KES ${row.penaltyDue.toLocaleString()}` : '-'}</TableCell>
                      <TableCell className="text-right font-medium">KES {row.totalDue.toLocaleString()}</TableCell>
                      <TableCell>
                        {row.payment_compliance === 'paid' ? (
                          <Badge className="bg-green-600">Paid</Badge>
                        ) : row.payment_compliance === 'partial' ? (
                          <Badge variant="outline">Partial</Badge>
                        ) : (
                          <Badge variant="destructive">Unpaid</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          );
        })()}
      </div>
    </div>
  );
}

function DisbursementsTab({ caseId, refreshKey }: { caseId: string; refreshKey: number }) {
  const [disbursements, setDisbursements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDisbursements = async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('transactions')
          .select(`
            id,
            amount,
            description,
            created_at,
            metadata
          `)
          .eq('case_id', caseId)
          .eq('transaction_type', 'disbursement')
          .order('created_at', { ascending: false })
          .limit(100);

        if (error) throw error;
        setDisbursements(data || []);
      } catch (error) {
        console.error('Error loading disbursements:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDisbursements();
  }, [caseId, refreshKey]);

  if (loading) {
    return <div className="text-center py-8">Loading disbursements...</div>;
  }

  return (
    <div className="border rounded-md overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Date</TableHead>
            <TableHead>Method</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {disbursements.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                No disbursements recorded
              </TableCell>
            </TableRow>
          ) : (
            disbursements.map((tx) => (
              <TableRow key={tx.id}>
                <TableCell>{tx.description || 'Disbursement'}</TableCell>
                <TableCell className="text-right font-medium">
                  KES {(Math.abs(Number(tx.amount)) || 0).toLocaleString()}
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {new Date(tx.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="capitalize">{tx.metadata?.payment_method || 'cash'}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

const CaseDetails = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collectedAmount, setCollectedAmount] = useState<number>(0);
  const [memberCount, setMemberCount] = useState<number>(0);
  const [contributionPerMember, setContributionPerMember] = useState<number>(0);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [disbursementDialogOpen, setDisbursementDialogOpen] = useState(false);
  const [disbursementAmount, setDisbursementAmount] = useState<number>(0);
  const [disbursementMethod, setDisbursementMethod] = useState<string>('cash');
  const [disbursementReference, setDisbursementReference] = useState('');
  const [disbursementDescription, setDisbursementDescription] = useState('');
  const [isDisbursing, setIsDisbursing] = useState(false);
  const [disbursementRefreshKey, setDisbursementRefreshKey] = useState(0);
  const [contributionRefreshKey, setContributionRefreshKey] = useState(0);
  const [revertDialogOpen, setRevertDialogOpen] = useState(false);
  const [contributionAction, setContributionAction] = useState<'revert' | null>(null);

  useEffect(() => {
    const fetchCase = async () => {
      if (!id) {
        setError("Case ID is required");
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        setError(null);
        const pageData = await fetchCasePageData(id);
        setCaseData(pageData.mappedCase);
        setCollectedAmount(pageData.collectedAmount);
        setMemberCount(pageData.memberCount);
        setContributionPerMember(pageData.contributionPerMember);
      } catch (error) {
        console.error('Error fetching case:', error);
        setError(error instanceof Error ? error.message : 'Failed to load case details');
        toast({
          variant: "destructive",
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to load case details.",
        });
      } finally {
        setLoading(false);
      }
    };

    void fetchCase();
  }, [id]);

  const refreshCaseData = async () => {
    if (!id) return;

    const pageData = await fetchCasePageData(id);
    setCaseData(pageData.mappedCase);
    setCollectedAmount(pageData.collectedAmount);
    setMemberCount(pageData.memberCount);
    setContributionPerMember(pageData.contributionPerMember);
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-[calc(100vh-120px)]">
          <p>Loading case details...</p>
        </div>
      </DashboardLayout>
    );
  }

  if (error || !caseData) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)]">
          <h2 className="text-xl font-semibold mb-2">Case not found</h2>
          <p className="text-muted-foreground mb-4">{error || "The requested case could not be found."}</p>
          <Button onClick={() => navigate('/cases')}>
            Go back to cases
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const expectedAmount = caseData ? caseData.expectedAmount : 0;
  const snapshotMemberCount = contributionPerMember > 0 ? Math.round(expectedAmount / contributionPerMember) : 0;
  const currentTarget = memberCount * contributionPerMember;
  const memberGrew = memberCount > snapshotMemberCount;
  const effectiveTarget = memberGrew ? currentTarget : expectedAmount;
  const progress = caseData && effectiveTarget > 0 ? Math.min(100, (collectedAmount / effectiveTarget) * 100) : 0;
  const hasCollectedContributions = collectedAmount > WALLET_BALANCE_EPSILON;
  
  const getCaseTypeColor = (type: CaseType) => {
    switch (type) {
      case CaseType.EDUCATION:
        return 'bg-blue-100 text-blue-800 hover:bg-blue-100';
      case CaseType.SICKNESS:
        return 'bg-amber-100 text-amber-800 hover:bg-amber-100';
      case CaseType.DEATH:
        return 'bg-purple-100 text-purple-800 hover:bg-purple-100';
      default:
        return '';
    }
  };
  
  const getStatusColor = (isActive: boolean, isFinalized: boolean) => {
    if (isFinalized) return 'bg-green-100 text-green-800 hover:bg-green-100';
    if (isActive) return 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100';
    return 'bg-gray-100 text-gray-800 hover:bg-gray-100';
  };
  
  const getStatusText = (isActive: boolean, isFinalized: boolean) => {
    if (isFinalized) return 'Finalized';
    if (isActive) return 'Active';
    return 'Draft';
  };

  const initials = caseData?.affectedMember?.name
    ? caseData.affectedMember.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .substring(0, 2)
    : 'NA';

  const handleFinalizeClick = () => {
    if (!caseData || caseData.isFinalized) return;
    setFinalizeDialogOpen(true);
  };

  const handleFinalizeCase = async () => {
    if (!id || !caseData || caseData.isFinalized) return;
    setFinalizeDialogOpen(false);
    try {
      setIsUpdating(true);
      const { error: updateError } = await (supabase as any)
        .from('cases')
        .update({
          is_finalized: true,
          is_active: false,
          actual_amount: collectedAmount,
        })
        .eq('id', id);

      if (updateError) {
        throw updateError;
      }

      // Update local state immediately
      setCaseData((prev) =>
        prev
          ? {
              ...prev,
              isFinalized: true,
              isActive: false,
              actualAmount: collectedAmount,
            }
          : prev
      );

      toast({
        title: 'Case finalized',
        description: 'The case has been marked as finalized.',
      });
      invalidateCaseCaches();

      // Force refresh after 1 second to ensure database is updated
      setTimeout(async () => {
        const { data: refreshedCase } = await (supabase
          .from('cases')
          .select(CASE_ROW_COLUMNS)
          .eq('id', id)
          .single()) as { data: DbCase | null };
        
        if (refreshedCase) {
          setCaseData((prev) =>
            prev
              ? {
                  ...prev,
                  isFinalized: refreshedCase.is_finalized,
                  isActive: refreshedCase.is_active,
                  actualAmount: refreshedCase.actual_amount,
                }
              : prev
          );
        }
      }, 1000);

    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Failed to finalize case',
        description: e instanceof Error ? e.message : 'Please try again.',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteClick = () => {
    if (!id) return;
    setDeleteDialogOpen(true);
  };

  const handleActivateCase = async () => {
    if (!id || !caseData) return;
    try {
      setIsUpdating(true);
      const { error: updateError } = await (supabase as any)
        .from('cases')
        .update({
          is_active: true,
          is_finalized: false,
        })
        .eq('id', id);

      if (updateError) {
        throw updateError;
      }

      setCaseData((prev) =>
        prev
          ? {
              ...prev,
              isActive: true,
              isFinalized: false,
            }
          : prev
      );

      toast({
        title: 'Case activated',
        description: 'The case is now active and open for contributions.',
      });
      invalidateCaseCaches();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Failed to activate case',
        description: e instanceof Error ? e.message : 'Please try again.',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRevertContributions = async () => {
    if (!id || !caseData) return;

    setRevertDialogOpen(false);
    setContributionAction('revert');

    try {
      const activity = buildContributionActivity(
        await fetchCaseContributionTransactions(id, caseData.caseNumber)
      );

      const rowsToInsert: TransactionInsert[] = activity.reduce<TransactionInsert[]>((rows, memberActivity) => {
        if (memberActivity.netContributed > WALLET_BALANCE_EPSILON) {
          rows.push({
            member_id: memberActivity.memberId,
            case_id: id,
            amount: Number(memberActivity.netContributed.toFixed(2)),
            transaction_type: 'contribution_refund',
            description: `Contribution refund for Case #${caseData.caseNumber} - ${caseData.caseType}`,
            status: 'completed',
            payment_method: 'wallet',
            metadata: {
              source: 'case_revert_contributions',
              case_number: caseData.caseNumber,
              ...auditStamp(),
            },
            created_at: new Date().toISOString(),
          });
        }

        return rows;
      }, []);

      if (rowsToInsert.length === 0) {
        toast({
          title: 'Nothing to revert',
          description: 'There are no deducted case contributions to return.',
        });
        return;
      }

      for (let i = 0; i < rowsToInsert.length; i += PAGE_SIZE) {
        const batch = rowsToInsert.slice(i, i + PAGE_SIZE);
        const { error: insertError } = await (supabase.from('transactions') as any).insert(batch);
        if (insertError) throw insertError;
      }

      await recalculateMemberWalletBalances(
        rowsToInsert
          .map((row) => row.member_id)
          .filter((memberId): memberId is string => Boolean(memberId))
      );

      const nextCollectedAmount = await syncCaseActualAmount(id, caseData.caseNumber);
      setCollectedAmount(nextCollectedAmount);
      setCaseData((prev) => (prev ? { ...prev, actualAmount: nextCollectedAmount } : prev));
      setContributionRefreshKey((prev) => prev + 1);
      invalidateCaseCaches();

      toast({
        title: 'Contributions reverted',
        description: `Returned KES ${rowsToInsert.reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0).toLocaleString()} to ${rowsToInsert.length.toLocaleString()} member wallets.`,
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Failed to revert contributions',
        description: e instanceof Error ? e.message : 'Please try again.',
      });
    } finally {
      setContributionAction(null);
    }
  };

  const handleRecordDisbursement = async () => {
    if (!id || !caseData) return;
    if (!disbursementAmount || disbursementAmount <= 0) {
      toast({
        variant: 'destructive',
        title: 'Invalid amount',
        description: 'Please enter a valid disbursement amount.',
      });
      return;
    }

    if (!caseData.affectedMemberId) {
      toast({
        variant: 'destructive',
        title: 'Missing member',
        description: 'Affected member is required to record a disbursement.',
      });
      return;
    }

    setIsDisbursing(true);
    try {
      const description =
        disbursementDescription.trim() ||
        `Disbursement for Case #${caseData.caseNumber}`;

      const payload = {
        member_id: caseData.affectedMemberId,
        case_id: id,
        transaction_type: 'disbursement',
        amount: Math.abs(Number(disbursementAmount)),
        description,
        reference: disbursementReference || null,
        created_at: new Date().toISOString(),
        metadata: {
          payment_method: disbursementMethod,
        },
      };

      const { error: insertError } = await (supabase as any)
        .from('transactions')
        .insert([payload]);

      if (insertError) throw insertError;

      // Note: Database trigger automatically updates member wallet_balance

      // Initiate M-Pesa B2C payout if method is mpesa
      if (disbursementMethod === 'mpesa' && caseData.affectedMemberId) {
        try {
          const appToken = getAppToken()
          if (!appToken) throw new Error('Session expired. Please login again.')

          const endpoint = buildSupabaseFunctionUrl('mpesa-b2c')

          const b2cResp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-app-token': appToken },
            body: JSON.stringify({
              amount: Math.abs(Number(disbursementAmount)),
              memberId: caseData.affectedMemberId,
              reason: `Disbursement for Case #${caseData.caseNumber}`,
              isReversal: false,
            }),
          })

          const b2cJson = await b2cResp.json().catch(() => ({}))
          if (!b2cResp.ok) {
            const errMsg = String((b2cJson as { error?: unknown }).error || '').trim() || `B2C request failed with status ${b2cResp.status}`
            console.error('M-Pesa B2C payout failed:', errMsg)
            toast({
              variant: 'destructive',
              title: 'M-Pesa payout failed',
              description: 'The disbursement is recorded but the M-Pesa payout could not be sent. You may need to retry.',
            })
          } else {
            toast({
              title: 'M-Pesa payout initiated',
              description: 'The disbursement has been recorded and M-Pesa payment is being processed.',
            })
          }
        } catch (b2cError: any) {
          console.error('M-Pesa B2C payout error:', b2cError)
          toast({
            variant: 'destructive',
            title: 'M-Pesa payout error',
            description: 'The disbursement is recorded but the M-Pesa payout failed. Please retry manually.',
          })
        }
      } else {
        toast({
          title: 'Disbursement recorded',
          description: 'The disbursement has been saved successfully.',
        });
      }

      invalidateCaseCaches();
      await refreshCaseData();
      setDisbursementRefreshKey((prev) => prev + 1);
      setDisbursementDialogOpen(false);
      setDisbursementAmount(0);
      setDisbursementMethod('cash');
      setDisbursementReference('');
      setDisbursementDescription('');
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Failed to record disbursement',
        description: e instanceof Error ? e.message : 'Please try again.',
      });
    } finally {
      setIsDisbursing(false);
    }
  };

  const handleSuspendDeleteCase = async () => {
    if (!id) return;
    setDeleteDialogOpen(false);
    try {
      setIsUpdating(true);
      const { error: deleteError } = await supabase
        .from('cases')
        .delete()
        .eq('id', id);

      if (deleteError) {
        throw deleteError;
      }

      toast({
        title: 'Case deleted',
        description: 'The case has been removed successfully.',
      });

      invalidateCaseCaches();
      navigate('/cases');
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Failed to delete case',
        description: e instanceof Error ? e.message : 'Please try again.',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center">
          <Button variant="ghost" onClick={() => navigate('/cases')} className="mr-4">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back to Cases
          </Button>
          <div>
            <h1 className="text-3xl font-bold mb-1">Case #{caseData.caseNumber}</h1>
            <div className="flex space-x-2">
              <Badge variant="outline" className={getCaseTypeColor(caseData.caseType)}>
                {caseData.caseType}
              </Badge>
              <Badge variant="outline" className={getStatusColor(caseData.isActive, caseData.isFinalized)}>
                {getStatusText(caseData.isActive, caseData.isFinalized)}
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Total Collected</CardTitle>
              <CardDescription>
                {Math.round(progress)}% of target
                {memberGrew && (
                  <span className="ml-2 text-primary font-medium">
                    (+{memberCount - snapshotMemberCount} member{memberCount - snapshotMemberCount !== 1 ? 's' : ''} joined)
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Progress value={progress} className="h-2 mb-2" />
              <div className="flex justify-between text-sm">
                <div>
                  <p className="text-muted-foreground">Collected</p>
                  <p className="font-medium">KES {collectedAmount.toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground">Target</p>
                  <p className="font-medium">KES {effectiveTarget.toLocaleString()}</p>
                </div>
              </div>
              {memberGrew && (
                <div className="mt-3 pt-3 border-t space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>At creation ({snapshotMemberCount} members)</span>
                    <span className="font-medium text-foreground">KES {expectedAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Current ({memberCount} members)</span>
                    <span className="font-medium text-foreground">KES {currentTarget.toLocaleString()}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
              <CardDescription>Case duration and status</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">Created on</p>
                    <p className="font-medium">{format(caseData.createdAt, 'MMMM d, yyyy')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">Duration</p>
                    <p className="font-medium">
                      {format(caseData.startDate, 'MMM d')} - {format(caseData.endDate, 'MMM d, yyyy')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">Contribution per member</p>
                    <p className="font-medium">KES {caseData.contributionPerMember.toLocaleString()}</p>
                  </div>
                </div>
                <div className="pt-3 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => navigate(`/cases/${id}/edit`)}
                  >
                    <Calendar className="h-4 w-4 mr-2" />
                    {caseData.isFinalized ? 'View Timeline' : 'Manage Timeline'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center">
              <div className="mr-4">
                <Avatar className="h-12 w-12 border-2 border-primary/10">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div>
                <CardTitle className="text-base">Affected Member</CardTitle>
                <CardDescription>Case beneficiary</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <p className="font-medium">{caseData.affectedMember?.name}</p>
                  <p className="text-sm text-muted-foreground">Member #{caseData.affectedMember?.memberNumber}</p>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-3.5 w-3.5" />
                  <span>{caseData.affectedMember?.gender}</span>
                </div>
                <div className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => caseData.affectedMember && navigate(`/members/${caseData.affectedMember.id}`)}
                  >
                    <ArrowRight className="h-4 w-4 mr-2" />
                    View Member Profile
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="details">
          <TabsList className="grid h-auto w-full grid-cols-1 gap-1 p-1 sm:grid-cols-3">
            <TabsTrigger value="details" className="min-h-10 whitespace-normal px-3 py-2">Details</TabsTrigger>
            <TabsTrigger value="contributions" className="min-h-10 whitespace-normal px-3 py-2">Contributions</TabsTrigger>
            <TabsTrigger value="disbursements" className="min-h-10 whitespace-normal px-3 py-2">Disbursements</TabsTrigger>
          </TabsList>
          
          <TabsContent value="details" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Case Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-medium mb-2">Summary</h3>
                    <p className="text-muted-foreground text-sm">
                      This is a {caseData.caseType.toLowerCase()} case for {caseData.affectedMember?.name}.
                      The case was created on {format(caseData.createdAt, 'MMMM d, yyyy')} and 
                      {caseData.isFinalized ? ' has been finalized.' : caseData.isActive ? ' is currently active.' : ' is in draft state.'}
                    </p>
                  </div>
                  <div>
                    <h3 className="font-medium mb-2">Actions</h3>
                    <div className="space-y-2">
                      {!caseData.isFinalized && (
                        <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
                          Contributions are automatically deducted from member wallets when they top up via M-Pesa. No manual deduction needed.
                        </p>
                      )}
                      {!caseData.isFinalized && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => setRevertDialogOpen(true)}
                          disabled={Boolean(contributionAction) || !hasCollectedContributions}
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          {contributionAction === 'revert' ? 'Reverting...' : 'Revert Contributions'}
                        </Button>
                      )}
                      {!caseData.isFinalized && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => navigate(`/cases/${id}/edit`)}
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Edit Case
                        </Button>
                      )}
                      {caseData.isActive && !caseData.isFinalized && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={handleFinalizeClick}
                          disabled={isUpdating}
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          {isUpdating ? 'Finalizing...' : 'Finalize Case'}
                        </Button>
                      )}
                      {!caseData.isActive && !caseData.isFinalized && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={handleActivateCase}
                          disabled={isUpdating}
                        >
                          <Clock className="h-4 w-4 mr-2" />
                          {isUpdating ? 'Activating...' : 'Activate Case'}
                        </Button>
                      )}
                      {caseData.isActive && !caseData.isFinalized && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                          onClick={handleDeleteClick}
                          disabled={isUpdating}
                        >
                          <TimerOff className="h-4 w-4 mr-2" />
                          {isUpdating ? 'Deleting...' : 'Delete Case'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="contributions">
            <Card>
              <CardHeader>
                <CardTitle>Member Contributions</CardTitle>
                <CardDescription>Contribution and refund activity for this case</CardDescription>
              </CardHeader>
              <CardContent>
                <ContributionsTab
                  caseId={id}
                  caseNumber={caseData.caseNumber}
                  contributionPerMember={caseData.contributionPerMember}
                  refreshKey={contributionRefreshKey}
                />
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="disbursements">
            <Card>
              <CardHeader>
                <CardTitle>Disbursements</CardTitle>
                <CardDescription>Funds released to the beneficiary</CardDescription>
              </CardHeader>
              <CardContent>
                {caseData.isActive && !caseData.isFinalized && (
                  <div className="flex justify-end pb-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDisbursementDialogOpen(true)}
                    >
                      <DollarSign className="h-4 w-4 mr-2" />
                      Record Disbursement
                    </Button>
                  </div>
                )}
                <div className="mt-6">
                  <DisbursementsTab caseId={id} refreshKey={disbursementRefreshKey} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={revertDialogOpen} onOpenChange={setRevertDialogOpen}>
        <AlertDialogContent className="w-[95vw] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Revert Contributions</AlertDialogTitle>
            <AlertDialogDescription>
              This will return all currently deducted case contributions back to the affected member wallets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={contributionAction === 'revert'}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevertContributions}
              disabled={contributionAction === 'revert'}
            >
              {contributionAction === 'revert' ? 'Reverting...' : 'Revert'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Finalize Confirmation Dialog */}
      <AlertDialog open={finalizeDialogOpen} onOpenChange={setFinalizeDialogOpen}>
        <AlertDialogContent className="w-[95vw] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize Case</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to finalize this case? This will close the case for further contributions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleFinalizeCase}
              disabled={isUpdating}
            >
              {isUpdating ? 'Finalizing...' : 'Finalize'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="w-[95vw] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Case</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this case? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSuspendDeleteCase}
              disabled={isUpdating}
              className="bg-red-600 hover:bg-red-700"
            >
              {isUpdating ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={disbursementDialogOpen} onOpenChange={setDisbursementDialogOpen}>
        <DialogContent className="w-[95vw] sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Record Disbursement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (KES)</Label>
              <Input
                id="amount"
                type="number"
                min="1"
                value={disbursementAmount}
                onChange={(e) => setDisbursementAmount(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={disbursementMethod} onValueChange={setDisbursementMethod}>
                <SelectTrigger>
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="mpesa">M-Pesa</SelectItem>
                  <SelectItem value="bank">Bank</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reference">Reference (optional)</Label>
              <Input
                id="reference"
                value={disbursementReference}
                onChange={(e) => setDisbursementReference(e.target.value)}
                placeholder="Receipt or transaction reference"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={disbursementDescription}
                onChange={(e) => setDisbursementDescription(e.target.value)}
                placeholder={`Disbursement for Case #${caseData?.caseNumber || ''}`}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisbursementDialogOpen(false)} disabled={isDisbursing}>
              Cancel
            </Button>
            <Button onClick={handleRecordDisbursement} disabled={isDisbursing}>
              {isDisbursing ? 'Recording...' : 'Record Disbursement'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default CaseDetails;
