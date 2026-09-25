import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import AccountSummaryCard from './AccountSummaryCard';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';
import { TRANSACTION_LIST_COLUMNS } from '@/lib/supabaseSelectColumns';

interface LatePaymentRow {
  id: string;
  member_id: string | null;
  case_id: string | null;
  amount: number;
  description: string | null;
  mpesa_reference: string | null;
  reference: string | null;
  created_at: string;
}

const PAGE_SIZE = 20;

const getPageNumbers = (currentPage: number, totalPages: number) => {
  const pages: number[] = [];
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(start + 4, totalPages);
  for (let i = start; i <= end; i++) pages.push(i);
  return pages;
};

const MONTHS = [
  { value: '0', label: 'January' },
  { value: '1', label: 'February' },
  { value: '2', label: 'March' },
  { value: '3', label: 'April' },
  { value: '4', label: 'May' },
  { value: '5', label: 'June' },
  { value: '6', label: 'July' },
  { value: '7', label: 'August' },
  { value: '8', label: 'September' },
  { value: '9', label: 'October' },
  { value: '10', label: 'November' },
  { value: '11', label: 'December' },
];

const LatePaymentsAccount = () => {
  const [rows, setRows] = useState<LatePaymentRow[]>([]);
  const [caseNumbers, setCaseNumbers] = useState<Record<string, string>>({});
  const [caseList, setCaseList] = useState<{ id: string; case_number: string }[]>([]);
  const [memberLookup, setMemberLookup] = useState<Record<string, { name: string; member_number: string }>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [caseFilter, setCaseFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const { data: txData, error: txError } = await (supabase
          .from('transactions')
          .select(TRANSACTION_LIST_COLUMNS)
          .eq('transaction_type', 'late_payment')
          .in('status', ['completed', 'success'])
          .order('created_at', { ascending: false }) as unknown as { data: LatePaymentRow[] | null; error: Error | null });
        if (txError) throw txError;
        setRows((txData || []).map((t) => ({ ...t, amount: Number(t.amount) || 0 })));

        const { data: caseData } = await supabase
          .from('cases')
          .select('id, case_number')
          .order('case_number', { ascending: false });
        const cmap: Record<string, string> = {};
        for (const c of (caseData || []) as { id: string; case_number: string }[]) {
          cmap[c.id] = c.case_number;
        }
        setCaseNumbers(cmap);
        setCaseList(((caseData || []) as { id: string; case_number: string }[]).filter((c) => (txData || []).some((t) => t.case_id === c.id)));

        const { data: memberData } = await supabase
          .from('members')
          .select('id, name, member_number');
        const mmap: Record<string, { name: string; member_number: string }> = {};
        for (const m of (memberData || []) as { id: string; name: string; member_number: string }[]) {
          mmap[m.id] = { name: m.name, member_number: m.member_number };
        }
        setMemberLookup(mmap);
      } catch (error) {
        console.error('Error fetching late payment transactions:', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to load late payment transactions.',
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const years = useMemo(
    () => Array.from(new Set(rows.map((r) => new Date(r.created_at).getFullYear()))).sort((a, b) => b - a),
    [rows],
  );

  const filtered = rows.filter((r) => {
    const q = searchQuery.trim().toLowerCase();
    const member = r.member_id ? memberLookup[r.member_id] : undefined;
    const caseNo = r.case_id ? caseNumbers[r.case_id] || '' : '';
    const matchesSearch =
      !q ||
      (r.description || '').toLowerCase().includes(q) ||
      (r.mpesa_reference || '').toLowerCase().includes(q) ||
      (member?.name || '').toLowerCase().includes(q) ||
      (member?.member_number || '').toLowerCase().includes(q) ||
      caseNo.toLowerCase().includes(q);
    const d = new Date(r.created_at);
    const matchesYear = yearFilter === 'all' || d.getFullYear().toString() === yearFilter;
    const matchesMonth = monthFilter === 'all' || d.getMonth().toString() === monthFilter;
    const matchesCase = caseFilter === 'all' || r.case_id === caseFilter;
    return matchesSearch && matchesYear && matchesMonth && matchesCase;
  });

  const total = filtered.reduce((acc, r) => acc + Math.abs(r.amount || 0), 0);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pagedRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleFilterChange = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-6">
      <AccountSummaryCard
        title="Late Payments Account"
        balance={total}
        credits={total}
        debits={0}
        isLoading={isLoading}
      />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Late Payments {filtered.length !== rows.length ? `(${filtered.length} of ${rows.length})` : `(${rows.length})`}</h3>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search member, case, description..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            />
          </div>

          <Select value={caseFilter} onValueChange={handleFilterChange(setCaseFilter)}>
            <SelectTrigger className="w-full md:w-[180px]">
              <SelectValue placeholder="Filter by Case" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Cases</SelectItem>
              {caseList.map((c) => (
                <SelectItem key={c.id} value={c.id}>#{c.case_number}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={yearFilter} onValueChange={handleFilterChange(setYearFilter)}>
            <SelectTrigger className="w-full md:w-[150px]">
              <SelectValue placeholder="Filter by Year" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Years</SelectItem>
              {years.map((year) => (
                <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={monthFilter} onValueChange={handleFilterChange(setMonthFilter)}>
            <SelectTrigger className="w-full md:w-[150px]">
              <SelectValue placeholder="Filter by Month" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Months</SelectItem>
              {MONTHS.map((month) => (
                <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Case</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-4 text-muted-foreground">
                    Loading late payments...
                  </TableCell>
                </TableRow>
              ) : pagedRows.length > 0 ? (
                pagedRows.map((tx) => {
                  const member = tx.member_id ? memberLookup[tx.member_id] : undefined;
                  const caseNo = tx.case_id ? caseNumbers[tx.case_id] : undefined;
                  return (
                    <TableRow key={tx.id}>
                      <TableCell>{new Date(tx.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>{tx.description || 'Late payment'}</TableCell>
                      <TableCell>
                        {member ? (
                          <span>
                            <span className="font-medium">{member.name}</span>
                            <span className="text-muted-foreground"> (#{member.member_number})</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {caseNo ? (
                          <Badge variant="outline" className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                            #{caseNo}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>{tx.mpesa_reference || tx.reference || '-'}</TableCell>
                      <TableCell className="text-right">KES {Math.abs(tx.amount || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                          Late payment
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-4">
                    No late payments found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {!isLoading && filtered.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Showing {((safePage - 1) * PAGE_SIZE + 1).toLocaleString()}–
              {Math.min(safePage * PAGE_SIZE, filtered.length).toLocaleString()} of{' '}
              {filtered.length.toLocaleString()}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </Button>
              {getPageNumbers(safePage, totalPages).map((p) => (
                <Button
                  key={p}
                  variant={p === safePage ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCurrentPage(p)}
                >
                  {p}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LatePaymentsAccount;
