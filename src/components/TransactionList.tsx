import React, { useState, useCallback } from 'react';
import { format } from 'date-fns';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Wallet,
  RefreshCw,
  UserPlus,
  AlertCircle,
  CreditCard
} from 'lucide-react';
import { Transaction } from '@/lib/types';
import TransactionDetailModal from './TransactionDetailModal';
import { Skeleton } from '@/components/ui/skeleton';
import { walletRowDelta } from '@/lib/walletEffect';

interface TransactionListProps {
  transactions: Transaction[];
  loading?: boolean;
  renderAction?: (tx: Transaction) => React.ReactNode;
}

const TransactionItem = ({ transaction, onClick, renderAction }: { 
  transaction: Transaction, 
  onClick: (t: Transaction) => void,
  renderAction?: (t: Transaction) => React.ReactNode 
}) => {
  const getTransactionIcon = (type: string, amount: number, status?: string | null) => {
    const delta = walletRowDelta(type, amount, status);
    switch (type) {
      case 'contribution':
        return (delta ?? 0) < 0
          ? <ArrowDownLeft className="h-4 w-4 text-red-500" />
          : <ArrowUpRight className="h-4 w-4 text-green-500" />;
      case 'disbursement':
        return <ArrowDownLeft className="h-4 w-4 text-red-500" />;
      case 'registration':
      case 'registration_payment':
        return <UserPlus className="h-4 w-4 text-blue-500" />;
      case 'renewal':
        return <RefreshCw className="h-4 w-4 text-purple-500" />;
      case 'penalty':
        return <AlertCircle className="h-4 w-4 text-amber-500" />;
      case 'wallet_funding':
        return <Wallet className="h-4 w-4 text-emerald-500" />;
      default:
        return <CreditCard className="h-4 w-4 text-gray-500" />;
    }
  };

  const getTransactionTitle = (type: string) => {
    switch (type) {
      case 'contribution': return 'Case Contribution';
      case 'disbursement': return 'Case Disbursement';
      case 'registration': return 'Registration Fee';
      case 'registration_payment': return 'Registration Fee (Paid)';
      case 'renewal': return 'Annual Renewal';
      case 'penalty': return 'Penalty Payment';
      case 'wallet_funding': return 'Wallet Funding';
      default: return 'Transaction';
    }
  };

  return (
    <div 
      className="flex items-center justify-between p-3 sm:p-6 rounded-xl border bg-card shadow-sm hover:shadow-lg hover:scale-[1.01] transition-all group"
    >
      <div className="flex items-center space-x-3 sm:space-x-5 flex-1 cursor-pointer" onClick={() => onClick(transaction)}>
        <div className="h-10 sm:h-12 w-10 sm:w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary shadow-sm flex-shrink-0">
          {getTransactionIcon(transaction.transactionType, transaction.amount, transaction.status)}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-sm sm:text-base text-foreground truncate">{getTransactionTitle(transaction.transactionType)}</p>
          <p className="text-xs sm:text-sm text-muted-foreground mb-1 truncate">{transaction.description}</p>
          {('senderName' in transaction) && (transaction as any).senderName && (
            <p className="text-xs text-muted-foreground italic truncate">From: <span className="font-medium text-foreground">{(transaction as any).senderName}</span></p>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end min-w-[70px] sm:min-w-[140px] h-full ml-2 flex-shrink-0">
        {(() => {
          const delta = walletRowDelta(transaction.transactionType, transaction.amount, transaction.status);
          const pending = delta === null;
          const reversed = String(transaction.status || "").toLowerCase() === "reversed";
          const pos = delta !== null && delta > 0;
          const neg = delta !== null && delta < 0;
          return (
            <p className={`text-sm sm:text-lg font-bold tracking-tight ${pending ? 'text-muted-foreground' : pos ? 'text-green-600' : neg ? 'text-red-600' : 'text-muted-foreground'}`}>
              {pending ? (reversed ? 'Reversed' : 'Pending') : `${pos ? '+' : neg ? '-' : ''}KES ${Math.abs(delta ?? 0).toLocaleString()}`}
            </p>
          );
        })()}
        <div className="flex flex-col items-end mt-2 space-y-0.5">
          <span className="text-xs text-muted-foreground">
            {format(transaction.createdAt, 'MMM d, yyyy HH:mm')}
          </span>
          {transaction.mpesaReference && (
            <span className="text-xs text-blue-700 bg-blue-50 rounded px-2 py-0.5 mt-0.5">Ref: {transaction.mpesaReference}</span>
          )}
        </div>
      </div>
      {renderAction && (
        <div className="ml-4 flex-shrink-0">{renderAction(transaction)}</div>
      )}
    </div>
  );
};

const MemoizedTransactionItem = React.memo(TransactionItem);

const TransactionList = ({ transactions, loading = false, renderAction }: TransactionListProps) => {
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleTransactionClick = useCallback((transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="p-4 rounded-lg border bg-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div>
                  <Skeleton className="h-5 w-32 mb-2" />
                  <Skeleton className="h-4 w-40" />
                </div>
              </div>
              <div className="text-right">
                <Skeleton className="h-5 w-24 mb-2" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {transactions.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-muted-foreground">No transactions found</p>
        </div>
      ) : (
        transactions.map((transaction) => (
          <MemoizedTransactionItem 
            key={transaction.id}
            transaction={transaction}
            onClick={handleTransactionClick}
            renderAction={renderAction}
          />
        ))
      )}

      <TransactionDetailModal 
        transaction={selectedTransaction}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
      />
    </div>
  );
};

export default TransactionList;
