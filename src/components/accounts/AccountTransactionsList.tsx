import { useState, useEffect } from "react";
import { Search, Download, Filter, UserPlus } from "lucide-react";
import { 
  Table, 
  TableHeader, 
  TableRow, 
  TableHead, 
  TableBody, 
  TableCell 
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Transaction } from "@/lib/types";
import { supabase } from '@/integrations/supabase/client';
import { TRANSACTION_LIST_COLUMNS } from '@/lib/supabaseSelectColumns';
import { toast } from '@/components/ui/use-toast';

interface AccountTransactionsListProps {
  title: string;
  transactions?: Transaction[];
}

interface Member {
  id: string;
  name: string;
  member_number: string;
}

const AccountTransactionsList = ({ title, transactions: providedTransactions }: AccountTransactionsListProps) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const isRenewalAccount = title.toLowerCase().includes('renewal');
  const toEAT = (date: Date) => new Date(date.getTime() - 3 * 60 * 60 * 1000);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberLookup, setMemberLookup] = useState<Record<string, Member>>({});
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [transferring, setTransferring] = useState(false);

  // Fetch members for transfer dialog + member number display
  const fetchMembers = async () => {
    try {
      const result = await (supabase
        .from('members')
        .select('id, name, member_number')
        .order('name') as unknown as { data: Member[] | null; error: Error | null });
      
      const { data, error } = result;
      if (error) throw error;
      setMembers(data || []);
      const lookup: Record<string, Member> = {};
      for (const m of data || []) {
        if (m.id) lookup[m.id] = m;
      }
      setMemberLookup(lookup);
    } catch (error) {
      console.error('Error fetching members:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load members for transfer."
      });
    }
  };

  const handleTransferClick = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setSelectedMemberId('');
    setTransferDialogOpen(true);
    fetchMembers();
  };

  const handleTransfer = async () => {
    if (!selectedTransaction || !selectedMemberId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please select a member to transfer to."
      });
      return;
    }

    setTransferring(true);
    try {
      // Update the transaction with the selected member ID
      // Using type assertion to work around Supabase type inference issues
      const updateQuery = (supabase as any)
        .from('transactions')
        .update({ 
          member_id: selectedMemberId,
          description: `Transferred from suspense: ${selectedTransaction.description}`
        })
        .eq('id', selectedTransaction.id);
      
      const updateResult = await updateQuery;

      const error = updateResult.error;

      if (error) throw error;

      toast({
        title: "Success",
        description: "Transaction transferred successfully."
      });

      setTransferDialogOpen(false);
      setSelectedTransaction(null);
      setSelectedMemberId('');
      
      // Refresh the transactions list
      window.location.reload();
    } catch (error) {
      console.error('Error transferring transaction:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to transfer transaction."
      });
    } finally {
      setTransferring(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  useEffect(() => {
    const fetchTransactions = async () => {
      if (providedTransactions) {
        setTransactions(providedTransactions);
        setLoading(false);
        return;
      }

      setLoading(true);
      let query = supabase.from('transactions').select(TRANSACTION_LIST_COLUMNS);
      
      // Filter by account type based on title
      if (title.toLowerCase().includes('registration')) {
        query = query.ilike('description', 'Registration%');
      } else if (title.toLowerCase().includes('renewal')) {
        query = query.eq('transaction_type', 'renewal');
      } else if (title.toLowerCase().includes('penalty')) {
        query = query.eq('transaction_type', 'penalty');
      } else if (title.toLowerCase().includes('arrears')) {
        query = query.eq('transaction_type', 'arrears');
      } else if (title.toLowerCase().includes('late')) {
        query = query.eq('transaction_type', 'late_payment');
      } else if (title.toLowerCase().includes('suspense')) {
        // For suspense account, we need to find transactions not associated with any member
        // First get all members
        const membersResult = await supabase
          .from('members')
          .select('id, name, member_number') as unknown as { data: Member[] | null; error: Error | null };
        const membersData = membersResult.data;
        const membersError = membersResult.error;
          
        if (membersError) {
          console.error('Error fetching members for suspense filter:', membersError);
          setLoading(false);
          return;
        }
        
        // Create a list of all member identifiers
        const memberIdentifiers: { id: string; name: string; memberNumber: string }[] = (membersData || []).map(member => ({
          id: member.id,
          name: member.name.toLowerCase(),
          memberNumber: member.member_number.toLowerCase()
        }));
        
        // Get all transactions first
        const transactionsResult = await (supabase
          .from('transactions')
          .select(TRANSACTION_LIST_COLUMNS)
          .order('created_at', { ascending: false }) as unknown as { data: any[] | null; error: Error | null });
        const allTransactions = transactionsResult.data;
        const transactionsError = transactionsResult.error;
          
        if (transactionsError) {
          console.error('Error fetching transactions for suspense filter:', transactionsError);
          setLoading(false);
          return;
        }
        
        // Filter transactions that are not associated with any member
        const suspenseTransactions = (allTransactions || []).filter(tx => {
          const description = tx.description?.toLowerCase() || '';
          const hasNumber = /\d/.test(description);
          
          // Check if the description contains any member name or member number
          const isAssociatedWithMember = memberIdentifiers.some(member => 
            description.includes(member.name) || 
            description.includes(member.memberNumber) ||
            description.includes(member.id)
          );
          
          // Also check if the transaction has a member_id but the description doesn't match any member
          const hasMemberId = tx.member_id && tx.member_id !== 'unknown';
          const memberExists = hasMemberId ? memberIdentifiers.find(m => m.id === tx.member_id) : false;
          
          // Transaction is in suspense if:
          // 1. Description doesn't contain any member identifier, OR
          // 2. Has member_id but that member doesn't exist in our system, OR
          // 3. Description is empty or unclear
          // AND the description has no numbers (numbers indicate valid member references)
          const qualifiesByAssociation = !isAssociatedWithMember || 
                 (hasMemberId && !memberExists) || 
                 !description || 
                 description.trim() === '';

          return qualifiesByAssociation && !hasNumber;
        });
        
        // Transform suspense transactions
        const transformedData = suspenseTransactions.map((t: any) => ({
          id: t.id,
          memberId: t.member_id || 'unknown',
          caseId: t.case_id || undefined,
          amount: Number(t.amount),
          transactionType: 'suspense' as const,
          mpesaReference: t.mpesa_reference || undefined,
          createdAt: new Date(t.created_at),
          description: t.description || 'No description provided',
        }));
        
        setTransactions(transformedData);
        setLoading(false);
        return;
      }
      
      query = query.order('created_at', { ascending: false });
      const { data, error } = await query;
      if (!error && data) {
        setTransactions(
          data.map((t: any) => ({
            id: t.id,
            memberId: t.member_id,
            caseId: t.case_id || undefined,
            amount: Number(t.amount),
            transactionType: t.transaction_type,
            mpesaReference: t.mpesa_reference || undefined,
            createdAt: new Date(t.created_at),
            description: t.description || '',
          }))
        );
      }
      setLoading(false);
    };
    fetchTransactions();
  }, [title, providedTransactions]);

  const years = Array.from(new Set(
    transactions.map(tx => new Date(tx.createdAt).getFullYear())
  )).sort((a, b) => b - a);

  const months = [
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

  const filteredTransactions = transactions.filter(tx => {
    // Search filter
    const matchesSearch = 
      tx.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.mpesaReference?.toLowerCase().includes(searchQuery.toLowerCase());
    
    // Year filter
    const txYear = new Date(tx.createdAt).getFullYear().toString();
    const matchesYear = yearFilter === 'all' || txYear === yearFilter;
    
    // Month filter
    const txMonth = new Date(tx.createdAt).getMonth().toString();
    const matchesMonth = monthFilter === 'all' || txMonth === monthFilter;
    
    return matchesSearch && matchesYear && matchesMonth;
  });

  const handleExport = () => {
    // Export functionality placeholder
  };

  if (loading) {
    return <div className="py-10 text-center text-muted-foreground">Loading transactions...</div>;
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">{title} Transactions</h3>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="w-full md:w-[180px]">
            <SelectValue placeholder="Filter by Year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Years</SelectItem>
            {years.map(year => (
              <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <Select value={monthFilter} onValueChange={setMonthFilter}>
          <SelectTrigger className="w-full md:w-[180px]">
            <SelectValue placeholder="Filter by Month" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Months</SelectItem>
            {months.map(month => (
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
              <TableHead>Reference</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Type</TableHead>
              {title.toLowerCase().includes('suspense') && (
                <TableHead className="text-right">Actions</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTransactions.length > 0 ? (
              filteredTransactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>
                    {toEAT(new Date(transaction.createdAt)).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{transaction.description}</TableCell>
                  <TableCell>
                    {(() => {
                      const info = transaction.memberId ? memberLookup[transaction.memberId] : undefined;
                      if (info) {
                        return (
                          <span>
                            <span className="font-medium">{info.name}</span>
                            <span className="text-muted-foreground"> (#{info.member_number})</span>
                          </span>
                        );
                      }
                      return transaction.memberId
                        ? `Member #${transaction.memberId.substring(0, 8)}`
                        : '-';
                    })()}
                  </TableCell>
                  <TableCell>{transaction.mpesaReference || "-"}</TableCell>
                  <TableCell className="text-right">
                    KES {(isRenewalAccount ? Math.abs(transaction.amount) : transaction.amount).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${transaction.amount < 0 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                      {transaction.amount < 0 ? 'Debit' : 'Credit'}
                    </span>
                  </TableCell>
                  {title.toLowerCase().includes('suspense') && (
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTransferClick(transaction)}
                      >
                        <UserPlus className="h-4 w-4 mr-1" />
                        Transfer
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={title.toLowerCase().includes('suspense') ? 7 : 6} className="text-center py-4">
                  No transactions found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Transfer Dialog */}
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer Transaction to Member</DialogTitle>
          </DialogHeader>
          {selectedTransaction && (
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <h4 className="font-medium mb-2">Transaction Details</h4>
                <div className="text-sm space-y-1">
                  <div><span className="font-medium">Amount:</span> KES {(isRenewalAccount ? Math.abs(selectedTransaction.amount) : selectedTransaction.amount).toLocaleString()}</div>
                  <div><span className="font-medium">Description:</span> {selectedTransaction.description}</div>
                  <div><span className="font-medium">Reference:</span> {selectedTransaction.mpesaReference || 'N/A'}</div>
                  <div><span className="font-medium">Date:</span> {toEAT(new Date(selectedTransaction.createdAt)).toLocaleDateString()}</div>
                </div>
              </div>
              
              <div>
                <Label htmlFor="member-select">Select Member</Label>
                <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                  <SelectTrigger className="w-full mt-1">
                    <SelectValue placeholder="Choose a member..." />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name} ({member.member_number})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleTransfer} 
              disabled={!selectedMemberId || transferring}
            >
              {transferring ? 'Transferring...' : 'Transfer Transaction'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AccountTransactionsList;
