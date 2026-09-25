import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { auditStamp } from '@/lib/appAuth';
import type { Database } from '@/integrations/supabase/types';
import { toast } from 'sonner';

interface Member {
  id: string;
  name: string;
  member_number: string;
}

interface TransferToMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: {
    id: string;
    amount: number;
    mpesaReference?: string;
    createdAt?: Date;
    status?: string | null;
    description?: string;
  } | null;
  onSuccess: () => void;
}

type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type MemberLookup = Pick<Member, 'name' | 'member_number'>;

export function TransferToMemberDialog({ open, onOpenChange, transaction, onSuccess }: TransferToMemberDialogProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (open) {
      fetchMembers();
    } else {
      setSearchTerm('');
      setSelectedMemberId('');
      setConfirmOpen(false);
    }
  }, [open]);

  const fetchMembers = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('members')
        .select('id, name, member_number')
        .order('name');

      if (error) throw error;
      setMembers(data || []);
    } catch (error) {
      console.error('Error fetching members:', error);
      toast.error('Failed to load members', {
        description: 'Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const filteredMembers = members.filter(
    (member) =>
      member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.member_number.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const selectedMember = members.find((member) => member.id === selectedMemberId) || null;

  const handleTransfer = async () => {
    if (!selectedMemberId || !transaction) return;

    setIsTransferring(true);
    try {
      // Start a transaction
      const { data: memberDataRaw, error: memberError } = await supabase
        .from('members')
        .select('name, member_number')
        .eq('id', selectedMemberId)
        .single();

      if (memberError) throw memberError;
      const memberData = memberDataRaw as MemberLookup | null;
      if (!memberData) throw new Error('Selected member was not found');

      const transactionPayload: TransactionInsert = {
        member_id: selectedMemberId,
        amount: transaction.amount,
        transaction_type: 'wallet_funding',
        description: `Transfer from suspense - Member ${memberData.member_number}`,
        mpesa_reference: transaction.mpesaReference || null,
        created_at: new Date().toISOString(),
        case_id: null,
        metadata: {
          source: 'suspense_transfer',
          ...auditStamp(),
        },
      };

      // Create a new transaction record
      // Note: A database trigger automatically updates the member's wallet_balance
      const { error: txError } = await (supabase.from('transactions') as any).insert([transactionPayload]);

      if (txError) throw txError;

      // Update the original wrong_mpesa_transaction
      const { error: updateError } = await (supabase as any)
        .from('wrong_mpesa_transactions')
        .update({
          status: 'matched',
          matched_member_id: selectedMemberId,
          matched_at: new Date().toISOString(),
          notes: `Transferred to member ${memberData.name} (${memberData.member_number})`
        })
        .eq('id', transaction.id);

      if (updateError) throw updateError;

      toast.success('Transfer successful', {
        description: `Transaction successfully transferred to ${memberData.name}`,
      });

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error transferring transaction:', error);
      toast.error('Failed to transfer transaction', {
        description: 'Please try again.',
      });
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Transfer to Member</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Transaction Details</Label>
            <div className="rounded-md border p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Amount</p>
                  <p className="font-medium">KES {transaction?.amount?.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Reference</p>
                  <p className="font-medium">{transaction?.mpesaReference || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Date</p>
                  <p className="font-medium">
                    {transaction?.createdAt ? new Date(transaction.createdAt).toLocaleString() : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <p className="font-medium">{transaction?.status || 'N/A'}</p>
                </div>
              </div>
              {transaction?.description && (
                <div className="mt-4">
                  <p className="text-sm text-gray-500">Description</p>
                  <p className="text-sm">{transaction.description}</p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="search">Search Member</Label>
            <Input
              id="search"
              placeholder="Search by name or member number"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="max-h-60 overflow-y-auto border rounded-md">
            {isLoading ? (
              <div className="p-4 text-center text-gray-500">Loading members...</div>
            ) : filteredMembers.length === 0 ? (
              <div className="p-4 text-center text-gray-500">No members found</div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Member #</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredMembers.map((member) => (
                    <tr
                      key={member.id}
                      className={`hover:bg-gray-50 ${selectedMemberId === member.id ? 'bg-blue-50' : ''}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-sm">{member.name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">{member.member_number}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                        <Button
                          size="sm"
                          onClick={() => setSelectedMemberId(member.id)}
                          variant={selectedMemberId === member.id ? 'default' : 'outline'}
                        >
                          {selectedMemberId === member.id ? 'Selected' : 'Select'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-md border bg-muted/30 p-4">
            <Label>Selected Member</Label>
            {selectedMember ? (
              <div className="mt-2 flex items-center justify-between">
                <div>
                  <p className="font-medium">{selectedMember.name}</p>
                  <p className="text-xs text-muted-foreground">#{selectedMember.member_number}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedMemberId('')}
                  disabled={isTransferring}
                >
                  Clear
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No member selected yet.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isTransferring}>
            Cancel
          </Button>
          <Button onClick={() => setConfirmOpen(true)} disabled={!selectedMemberId || isTransferring}>
            {isTransferring ? 'Transferring...' : 'Transfer to Member'}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Transfer</AlertDialogTitle>
            <AlertDialogDescription>
              This will move the suspense transaction to the selected member and mark it as matched.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border bg-muted/40 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Member</span>
              <span className="font-medium">
                {selectedMember ? `${selectedMember.name} (#${selectedMember.member_number})` : 'N/A'}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-medium">
                KES {transaction?.amount?.toLocaleString() || 0}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Reference</span>
              <span className="font-medium">{transaction?.mpesaReference || 'N/A'}</span>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isTransferring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleTransfer}
              disabled={isTransferring || !selectedMemberId}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isTransferring ? 'Transferring...' : 'Confirm Transfer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
