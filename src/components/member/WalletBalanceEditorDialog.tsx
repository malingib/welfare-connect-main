import * as React from "react";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { auditStamp } from "@/lib/appAuth";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Edit3, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";

interface WalletBalanceEditorDialogProps {
  memberId: string;
  memberName: string;
  currentBalance: number;
  onBalanceUpdate: () => void;
}

const WalletBalanceEditorDialog = ({
  memberId,
  memberName,
  currentBalance,
  onBalanceUpdate,
}: WalletBalanceEditorDialogProps) => {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newBalance, setNewBalance] = useState("");
  const [reason, setReason] = useState("");

  const handleUpdateBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newBalance === "" || isNaN(parseFloat(newBalance))) {
      toast.error("Invalid balance", {
        description: "Please enter a valid number.",
      });
      return;
    }
    
    try {
      setIsSubmitting(true);
      
      const numericBalance = parseFloat(newBalance);
      const difference = numericBalance - currentBalance;
      const isIncrease = difference >= 0;

      // Choose transaction type to align with existing accounting rules:
      // - Positive diff: wallet_funding (adds to balance)
      // - Negative diff: wallet_manual_adjustment (wallet debit NOT counted as arrears/case payment)
      const txType = isIncrease ? "wallet_funding" : "wallet_manual_adjustment";
      const txAmount = isIncrease ? difference : Math.abs(difference);

      // Insert adjustment transaction; DB trigger will recalc wallet_balance
      const { error: txError } = await (supabase.from("transactions").insert({
        member_id: memberId,
        amount: txAmount,
        transaction_type: txType,
        status: "completed",
        description: reason ? `Balance adjustment - ${reason}` : "Manual balance adjustment",
        reference: "balance_edit",
        created_at: new Date().toISOString(),
        metadata: {
          source: "wallet_balance_editor",
          previous_balance: currentBalance,
          new_balance: numericBalance,
          reason: reason || null,
          ...auditStamp(),
        },
      }) as any);

      if (txError) throw txError;

      const direction = difference >= 0 ? "increased" : "decreased";
      
      toast.success("Wallet balance updated successfully", {
        description: `KES ${Math.abs(difference).toLocaleString()} ${direction}. New balance: KES ${numericBalance.toLocaleString()}`,
      });
      
      setNewBalance("");
      setReason("");
      setOpen(false);
      
      onBalanceUpdate();
    } catch (error) {
      console.error("Error updating wallet balance:", error);
      toast.error("Failed to update wallet balance", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setNewBalance(currentBalance.toString());
    }
    setOpen(isOpen);
  };

  const difference = newBalance ? parseFloat(newBalance) - currentBalance : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full mt-2">
          <Edit3 className="mr-2 h-4 w-4" />
          Edit Balance
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[95vw] sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Wallet Balance</DialogTitle>
          <DialogDescription>
            Manually update {memberName}&apos;s wallet balance. Use this for corrections or adjustments.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleUpdateBalance} className="space-y-4">
          <div className="space-y-2">
            <Label>Current Balance</Label>
            <div className="text-lg font-medium text-muted-foreground">
              KES {currentBalance.toLocaleString()}
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="newBalance">New Balance (KES)</Label>
            <Input 
              id="newBalance"
              type="number"
              step="0.01"
              placeholder="Enter new balance" 
              value={newBalance}
              onChange={(e) => setNewBalance(e.target.value)}
            />
          </div>

          {difference !== 0 && (
            <div className={`text-sm font-medium ${difference > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {difference > 0 ? '+' : ''}KES {difference.toLocaleString()} ({difference > 0 ? 'increase' : 'decrease'})
            </div>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Input 
              id="reason"
              placeholder="e.g. Manual correction, audit adjustment" 
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || parseFloat(newBalance) === currentBalance}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Balance
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default WalletBalanceEditorDialog;
