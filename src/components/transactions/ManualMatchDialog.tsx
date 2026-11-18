import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Search, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { parseAndValidateBillReference } from '@/integrations/supabase/reference-parser';

interface WrongMpesaTransaction {
  id: string;
  mpesa_receipt_number: string;
  phone_number: string;
  amount: number;
  sender_name: string;
  transaction_date: string;
  status: string;
  reference: string;
  reference_type: string;
  metadata: any;
}

interface ManualMatchDialogProps {
  transaction: WrongMpesaTransaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ManualMatchDialog({
  transaction,
  open,
  onOpenChange,
  onSuccess,
}: ManualMatchDialogProps) {
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [selectedCase, setSelectedCase] = useState<any>(null);
  const [notes, setNotes] = useState('');
  const [referenceInfo, setReferenceInfo] = useState<any>(null);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  // Parse reference when transaction changes
  useEffect(() => {
    if (transaction?.reference) {
      const parsed = parseAndValidateBillReference(transaction.reference);
      setReferenceInfo(parsed);
    } else {
      setReferenceInfo(null);
    }
  }, [transaction?.reference]);
  
  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSearchTerm('');
      setSelectedMember(null);
      setSelectedCase(null);
      setNotes('');
      setSearchResults([]);
    }
  }, [open]);
  
  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      setSearchResults([]);
      return;
    }
    
    setIsSearching(true);
    try {
      const { data, error } = await supabase
        .from('members')
        .select(`
          id,
          member_number,
          first_name,
          last_name,
          email,
          phone,
          cases: cases!member_id (
            id,
            case_number,
            title,
            status
          )
        `)
        .or(`member_number.ilike.%${searchTerm}%,first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
        .limit(10);
      
      if (error) throw error;
      setSearchResults(data || []);
    } catch (error) {
      console.error('Search error:', error);
      toast.error('Failed to search members');
    } finally {
      setIsSearching(false);
    }
  };
  
  const handleMemberSelect = (member: any) => {
    setSelectedMember(member);
    setSelectedCase(null);
    setSearchTerm('');
    setSearchResults([]);
    
    // Auto-select case if reference contains case info
    if (referenceInfo?.caseNumber && member.cases) {
      const matchingCase = member.cases.find((c: any) => c.case_number === referenceInfo.caseNumber);
      if (matchingCase) {
        setSelectedCase(matchingCase);
      }
    }
  };
  
  const handleMatch = async () => {
    if (!transaction || !selectedMember) {
      toast.error('Please select a member to match');
      return;
    }
    
    setLoading(true);
    try {
      const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      if (!currentUser?.id) {
        throw new Error('Current user could not be determined');
      }
      
      // Check for double credit
      const { data: creditCheck } = await supabase.rpc('check_double_credit', {
        p_mpesa_receipt_number: transaction.mpesa_receipt_number,
        p_amount: transaction.amount,
        p_member_id: selectedMember.id,
        p_transaction_type: 'wallet_funding'
      });
      
      if (creditCheck && creditCheck[0]?.has_existing_transaction) {
        throw new Error('Transaction with this receipt number already exists');
      }
      
      // Create credit lock
      const { data: lockData } = await supabase.rpc('create_credit_lock', {
        p_mpesa_receipt_number: transaction.mpesa_receipt_number,
        p_amount: transaction.amount,
        p_member_id: selectedMember.id,
        p_transaction_type: 'wallet_funding'
      });
      
      if (!lockData || !lockData[0]?.lock_created) {
        throw new Error('Failed to create credit lock');
      }
      
      // Record manual match in audit trail
      await supabase.rpc('record_manual_match', {
        p_wrong_mpesa_transaction_id: transaction.id,
        p_original_member_id: null,
        p_matched_member_id: selectedMember.id,
        p_matched_case_id: selectedCase?.id || null,
        p_reference_type: referenceInfo?.format || 'unknown',
        p_action: 'manual_match',
        p_amount: transaction.amount,
        p_mpesa_receipt_number: transaction.mpesa_receipt_number,
        p_reference: transaction.reference,
        p_notes: notes,
        p_matched_by: currentUser.id,
        p_metadata: {
          auto_selected_case: !!selectedCase,
          case_from_reference: referenceInfo?.caseNumber || null
        }
      });
      
      // Update wrong transaction status
      await supabase
        .from('wrong_mpesa_transactions')
        .update({
          status: 'matched',
          matched_member_id: selectedMember.id,
          matched_case_id: selectedCase?.id || null,
          matched_at: new Date().toISOString(),
          matched_by: currentUser.id,
          notes: notes
        })
        .eq('id', transaction.id);
      
      // Create the actual transaction
      const newTransaction = {
        member_id: selectedMember.id,
        case_id: selectedCase?.id || null,
        amount: transaction.amount,
        transaction_type: 'wallet_funding',
        mpesa_reference: transaction.mpesa_receipt_number,
        description: notes || `M-Pesa payment: ${transaction.sender_name}`,
        payment_method: 'mpesa',
        status: 'completed',
        created_at: new Date().toISOString()
      };
      
      const { data: txData, error: txError } = await supabase
        .from('transactions')
        .insert(newTransaction)
        .select()
        .single();
      
      if (txError) throw txError;
      
      // Update lock to processed
      await supabase
        .from('transaction_credit_locks')
        .update({
          lock_type: 'processed',
          transaction_id: txData.id,
          processed_at: new Date().toISOString()
        })
        .eq('mpesa_receipt_number', transaction.mpesa_receipt_number);
      
      toast.success('Transaction matched successfully');
      onSuccess();
      onOpenChange(false);
      
    } catch (error: any) {
      console.error('Match error:', error);
      toast.error(error.message || 'Failed to match transaction');
    } finally {
      setLoading(false);
    }
  };
  
  const handleIgnore = async () => {
    if (!transaction) return;
    
    setLoading(true);
    try {
      const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      if (!currentUser?.id) {
        throw new Error('Current user could not be determined');
      }
      
      // Record ignore action in audit trail
      await supabase.rpc('record_manual_match', {
        p_wrong_mpesa_transaction_id: transaction.id,
        p_original_member_id: null,
        p_matched_member_id: null,
        p_matched_case_id: null,
        p_reference_type: referenceInfo?.format || 'unknown',
        p_action: 'ignore',
        p_amount: transaction.amount,
        p_mpesa_receipt_number: transaction.mpesa_receipt_number,
        p_reference: transaction.reference,
        p_notes: notes || 'Ignored by admin',
        p_matched_by: currentUser.id
      });
      
      // Update wrong transaction status
      await supabase
        .from('wrong_mpesa_transactions')
        .update({
          status: 'ignored',
          ignored_at: new Date().toISOString(),
          ignored_by: currentUser.id,
          notes: notes
        })
        .eq('id', transaction.id);
      
      toast.success('Transaction ignored');
      onSuccess();
      onOpenChange(false);
      
    } catch (error: any) {
      console.error('Ignore error:', error);
      toast.error('Failed to ignore transaction');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manual Transaction Match</DialogTitle>
          <DialogDescription>
            Match this unmatched M-Pesa transaction to a member and optionally a case.
          </DialogDescription>
        </DialogHeader>
        
        {transaction && (
          <div className="space-y-6">
            {/* Transaction Details */}
            <div className="rounded-lg bg-muted/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Receipt Number</span>
                <Badge variant="outline">{transaction.mpesa_receipt_number}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Amount</span>
                <span className="font-semibold">KES {transaction.amount.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Phone Number</span>
                <span>{transaction.phone_number}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Sender Name</span>
                <span>{transaction.sender_name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Transaction Date</span>
                <span>{new Date(transaction.transaction_date).toLocaleString()}</span>
              </div>
              
              {referenceInfo && (
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Reference</span>
                    <Badge variant={referenceInfo.isValid ? "default" : "destructive"}>
                      {transaction.reference}
                    </Badge>
                  </div>
                  {referenceInfo.format && (
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-sm font-medium">Format</span>
                      <Badge variant="secondary">{referenceInfo.format}</Badge>
                    </div>
                  )}
                  {referenceInfo.error && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-md">
                      <div className="flex items-center gap-2 text-red-700 text-sm">
                        <AlertTriangle className="h-4 w-4" />
                        <span>{referenceInfo.error}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            
            {/* Member Search */}
            <div className="space-y-3">
              <Label htmlFor="member-search">Search Member</Label>
              <div className="flex gap-2">
                <Input
                  id="member-search"
                  placeholder="Search by member number, name, or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                />
                <Button 
                  variant="outline" 
                  onClick={handleSearch}
                  disabled={isSearching}
                >
                  {isSearching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </div>
              
              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className="border rounded-md max-h-40 overflow-y-auto">
                  {searchResults.map((member) => (
                    <div
                      key={member.id}
                      className="p-3 hover:bg-muted cursor-pointer border-b last:border-b-0"
                      onClick={() => handleMemberSelect(member)}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium">
                            {member.first_name} {member.last_name}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Member #{member.member_number}
                          </div>
                          {member.email && (
                            <div className="text-xs text-muted-foreground">{member.email}</div>
                          )}
                        </div>
                        <Badge variant="outline">#{member.member_number}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Selected Member */}
              {selectedMember && (
                <div className="p-3 border rounded-md bg-muted/50">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">
                        {selectedMember.first_name} {selectedMember.last_name}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Member #{selectedMember.member_number}
                      </div>
                      {selectedMember.email && (
                        <div className="text-xs text-muted-foreground">{selectedMember.email}</div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedMember(null)}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              )}
            </div>
            
            {/* Case Selection */}
            {selectedMember && (
              <div className="space-y-3">
                <Label htmlFor="case-select">Select Case (Optional)</Label>
                <Select
                  value={selectedCase?.id || ''}
                  onValueChange={(value) => {
                    const caseObj = selectedMember.cases.find((c: any) => c.id === value);
                    setSelectedCase(caseObj || null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a case" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No case selected</SelectItem>
                    {selectedMember.cases?.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        Case {c.case_number} - {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {selectedCase && (
                  <div className="p-3 border rounded-md bg-muted/50">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium">
                          Case {selectedCase.case_number}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {selectedCase.title}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Status: {selectedCase.status}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedCase(null)}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {/* Notes */}
            <div className="space-y-3">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Add any additional notes about this match..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        )}
        
        <DialogFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          
          <Button
            variant="secondary"
            onClick={handleIgnore}
            disabled={loading}
          >
            Ignore
          </Button>
          
          <Button
            onClick={handleMatch}
            disabled={loading || !selectedMember}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              'Match Transaction'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}