import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "@/layouts/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wallet, CreditCard, User, Calendar, Phone, Mail, Home, FileText, ArrowRight, Users } from "lucide-react";
import { memberLinks, memberLogout } from "./memberLinks";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

import { toast } from "@/components/ui/use-toast";
import { invokeWithAppToken } from "@/lib/appAuth";
import { walletRowDelta } from "@/lib/walletEffect";

const MemberDashboard = () => {
  const [member, setMember] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);

  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [totalDue, setTotalDue] = useState<{ unpaid_case_total: number; reinstatement_penalty_due: number; total_due: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fundWalletOpen, setFundWalletOpen] = useState(false);
  const [stkPhone, setStkPhone] = useState("");
  const [stkAmount, setStkAmount] = useState("");
  const [stkReference, setStkReference] = useState("");
  const [isInitiatingStk, setIsInitiatingStk] = useState(false);
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [pinData, setPinData] = useState({ oldPin: "", newPin: "", confirmPin: "" });
  const [isChangingPin, setIsChangingPin] = useState(false);
  const navigate = useNavigate();

  const fetchData = async () => {
    const member_id = localStorage.getItem("member_member_id");
    if (!member_id) {
      navigate("/member/login");
      return;
    }

    try {
      const summary = await invokeWithAppToken<any>("api-member-summary", {
        member_id,
      });
      const memberData = summary?.member;
      const allTransData = summary?.recent_transactions || [];

      setMember(memberData);
      setTransactions(allTransData || []);
      // Prefer stored wallet_balance maintained by DB triggers; fallback to calculated sum
      const balanceFromMember = Number(memberData?.wallet_balance) || 0;
      const balanceFromTx = (allTransData || []).reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      setWalletBalance(Number.isFinite(balanceFromMember) ? balanceFromMember : balanceFromTx);
      if (summary?.total_due) {
        setTotalDue({
          unpaid_case_total: Number(summary.total_due.unpaid_case_total || 0),
          reinstatement_penalty_due: Number(summary.total_due.reinstatement_penalty_due || 0),
          total_due: Number(summary.total_due.total_due || 0),
        });
      } else {
        setTotalDue(null);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
      if (error instanceof Error && /session expired/i.test(error.message)) {
        window.location.href = "/member/login";
        return;
      }
      const message = error instanceof Error ? error.message : "Failed to load member data. Please try again.";
      toast({
        variant: "destructive",
        title: "Error",
        description: message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [navigate]);

  useEffect(() => {
    if (!member) return;
    const memberPhone = String(member.phone_number || "").trim();
    const memberRef = String(member.member_number || "").trim();
    setStkPhone(memberPhone);
    setStkReference(memberRef);
  }, [member]);

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      setIsSearching(true);
      const { data, error } = await supabase
        .from('members')
        .select('id, name, member_number')
        .or(`name.ilike.%${query}%,member_number.ilike.%${query}%`)
        .neq('id', member?.id) // Exclude current member
        .limit(5);

      if (error) throw error;
      setSearchResults(data || []);
    } catch (error) {
      console.error('Error searching members:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to search for members. Please try again.",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleTransfer = async () => {
    if (!selectedMember || !transferAmount) return;
    
    const numAmount = parseFloat(transferAmount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast({
        variant: "destructive",
        title: "Invalid amount",
        description: "Please enter a valid positive number.",
      });
      return;
    }

    if (numAmount > walletBalance) {
      toast({
        variant: "destructive",
        title: "Insufficient funds",
        description: `You only have KES ${walletBalance.toLocaleString()} available.`,
      });
      return;
    }

    try {
      setIsSubmitting(true);
      
      const referenceValue = `Transfer to ${selectedMember.member_number}`;
      const rpcArgs = {
        from_member_id: member.id,
        to_member_id: selectedMember.id,
        amount: numAmount,
        reference: referenceValue,
      } as any;

      const { error: transferError } = await (supabase.rpc as any)('transfer_funds', rpcArgs);
      if (transferError) throw transferError;

      toast({
        title: "Transfer successful",
        description: `KES ${numAmount.toLocaleString()} has been transferred to ${selectedMember.name}.`,
      });

      // Refresh data
      await fetchData();
      setTransferOpen(false);
      setTransferAmount("");
      setSearchQuery("");
      setSelectedMember(null);
      setSearchResults([]);
      
    } catch (error) {
      console.error('Transfer error:', error);
      toast({
        variant: "destructive",
        title: "Transfer failed",
        description: error instanceof Error ? error.message : "An error occurred during the transfer.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangePin = async () => {
    if (pinData.newPin !== pinData.confirmPin) {
      toast({
        variant: "destructive",
        title: "PIN mismatch",
        description: "New PIN and confirmation PIN do not match.",
      });
      return;
    }
    
    if (pinData.newPin.length !== 6) {
      toast({
        variant: "destructive",
        title: "Invalid PIN",
        description: "PIN must be 6 digits.",
      });
      return;
    }

    try {
      setIsChangingPin(true);
      const { data, error } = await (supabase.rpc as any)('update_member_pin', {
        p_member_id: member.id,
        p_old_pin: pinData.oldPin,
        p_new_pin: pinData.newPin
      });

      if (error) throw error;
      
      const response = data as any;
      if (!response.success) {
        throw new Error(response.message);
      }

      toast({
        title: "Success",
        description: "Your login PIN has been updated successfully.",
      });
      
      setChangePinOpen(false);
      setPinData({ oldPin: "", newPin: "", confirmPin: "" });
      
    } catch (error) {
      console.error('Change PIN error:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update PIN.",
      });
    } finally {
      setIsChangingPin(false);
    }
  };

  const handleFundWalletStk = async () => {
    if (!member?.id) return;
    const parsedAmount = Number(stkAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast({
        variant: "destructive",
        title: "Invalid amount",
        description: "Enter a valid amount greater than zero.",
      });
      return;
    }

    const phone = String(stkPhone || "").replace(/\D/g, "");
    if (phone.length < 10) {
      toast({
        variant: "destructive",
        title: "Invalid phone number",
        description: "Enter a valid M-Pesa phone number.",
      });
      return;
    }

    try {
      setIsInitiatingStk(true);
      await invokeWithAppToken("api-stk-push", {
        memberId: member.id,
        phone,
        amount: parsedAmount,
        accountReference: stkReference || member.member_number || member.id,
        transactionDesc: `Wallet top-up for ${member.member_number || member.id}`,
      });

      toast({
        title: "STK Push sent",
        description: "Check your phone and complete payment with your M-Pesa PIN.",
      });

      setFundWalletOpen(false);
      setStkAmount("");
      await fetchData();
    } catch (error) {
      console.error("STK initiation failed:", error);
      toast({
        variant: "destructive",
        title: "STK Push failed",
        description: error instanceof Error ? error.message : "Could not initiate STK Push.",
      });
    } finally {
      setIsInitiatingStk(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout customLinks={memberLinks} customLogout={() => memberLogout(navigate)}>
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-10 w-24" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-2/3" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-10 w-40" />
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader className="pb-2">
              <Skeleton className="h-6 w-44" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  if (!member) {
    return (
      <DashboardLayout customLinks={memberLinks} customLogout={() => memberLogout(navigate)}>
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <div className="h-20 w-20 rounded-full bg-red-100 flex items-center justify-center">
            <User className="h-10 w-10 text-red-600" />
          </div>
          <p className="text-xl font-medium">Member not found</p>
          <p className="text-muted-foreground text-center max-w-md">
            We couldn't find your member information. Please contact an administrator if this problem persists.
          </p>
          <Button onClick={() => memberLogout(navigate)} variant="destructive">
            Logout
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout customLinks={memberLinks} customLogout={() => memberLogout(navigate)}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Welcome, {member.name}</h1>
            <p className="text-muted-foreground">Member Dashboard</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/member/transactions')}>
              <CreditCard className="h-4 w-4 mr-2" />
              View Transactions
            </Button>
            <Button onClick={() => memberLogout(navigate)} variant="destructive">
              Logout
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="overflow-hidden">
            <CardHeader className="bg-primary/5 pb-2">
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  Profile Information
                </CardTitle>
                <Badge variant="outline" className="capitalize">
                  {String(member.status || (member.is_active ? "active" : "inactive")).replace(/_/g, " ")}
                </Badge>
              </div>
              <CardDescription>Your personal information</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground mt-1" />
                  <div>
                    <div className="text-sm text-muted-foreground">Member Number</div>
                    <div className="font-medium">{member.member_number}</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground mt-1" />
                  <div>
                    <div className="text-sm text-muted-foreground">Email</div>
                    <div className="font-medium">{member.email_address || "Not provided"}</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground mt-1" />
                  <div>
                    <div className="text-sm text-muted-foreground">Phone</div>
                    <div className="font-medium">{member.phone_number || "Not provided"}</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Home className="h-4 w-4 text-muted-foreground mt-1" />
                  <div>
                    <div className="text-sm text-muted-foreground">Residence</div>
                    <div className="font-medium">{member.residence}</div>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t">
                <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/member/dependants')}>
                  <Users className="h-4 w-4 mr-2" />
                  Manage Dependants
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="bg-primary/5 pb-2">
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-primary" />
                  Wallet Balance
                </CardTitle>
                <div className="flex gap-2">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => navigate('/member/transactions')}
                    className="text-xs"
                  >
                    View History
                  </Button>
                </div>
              </div>
              <CardDescription>Your current account balance</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="text-3xl font-bold text-green-600">
                KES {walletBalance.toLocaleString()}
              </div>
              {totalDue && totalDue.total_due > 0 && (
                <div className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Unpaid cases</span>
                    <span className="font-semibold">KES {totalDue.unpaid_case_total.toLocaleString()}</span>
                  </div>
                  {totalDue.reinstatement_penalty_due > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Reinstatement penalty</span>
                      <span className="font-semibold text-amber-700">KES {totalDue.reinstatement_penalty_due.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs font-bold border-t border-amber-200 pt-1 mt-1">
                    <span>Total Due</span>
                    <span>KES {totalDue.total_due.toLocaleString()}</span>
                  </div>
                </div>
              )}
              <div className="text-xs text-muted-foreground mt-2">
                Last updated: {new Date().toLocaleDateString()}
              </div>

              {String(member.status || "").toLowerCase() === "inactive" && (
                <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  Inactive due to default discipline. You can still settle case obligations (including closed cases) as late payments. Wallet top-ups automatically pay down the KES 300 reinstatement penalty first.
                </div>
              )}

              <Dialog open={fundWalletOpen} onOpenChange={setFundWalletOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="w-full">
                    <Wallet className="h-4 w-4 mr-2" />
                    Fund Wallet (M-Pesa)
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Fund Wallet via STK Push</DialogTitle>
                    <DialogDescription>
                      Enter amount and confirm the M-Pesa prompt on your phone.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="stk-phone">Phone Number</Label>
                      <Input
                        id="stk-phone"
                        placeholder="07xx xxx xxx or 2547xxxxxxxx"
                        value={stkPhone}
                        onChange={(e) => setStkPhone(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="stk-amount">Amount (KES)</Label>
                      <Input
                        id="stk-amount"
                        type="number"
                        min="1"
                        step="1"
                        placeholder="Enter amount"
                        value={stkAmount}
                        onChange={(e) => setStkAmount(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="stk-reference">Account Reference</Label>
                      <Input
                        id="stk-reference"
                        placeholder="e.g. member number"
                        value={stkReference}
                        onChange={(e) => setStkReference(e.target.value)}
                      />
                    </div>
                  </div>

                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setFundWalletOpen(false)}
                      disabled={isInitiatingStk}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleFundWalletStk}
                      disabled={isInitiatingStk || !stkAmount || !stkPhone}
                    >
                      {isInitiatingStk ? "Sending STK..." : "Send STK Push"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full">
                    <ArrowRight className="h-4 w-4 mr-2" />
                    Transfer to Member
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Transfer Funds</DialogTitle>
                    <DialogDescription>
                      Transfer funds to another member
                    </DialogDescription>
                  </DialogHeader>
                  
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Search Member</Label>
                      <div className="relative">
                        <Input
                          placeholder="Search by name or member number"
                          value={searchQuery}
                          onChange={(e) => {
                            const value = e.target.value;
                            setSearchQuery(value);
                            if (value) {
                              handleSearch(value);
                            } else {
                              setSearchResults([]);
                              setSelectedMember(null);
                            }
                          }}
                          className="pr-10"
                        />
                        {isSearching && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                          </div>
                        )}
                      </div>
                      
                      {searchResults.length > 0 && !selectedMember && (
                        <div className="border rounded-md mt-1 max-h-40 overflow-y-auto">
                          {searchResults.map((member) => (
                            <div 
                              key={member.id}
                              className="p-2 hover:bg-gray-100 cursor-pointer"
                              onClick={() => {
                                setSelectedMember(member);
                                setSearchQuery(`${member.name} (${member.member_number})`);
                                setSearchResults([]);
                              }}
                            >
                              <div className="font-medium">{member.name}</div>
                              <div className="text-sm text-muted-foreground">#{member.member_number}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {selectedMember && (
                        <div className="mt-2 p-3 bg-gray-50 rounded-md">
                          <div className="flex items-center">
                            <User className="h-4 w-4 mr-2 text-gray-500" />
                            <div>
                              <div className="font-medium">{selectedMember.name}</div>
                              <div className="text-sm text-gray-500">#{selectedMember.member_number}</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="amount">Amount (KES)</Label>
                      <Input
                        id="amount"
                        type="number"
                        min="1"
                        step="0.01"
                        placeholder="Enter amount to transfer"
                        value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)}
                        disabled={!selectedMember}
                      />
                      <p className="text-xs text-muted-foreground">
                        Available: KES {walletBalance.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  
                  <DialogFooter>
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setTransferOpen(false);
                        setSearchQuery("");
                        setSelectedMember(null);
                        setTransferAmount("");
                      }}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleTransfer}
                      disabled={!selectedMember || !transferAmount || isSubmitting}
                    >
                      {isSubmitting ? 'Transferring...' : 'Transfer'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>


            </CardContent>
          </Card>
          
          <Card className="overflow-hidden border-amber-100 bg-amber-50/10">
            <CardHeader className="bg-amber-100/50 pb-2">
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-amber-600" />
                Security Settings
              </CardTitle>
              <CardDescription>Manage your access credentials</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Keep your 6-digit PIN private. Change it regularly for better security.
                </p>
                
                <Dialog open={changePinOpen} onOpenChange={setChangePinOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full bg-white">
                      Change Login PIN
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Change Secret PIN</DialogTitle>
                      <DialogDescription>
                        Update your 6-digit access PIN
                      </DialogDescription>
                    </DialogHeader>
                    
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Current PIN</Label>
                        <Input
                          type="password"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="••••••"
                          value={pinData.oldPin}
                          onChange={(e) => setPinData({ ...pinData, oldPin: e.target.value.replace(/\D/g, '') })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>New 6-Digit PIN</Label>
                        <Input
                          type="password"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="••••••"
                          value={pinData.newPin}
                          onChange={(e) => setPinData({ ...pinData, newPin: e.target.value.replace(/\D/g, '') })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Confirm New PIN</Label>
                        <Input
                          type="password"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="••••••"
                          value={pinData.confirmPin}
                          onChange={(e) => setPinData({ ...pinData, confirmPin: e.target.value.replace(/\D/g, '') })}
                        />
                      </div>
                    </div>
                    
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setChangePinOpen(false)}>Cancel</Button>
                      <Button onClick={handleChangePin} disabled={isChangingPin || pinData.newPin.length !== 6}>
                        {isChangingPin ? "Updating..." : "Update PIN"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="bg-primary/5 pb-2">
            <div className="flex justify-between items-center">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Recent Transactions
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/member/transactions')}
                className="text-xs"
              >
                View All
              </Button>
            </div>
            <CardDescription>Your most recent transactions</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {transactions.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                No transactions found. Start contributing to see your transactions here.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b">
                      <th className="py-3 px-2 font-medium">Date</th>
                      <th className="py-3 px-2 font-medium">Amount</th>
                      <th className="py-3 px-2 font-medium">Type</th>
                      <th className="py-3 px-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.slice(0, 5).map((t) => (
                      <tr key={t.id} className="border-b border-border/30 hover:bg-muted/30">
                        <td className="py-3 px-2">{new Date(t.created_at).toLocaleDateString()}</td>
                        {(() => {
                          const delta = walletRowDelta(t.transaction_type, t.amount, t.status);
                          const pending = delta === null;
                          const reversed = String(t.status || "").toLowerCase() === "reversed";
                          const pos = delta !== null && delta > 0;
                          const neg = delta !== null && delta < 0;
                          return (
                            <td className={`py-3 px-2 font-medium ${pending ? 'text-muted-foreground' : pos ? 'text-green-600' : neg ? 'text-red-600' : 'text-muted-foreground'}`}>
                              {pending ? (reversed ? "Reversed" : "Pending") : `${pos ? '+' : neg ? '-' : ''} KES ${Math.abs(delta ?? 0).toLocaleString()}`}
                            </td>
                          );
                        })()}
                        <td className="py-3 px-2">{t.transaction_type}</td>
                        <td className="py-3 px-2">{t.description || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default MemberDashboard;
