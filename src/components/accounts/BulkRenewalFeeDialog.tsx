import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { auditStamp } from "@/lib/appAuth";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Users } from "lucide-react";

const bulkRenewalSchema = z.object({
  amount: z
    .string()
    .min(1, { message: "Amount is required" })
    .refine(
      (val) => {
        const num = parseFloat(val);
        return !isNaN(num) && num > 0;
      },
      { message: "Amount must be a positive number" }
    ),
  description: z.string().min(3, { message: "Description is required" }),
});

interface BulkRenewalFeeDialogProps {
  buttonLabel?: string;
  defaultAmount: number;
  onSuccess: () => void;
}

type MemberIdRow = {
  id: string;
};

type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];

const BulkRenewalFeeDialog = ({
  buttonLabel = "Collect Renewal Fee (All Members)",
  defaultAmount,
  onSuccess,
}: BulkRenewalFeeDialogProps) => {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const form = useForm<z.infer<typeof bulkRenewalSchema>>({
    resolver: zodResolver(bulkRenewalSchema),
    defaultValues: {
      amount: defaultAmount.toString(),
      description: "Annual renewal fee payment",
    },
  });

  useEffect(() => {
    form.reset({
      amount: defaultAmount.toString(),
      description: "Annual renewal fee payment",
    });
  }, [defaultAmount, form]);

  useEffect(() => {
    const fetchMemberIds = async () => {
      if (!open) return;

      setIsLoadingMembers(true);
      try {
        const { data, error } = await supabase.from("members").select("id");
        if (error) throw error;

        const ids = (data as MemberIdRow[] | null)?.map((m) => m.id) || [];
        setMemberIds(ids);
      } catch (error) {
        console.error("Error fetching members for bulk renewal:", error);
        toast.error("Failed to load members", {
          description: "Please try again.",
        });
      } finally {
        setIsLoadingMembers(false);
      }
    };

    fetchMemberIds();
  }, [open]);

  const memberCount = useMemo(() => memberIds.length, [memberIds]);

  const handleCollectForAll = async (values: z.infer<typeof bulkRenewalSchema>) => {
    setIsSubmitting(true);
    try {
      const amount = parseFloat(values.amount);
      const transactionAmount = -Math.abs(amount);

      let ids = memberIds;
      if (ids.length === 0) {
        const { data, error } = await supabase.from("members").select("id");
        if (error) throw error;
        ids = (data as MemberIdRow[] | null)?.map((m) => m.id) || [];
      }

      if (ids.length === 0) {
        toast.error("No members found", {
          description: "There are no members to charge.",
        });
        return;
      }

      const createdAt = new Date().toISOString();
      const stamp = auditStamp();
      const rows: TransactionInsert[] = ids.map((id) => ({
        member_id: id,
        amount: transactionAmount,
        transaction_type: "renewal",
        mpesa_reference: null,
        description: values.description,
        created_at: createdAt,
        metadata: {
          source: "bulk_renewal_dialog",
          ...stamp,
        },
      }));

      const batchSize = 500;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { error: insertError } = await (supabase.from("transactions") as any).insert(batch);
        if (insertError) throw insertError;
      }

      // Note: Database trigger automatically updates member wallet_balances

      toast.success("Renewal fees collected", {
        description: `Created ${ids.length.toLocaleString()} renewal fee transactions of KES ${Math.abs(amount).toLocaleString()} each.`,
      });

      setOpen(false);
      form.reset({
        amount: defaultAmount.toString(),
        description: "Annual renewal fee payment",
      });

      onSuccess();
    } catch (error) {
      console.error("Error collecting renewal fees for all members:", error);
      toast.error("Failed to collect renewal fees", {
        description: "Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Users className="mr-2 h-4 w-4" />
          {buttonLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[95vw] sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Collect Renewal Fee for All Members</DialogTitle>
          <DialogDescription>
            This will create a renewal fee transaction for every member.
          </DialogDescription>
        </DialogHeader>

        <div className="text-sm text-muted-foreground">
          {isLoadingMembers ? "Loading members..." : `Members found: ${memberCount.toLocaleString()}`}
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleCollectForAll)} className="space-y-4 mt-4">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (KES)</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || isLoadingMembers}>
                {(isSubmitting || isLoadingMembers) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Collect For All
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default BulkRenewalFeeDialog;
