import { useEffect, useState } from 'react';
import { Transaction } from '@/lib/types';
import AccountSummaryCard from './AccountSummaryCard';
import AccountTransactionsList from './AccountTransactionsList';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';
import { TRANSACTION_LIST_COLUMNS } from '@/lib/supabaseSelectColumns';

const ArrearsAccount = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [totalBalance, setTotalBalance] = useState(0);
  const [totalCredits, setTotalCredits] = useState(0);
  const [totalDebits, setTotalDebits] = useState(0);

  const fetchTransactions = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select(TRANSACTION_LIST_COLUMNS)
        .eq('transaction_type', 'arrears')
        .in('status', ['completed', 'success'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedData: Transaction[] = (data || []).map((item: any) => ({
        id: item.id,
        memberId: item.member_id,
        caseId: item.case_id,
          amount: Number(item.amount),
          transactionType: 'arrears',
          mpesaReference: item.mpesa_reference,
          createdAt: new Date(item.created_at),
          description: item.description || 'Arrears deduction',
        }));

      setTransactions(formattedData);

      const credits = formattedData.reduce((acc, tx) => acc + Math.abs(tx.amount || 0), 0);
      setTotalCredits(credits);
      setTotalBalance(credits);
      setTotalDebits(0);
    } catch (error) {
      console.error('Error fetching arrears transactions:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load arrears transactions.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  return (
    <div className="space-y-6">
      <AccountSummaryCard
        title="Arrears Account"
        balance={totalBalance}
        credits={totalCredits}
        debits={totalDebits}
        isLoading={isLoading}
      />

      <AccountTransactionsList
        transactions={transactions}
        title="Arrears"
      />
    </div>
  );
};

export default ArrearsAccount;
