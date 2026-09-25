import * as React from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

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
import { Wallet, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { auditStamp, invokeWithAppToken } from "@/lib/appAuth";
interface WalletFundingDialogProps {
  memberId: string;
  memberName: string;
  memberNumber?: string;
  memberPhone?: string;
  onFundingSuccess: () => void;
  mode?: "stk" | "manual";
}

type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];

const WalletFundingDialog = ({
  memberId,
  memberName,
  memberNumber,
  memberPhone,
  onFundingSuccess,
  mode = "stk",
}: WalletFundingDialogProps) => {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [reference, setReference] = useState("");
  const [accountReference, setAccountReference] = useState("");
  const isStkMode = mode === "stk";

  useEffect(() => {
    if (!open) return;
    if (phone.trim()) return;
    setPhone(String(memberPhone || "").trim());
  }, [open, memberPhone, phone]);

  const handleFundWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate amount
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      toast.error("Invalid amount", {
        description: "Please enter a valid positive number.",
      });
      return;
    }
    
    try {
      setIsSubmitting(true);
      
      // Convert amount to a number
      const numAmount = parseFloat(amount);

      if (isStkMode) {
        const normalizedPhone = String(phone || "").replace(/\D/g, "");
        const memberRef = String(memberNumber || "").trim();
        const effectiveAccountRef = memberRef || memberId;
        if (normalizedPhone.length < 10) {
          throw new Error("Enter a valid M-Pesa phone number.");
        }

        await invokeWithAppToken("api-stk-push", {
          memberId,
          phone: normalizedPhone,
          amount: numAmount,
          accountReference: effectiveAccountRef,
          transactionDesc: `Wallet top-up for ${memberRef || memberId}`,
        });

        toast.success("STK Push sent", {
          description: `Prompt sent to ${normalizedPhone}. Complete payment with M-Pesa PIN.`,
        });
      } else {
        const transactionPayload: TransactionInsert = {
          member_id: memberId,
          amount: numAmount,
          transaction_type: "wallet_funding",
          payment_method: reference ? "mpesa" : "manual",
          status: "completed",
          mpesa_reference: reference || null,
          reference: accountReference || null,
          description: `Manual wallet funding - ${reference || "Added by admin"}`,
          created_at: new Date().toISOString(),
          metadata: {
            source: "manual",
            entry_type: "wallet_funding_dialog_manual",
            mpesa_reference: reference || null,
            account_reference: accountReference || null,
            ...auditStamp(),
          },
        };

        const { error: transactionError } = await (supabase.from("transactions") as any).insert(transactionPayload);
        if (transactionError) throw transactionError;

        toast.success("Wallet funded successfully", {
          description: `KES ${numAmount.toLocaleString()} has been added to ${memberName}'s wallet.`,
        });
      }
      
      // Reset form and close dialog
      setAmount("");
      setPhone("");
      setAccountReference("");
      setOpen(false);
      
      // Call the success callback
      onFundingSuccess();
    } catch (error) {
      console.error("Error funding wallet:", error);
      const message = error instanceof Error ? error.message : "Please try again.";
      const authMismatch =
        /signature verification failed|missing bearer token|unauthorized|jwt/i.test(message);
      toast.error("Failed to fund wallet", {
        description: authMismatch
          ? "Authorization failed. Re-login first. If it persists, backend APP_JWT_SECRET on javanet mlg host does not match app auth secret."
          : message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full" variant={isStkMode ? "default" : "outline"}>
          <Wallet className="mr-2 h-4 w-4" />
          {isStkMode ? "Fund Wallet (STK)" : "Add Funds (Manual)"}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[95vw] sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isStkMode ? "Fund Member Wallet (STK Push)" : "Add Funds Manually"}</DialogTitle>
          <DialogDescription>
            {isStkMode
              ? `Initiate M-Pesa STK push for ${memberName}.`
              : `Record a manual wallet top-up for ${memberName}.`}
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleFundWallet} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (KES)</Label>
            <Input 
              id="amount"
              placeholder="Enter amount" 
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          
          {!isStkMode && (
            <div className="space-y-2">
              <Label htmlFor="reference">Reference (optional)</Label>
              <Input 
                id="reference"
                placeholder="e.g. MPESA reference" 
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          )}

          {isStkMode && (
            <div className="space-y-2">
              <Label htmlFor="phone">M-Pesa Phone *</Label>
              <Input
                id="phone"
                placeholder="07xx xxx xxx or 2547xxxxxxxx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                STK push will be sent to this phone number.
              </p>
            </div>
          )}

          {!isStkMode && (
            <div className="space-y-2">
              <Label htmlFor="accountReference">Account Reference (optional)</Label>
              <Input
                id="accountReference"
                placeholder="e.g. member number / paybill account reference"
                value={accountReference}
                onChange={(e) => setAccountReference(e.target.value)}
              />
            </div>
          )}
          
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isStkMode ? "Send STK Push" : "Add Funds"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default WalletFundingDialog; 
