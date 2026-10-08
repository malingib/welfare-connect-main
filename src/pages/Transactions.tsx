import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import TransactionList from '@/components/TransactionList';
import { TransactionReversalDialog } from '@/components/transactions/TransactionReversalDialog';
import DashboardLayout from '@/layouts/DashboardLayout';
import { Transaction } from '@/lib/types';
import { supabase } from '@/integrations/supabase/client';
import { persistentCache } from '@/lib/cache';
import { TRANSACTION_LIST_COLUMNS } from '@/lib/supabaseSelectColumns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useSearchParams } from 'react-router-dom';

const transactionTypes = [
  { value: 'all', label: 'All Types' },
  { value: 'contribution', label: 'Contribution' },
  { value: 'disbursement', label: 'Disbursement' },
  { value: 'registration', label: 'Registration' },
  { value: 'renewal', label: 'Renewal' },
  { value: 'penalty', label: 'Penalty' },
  { value: 'wallet_funding', label: 'Wallet Funding' },
];

const Transactions = () => {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const memberId = searchParams.get('memberId');

  const [page, setPage] = useState(1);
  const [hasMorePages, setHasMorePages] = useState(false);
  const pageSize = 10;

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    // ⚡ Instant load: Start with cached data if it exists
    const cacheKey = memberId ? `transactions-${memberId}-${page}` : `transactions-all-${page}`;
    const cached = persistentCache.get<Transaction[]>(cacheKey);
    return cached || [];
  });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [filterType, setFilterType] = useState('all');
  
  // States for transaction editing
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [newDescription, setNewDescription] = useState('');
  const [newCaseId, setNewCaseId] = useState('');
  const [cases, setCases] = useState<{id: string, caseNumber: string}[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // States for transaction reversal
  const [reversalTx, setReversalTx] = useState<Transaction | null>(null);
  const [reversalDialogOpen, setReversalDialogOpen] = useState(false);

  // Debounce search input
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(value), 300);
  };
  
  const fetchTransactions = async (pageNum: number = page) => {
    try {
      const cacheKey = memberId ? `transactions-${memberId}-${pageNum}` : `transactions-all-${pageNum}`;
      if (!persistentCache.has(cacheKey)) {
        setLoading(true);
      }

      const fetchLimit = pageSize + 1;
      let query = supabase.from('transactions')
        .select(TRANSACTION_LIST_COLUMNS)
        .order('created_at', { ascending: false });
        
      if (memberId) {
        query = query.eq('member_id', memberId);
      }
      
      const from = (pageNum - 1) * pageSize;
      const to = from + fetchLimit - 1;
      query = query.range(from, to);

      const { data, error } = await query;
      if (error) throw error;

      if (data) {
        const pageRows = data.slice(0, pageSize);
        setHasMorePages(data.length > pageSize);
        const formattedTransactions: Transaction[] = pageRows.map((t: any) => ({
          id: t.id,
          memberId: t.member_id,
          caseId: t.case_id || undefined,
          amount: ['registration', 'renewal', 'penalty', 'contribution', 'arrears', 'late_payment'].includes(String(t.transaction_type || '').toLowerCase())
            ? -Math.abs(Number(t.amount) || 0)
            : Number(t.amount),
          transactionType: t.transaction_type as "contribution" | "registration" | "registration_payment" | "renewal" | "penalty" | "arrears" | "late_payment" | "wallet_funding" | "disbursement",
          mpesaReference: t.mpesa_reference || undefined,
          createdAt: new Date(t.created_at),
          description: t.description || '',
          paymentMethod: t.payment_method || null,
          status: t.status || null,
        }));
        setTransactions(formattedTransactions);
        // Cache result for 5 mins
        persistentCache.set(cacheKey, formattedTransactions, 5 * 60 * 1000);
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions(page);
  }, [page, memberId]); // Re-fetch on page or memberId change
  
  // Fetch cases for contribution editing
  useEffect(() => {
    if (editingTx && editingTx.transactionType === 'contribution') {
      (supabase as any)
        .from('cases')
        .select('id, case_number')
        .then(({ data }: any) => {
          setCases((data || []).map(c => ({ id: c.id, caseNumber: c.case_number })));
        });
    }
  }, [editingTx]);
  
  // Filter transactions based on search term and type
  const filteredTransactions = useMemo(() => transactions.filter(transaction => {
    const q = debouncedSearch.toLowerCase();
    const matchesSearch = 
      q === '' || 
      transaction.description.toLowerCase().includes(q) ||
      transaction.mpesaReference?.toLowerCase().includes(q);
      
    const matchesType = 
      filterType === 'all' || 
      transaction.transactionType === filterType;
      
    return matchesSearch && matchesType;
  }), [transactions, debouncedSearch, filterType]);
  
  // Edit handler
  const handleEdit = (tx: Transaction) => {
    setEditingTx(tx);
    setNewDescription(tx.description);
    setNewCaseId(tx.caseId || '');
  };

  // Save handler
  const handleSave = async () => {
    if (!editingTx) return;
    
    setIsSaving(true);
    let description = newDescription;
    let caseIdToSave: string | undefined = editingTx.caseId;

    if (editingTx.transactionType === 'contribution') {
      caseIdToSave = newCaseId || undefined;
      if (newCaseId) {
        const selectedCase = cases.find(c => c.id === newCaseId);
        description = `Contribution for case: Case ${selectedCase?.caseNumber || ''}`;
      }
    }
    try {
      const { error } = await (supabase as any)
        .from('transactions')
        .update({
          description,
          case_id: caseIdToSave
        })
        .eq('id', editingTx.id);
      if (error) throw error;
      await fetchTransactions();
      setEditingTx(null);
      toast({ title: 'Success', description: 'Transaction updated.' });
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to update transaction.' });
    } finally {
      setIsSaving(false);
    }
  };
  
  // Revert handler - opens reversal dialog
  const handleRevert = (tx: Transaction) => {
    setReversalTx(tx)
    setReversalDialogOpen(true)
  };
  
  return (
    <DashboardLayout>
      <div className="space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
          <h1 className="text-xl md:text-2xl lg:text-3xl font-bold">Transactions</h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.location.reload()} className="text-xs md:text-sm h-9">
              <RefreshCw className="h-3.5 w-3.5 md:h-4 md:w-4 mr-1.5 md:mr-2" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search transactions..."
              className="pl-8 h-9 md:h-10 text-sm"
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>
          <Select
            defaultValue="all"
            onValueChange={(value) => setFilterType(value)}
          >
            <SelectTrigger className="w-full sm:w-[180px] h-9 md:h-10 text-sm">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              {transactionTypes.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <TransactionList
          transactions={filteredTransactions}
          loading={loading}
          renderAction={(tx) => (
            <div className="flex gap-1.5 md:gap-2">
              <Button variant="outline" size="sm" onClick={() => handleEdit(tx)} className="text-xs md:text-sm h-8 md:h-9">
                Edit
              </Button>
              <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 text-xs md:text-sm h-8 md:h-9" onClick={() => handleRevert(tx)}>
                Revert
              </Button>
            </div>
          )}
        />

        {(page > 1 || hasMorePages) && (
          <div className="flex flex-col sm:flex-row justify-center items-center gap-3 sm:gap-4 mt-6 md:mt-8 pb-6 md:pb-8">
            <Button
              variant="outline"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              className="text-xs md:text-sm h-9"
            >
              Previous
            </Button>
            <span className="text-xs md:text-sm font-medium">
              Page {page}
            </span>
            <Button
              variant="outline"
              onClick={() => setPage(p => p + 1)}
              disabled={!hasMorePages || loading}
              className="text-xs md:text-sm h-9"
            >
              Next
            </Button>
          </div>
        )}

        {/* Edit Transaction Dialog */}
        <Dialog open={!!editingTx} onOpenChange={() => setEditingTx(null)}>
          <DialogContent className="max-w-md bg-card rounded-2xl shadow-xl p-0 w-[95vw] sm:w-full">
            <div className="p-4 md:p-6">
              <DialogHeader>
                <DialogTitle className="text-lg md:text-2xl font-bold mb-2 text-primary">Edit Transaction</DialogTitle>
              </DialogHeader>
              {editingTx && (
                <div className="space-y-4 md:space-y-6 mt-4">
                  <div className="grid grid-cols-1 gap-3 md:gap-4">
                    <div>
                      <Label className="text-xs md:text-sm font-semibold">Type</Label>
                      <div className="font-medium text-sm md:text-base mt-1 text-muted-foreground">{editingTx.transactionType}</div>
                    </div>
                    {editingTx.transactionType === 'contribution' && (
                      <div>
                        <Label htmlFor="case" className="text-xs md:text-sm font-semibold">Case Number</Label>
                        <select
                          id="case"
                          className="w-full border rounded-lg p-2 mt-1 bg-white text-sm"
                          value={newCaseId}
                          onChange={e => setNewCaseId(e.target.value)}
                        >
                          <option value="">Select Case</option>
                          {cases.map(c => (
                            <option key={c.id} value={c.id}>{c.caseNumber}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <Label htmlFor="desc" className="text-xs md:text-sm font-semibold">Description</Label>
                      {editingTx.transactionType === 'contribution' ? (
                        <Textarea
                          id="desc"
                          className="w-full border rounded-lg p-2 mt-1 bg-white text-sm"
                          value={
                            newCaseId
                              ? `Contribution for case: Case ${cases.find(c => c.id === newCaseId)?.caseNumber || ''}`
                              : newDescription
                          }
                          readOnly
                        />
                      ) : (
                        <Textarea
                          id="desc"
                          className="w-full border rounded-lg p-2 mt-1 bg-white text-sm"
                          value={newDescription}
                          onChange={e => setNewDescription(e.target.value)}
                          placeholder="Enter description"
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
              <DialogFooter className="mt-6 md:mt-8 flex justify-end gap-2 md:gap-4">
                <Button variant="outline" className="rounded-lg px-4 md:px-6 py-2 text-sm" onClick={() => setEditingTx(null)} disabled={isSaving}>Cancel</Button>
                <Button className="rounded-lg px-4 md:px-6 py-2 font-semibold text-sm" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        {/* Transaction Reversal Dialog */}
        <TransactionReversalDialog
          transaction={reversalTx}
          open={reversalDialogOpen}
          onOpenChange={(open) => {
            setReversalDialogOpen(open)
            if (!open) setReversalTx(null)
          }}
          onSuccess={() => {
            fetchTransactions()
            toast({
              title: 'Reversal successful',
              description: 'Transaction has been reversed',
            })
          }}
        />
      </div>
    </DashboardLayout>
  );
};

export default Transactions;
