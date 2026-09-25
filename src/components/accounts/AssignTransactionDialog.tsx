import { useState, useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { auditStamp } from "@/lib/appAuth";
import type { Database } from "@/integrations/supabase/types";
import { Transaction } from "@/lib/types";

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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckIcon, Loader2, ChevronsUpDown, User } from "lucide-react";
import { cn } from "@/lib/utils";

// Form schema validation
const assignSchema = z.object({
  memberId: z.string().min(1, { message: "Member is required" }),
  description: z.string().min(3, { message: "Description is required" }),
});

interface AssignTransactionDialogProps {
  transaction: Transaction;
  onSuccess: () => void;
}

type Member = {
  id: string;
  name: string;
  member_number: string;
};

type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];

const AssignTransactionDialog = ({
  transaction,
  onSuccess,
}: AssignTransactionDialogProps) => {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);

  useEffect(() => {
    const fetchMembers = async () => {
      const { data, error } = await supabase
        .from("members")
        .select("id, name, member_number")
        .order("name");

      if (error) {
        console.error("Error fetching members:", error);
        toast.error("Failed to load members", {
          description: "Please try again.",
        });
        return;
      }

      setMembers(data || []);
    };

    if (open) {
      fetchMembers();
    }
  }, [open]);

  const form = useForm<z.infer<typeof assignSchema>>({
    resolver: zodResolver(assignSchema),
    defaultValues: {
      memberId: "",
      description: `Assigned from suspense account - Ref: ${transaction.mpesaReference || "N/A"}`,
    },
  });

  const handleAssignTransaction = async (values: z.infer<typeof assignSchema>) => {
    try {
      setIsSubmitting(true);

      // 1. Create a new transaction for the member
      // Note: A database trigger automatically updates the member's wallet_balance
      const transactionPayload: TransactionInsert = {
        member_id: values.memberId,
        amount: transaction.amount,
        transaction_type: "wallet_funding",
        mpesa_reference: transaction.mpesaReference || null,
        description: values.description,
        created_at: new Date().toISOString(),
        metadata: {
          source: "suspense_assign",
          ...auditStamp(),
        },
      };

      const { error: transactionError } = await (supabase.from("transactions") as any).insert(
        transactionPayload
      );

      if (transactionError) throw transactionError;

      // 4. Mark the suspense transaction as assigned by changing its status or removing it
      // This will depend on your database structure. Here is a sample approach:
      const { error: deleteError } = await supabase
        .from("transactions")
        .delete()
        .eq("id", transaction.id);

      if (deleteError) throw deleteError;

      toast.success("Transaction assigned successfully", {
        description: `KES ${transaction.amount.toLocaleString()} has been assigned to the selected member.`,
      });

      // Reset form and close dialog
      form.reset();
      setOpen(false);
      onSuccess();
    } catch (error) {
      console.error("Error assigning transaction:", error);
      toast.error("Failed to assign transaction", {
        description: "Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <User className="h-4 w-4 mr-2" />
          Assign to Member
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[95vw] sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Assign Transaction to Member</DialogTitle>
          <DialogDescription>
            Assign this suspense transaction (KES {transaction.amount.toLocaleString()}) to a member's wallet.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleAssignTransaction)} className="space-y-6 mt-4">
            <FormField
              control={form.control}
              name="memberId"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Select Member</FormLabel>
                  <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={popoverOpen}
                          className={cn(
                            "w-full justify-between",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value
                            ? members.find((member) => member.id === field.value)?.name || "Select member"
                            : "Select member"}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[95vw] sm:w-[400px] p-0">
                      <Command>
                        <CommandInput placeholder="Search members..." />
                        <CommandEmpty>No member found.</CommandEmpty>
                        <CommandGroup className="max-h-[300px] overflow-y-auto">
                          {members.map((member) => (
                            <CommandItem
                              key={member.id}
                              value={member.id}
                              onSelect={() => {
                                form.setValue("memberId", member.id);
                                setPopoverOpen(false);
                              }}
                            >
                              <CheckIcon
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  member.id === field.value ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {member.name} ({member.member_number})
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </Command>
                    </PopoverContent>
                  </Popover>
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

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Assign Transaction
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default AssignTransactionDialog; 
