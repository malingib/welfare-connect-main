import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, CreditCard, CalendarDays, Calendar,
  TrendingUp, BarChart3, UserPlus, Home, Wallet, UserCog, Settings, ChevronRight, ClipboardList
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import DashboardLayout from '@/layouts/DashboardLayout';
import StatsCard from '@/components/StatsCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import MemberCard from '@/components/MemberCard';
import CaseCard from '@/components/CaseCard';
import TransactionList from '@/components/TransactionList';
import { Skeleton } from '@/components/ui/skeleton';
import { Gender, CaseType, Member, Case, Transaction } from '@/lib/types';
import { supabase } from "@/integrations/supabase/client";
import { persistentCache } from '@/lib/cache';
import { canAccessPath, normalizeRole } from '@/lib/rbac';

interface DashboardData {
  totalMembers: number;
  activeCasesCount: number;
  totalContributions: number;
  defaultersCount: number;
  recentMembers: Member[];
  recentActiveCases: Case[];
  recentTransactions: Transaction[];
}

const Dashboard = () => {
  const navigate = useNavigate();
  const currentUserRole = (() => {
    const userStr = localStorage.getItem('currentUser');
    if (!userStr) return null;
    try {
      const user = JSON.parse(userStr);
      return normalizeRole(user?.role as string | undefined);
    } catch {
      return null;
    }
  })();
  const canAccess = (path: string) => canAccessPath(path, currentUserRole);
  const hasCachedDashboard = persistentCache.has('dashboard');
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(!hasCachedDashboard);
  const [data, setData] = useState<DashboardData>(() => {
    // ⚡ Instant load: Start with cached data if it exists
    const cached = persistentCache.get<DashboardData>('dashboard');
    return cached || {
      totalMembers: 0,
      activeCasesCount: 0,
      totalContributions: 0,
      defaultersCount: 0,
      recentMembers: [],
      recentActiveCases: [],
      recentTransactions: [],
    };
  });

  const fetchDashboardData = useCallback(async () => {
    // Only show loading skeletons if we don't have cached data yet
    if (!persistentCache.has('dashboard')) {
      setLoading(true);
    }
    
    try {
      // Fire all queries in parallel — single round trip instead of 5
      const [
        summaryResult,
        membersResult,
        casesResult,
        transactionsResult,
      ] = await Promise.all([
        // 1. Aggregate stats via RPC (single DB function)
        (supabase.rpc as any)('get_dashboard_summary'),
        // 2. Recent members (5 rows, minimal columns)
        supabase
          .from('members')
          .select('id, member_number, name, gender, date_of_birth, national_id_number, phone_number, email_address, residence, next_of_kin, registration_date, is_active, wallet_balance')
          .order('created_at', { ascending: false })
          .limit(5),
        // 3. Active cases (2 rows)
        supabase
          .from('cases')
          .select('id, case_number, case_type, affected_member_id, dependant_id, contribution_per_member, start_date, end_date, is_active, is_finalized, created_at, expected_amount, actual_amount')
          .eq('is_active', true)
          .order('start_date', { ascending: false })
          .limit(2),
        // 4. Recent transactions (5 rows)
        supabase
          .from('transactions')
          .select('id, member_id, case_id, amount, transaction_type, mpesa_reference, description, created_at')
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      // --- Summary Stats ---
      let totalMembers = 0, activeCasesCount = 0, totalContributions = 0, defaultersCount = 0;
      if (!summaryResult.error && summaryResult.data?.length > 0) {
        const s = summaryResult.data[0];
        totalMembers = s.total_members || 0;
        activeCasesCount = s.active_cases || 0;
        totalContributions = Number(s.total_contributions) || 0;
        defaultersCount = s.defaulters_count || 0;
      }
      // Fallback total member count if summary unavailable
      if (!totalMembers) {
        const { count: mc } = await supabase
          .from('members')
          .select('id', { count: 'exact', head: true });
        totalMembers = mc || 0;
      }
      // Fallback active cases count if summary unavailable
      if (!activeCasesCount) {
        const { count: cc } = await supabase
          .from('cases')
          .select('id', { count: 'exact', head: true }).eq('is_active', true);
        activeCasesCount = cc || 0;
      }

      // --- Recent Members ---
      const membersData = membersResult.data || [];
      const recentMembers: Member[] = membersData.map((m: any) => ({
        id: m.id,
        memberNumber: m.member_number,
        name: m.name,
        gender: m.gender as Gender,
        dateOfBirth: m.date_of_birth ? new Date(m.date_of_birth) : new Date(),
        nationalIdNumber: m.national_id_number || '',
        phoneNumber: m.phone_number || '',
        emailAddress: m.email_address || '',
        residence: m.residence || '',
        nextOfKin: m.next_of_kin,
        dependants: [],
        registrationDate: m.registration_date ? new Date(m.registration_date) : new Date(),
        // Use the stored wallet_balance column directly — no need to re-derive from transactions
        walletBalance: Number(m.wallet_balance) || 0,
        isActive: m.is_active,
        status: m.is_active ? 'active' : 'inactive',
      }));

      // --- Active Cases ---
      const casesData = casesResult.data || [];
      // Build a quick lookup for affected member names from the members we already fetched
      const memberLookup: Record<string, Member> = {};
      recentMembers.forEach(m => { memberLookup[m.id] = m; });

      const recentActiveCases: Case[] = casesData.map((c: any) => ({
        id: c.id,
        caseNumber: c.case_number,
        affectedMemberId: c.affected_member_id,
        affectedMember: memberLookup[c.affected_member_id],
        caseType: typeof c.case_type === 'string' ? c.case_type.toLowerCase() : c.case_type,
        dependantId: c.dependant_id,
        contributionPerMember: c.contribution_per_member,
        startDate: c.start_date ? new Date(c.start_date) : new Date(),
        endDate: c.end_date ? new Date(c.end_date) : new Date(),
        expectedAmount: Number(c.expected_amount) || 0,
        actualAmount: Math.max(0, Number(c.actual_amount) || 0),
        isActive: c.is_active,
        isFinalized: c.is_finalized,
        createdAt: c.created_at ? new Date(c.created_at) : new Date(),
      }));

      // --- Transactions ---
      const txData = transactionsResult.data || [];
      // Build member name map from recentMembers only (sufficient for dashboard preview)
      const memberNameMap: Record<string, string> = {};
      recentMembers.forEach(m => { memberNameMap[m.id] = m.name; });

      const recentTransactions: Transaction[] = txData.map((t: any) => ({
        id: t.id,
        memberId: t.member_id,
        caseId: t.case_id,
        amount: t.amount,
        transactionType: t.transaction_type as Transaction['transactionType'],
        mpesaReference: t.mpesa_reference,
        createdAt: t.created_at ? new Date(t.created_at) : new Date(),
        description: t.description,
        senderName: memberNameMap[t.member_id || ''] || 'Unknown',
      }));

      const newData = { totalMembers, activeCasesCount, totalContributions, defaultersCount, recentMembers, recentActiveCases, recentTransactions };
      
      // Update state and save to fast persistence cache (5 min TTL)
      setData(newData);
      persistentCache.set('dashboard', newData, 5 * 60 * 1000);
      
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const adminLinks = [
    { icon: <Home className="w-5 h-5" />, label: "Dashboard", href: "/dashboard" },
    { icon: <Users className="w-5 h-5" />, label: "Members", href: "/members" },
    { icon: <ClipboardList className="w-5 h-5" />, label: "Applications", href: "/applications" },
    { icon: <Calendar className="w-5 h-5" />, label: "Cases", href: "/cases" },
    { icon: <CreditCard className="w-5 h-5" />, label: "Transactions", href: "/transactions" },
    { icon: <Wallet className="w-5 h-5" />, label: "Accounts", href: "/accounts" },
    { icon: <BarChart3 className="w-5 h-5" />, label: "Reports", href: "/reports" },
    { icon: <UserCog className="w-5 h-5" />, label: "Users", href: "/users" },
    { icon: <Settings className="w-5 h-5" />, label: "Settings", href: "/settings" },
  ].filter((item) => canAccess(item.href));

  const StatSkeleton = () => (
    <div className="border rounded-xl p-4 space-y-3 shadow-md">
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );

  return (
    <DashboardLayout customLinks={adminLinks}>
      <div className="space-y-6 sm:space-y-8 bg-slate-50/50 min-h-screen pb-12">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-2">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap">
            <div className="hidden lg:flex items-center gap-2 bg-white px-3 sm:px-4 py-2 rounded-xl shadow-sm border border-slate-100 whitespace-nowrap">
              <Calendar className="h-3 w-3 sm:h-4 sm:w-4 text-primary flex-shrink-0" />
              <span className="text-xs sm:text-sm font-semibold text-slate-700">{format(new Date(), 'MMM d, yyyy')}</span>
            </div>
            {canAccess('/members/new') && (
              <Button className="shadow-sm hover:shadow-md transition-all font-semibold rounded-xl px-3 sm:px-4 md:px-6 h-10 sm:h-auto text-xs sm:text-sm" onClick={() => navigate('/members/new')}>
                <UserPlus className="h-4 w-4 mr-2" />
                Add Member
              </Button>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-3 sm:gap-4 md:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {loading ? (
            <>
              <StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton />
            </>
          ) : (
            <>
              <StatsCard
                title="Total Members"
                value={data.totalMembers.toLocaleString()}
                icon={<Users className="h-5 w-5" />}
              />
              <StatsCard
                title="Active Cases"
                value={data.activeCasesCount}
                icon={<CalendarDays className="h-5 w-5" />}
                description="Currently open cases"
              />
              <StatsCard
                title="Total Contributions"
                value={`KES ${data.totalContributions.toLocaleString()}`}
                icon={<CreditCard className="h-5 w-5" />}
              />
              <StatsCard
                title="Defaulters"
                value={data.defaultersCount}
                icon={<TrendingUp className="h-5 w-5" />}
              />
            </>
          )}
        </div>

        <div className="grid gap-6 sm:gap-8 lg:grid-cols-3">
          {/* Main Chart / Recent Transactions */}
          <div className="lg:col-span-2 space-y-6 sm:space-y-8">
            {canAccess('/transactions') && (
              <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden">
              <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-50 px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 gap-3 sm:gap-0">
                <div className="min-w-0">
                  <CardTitle className="text-base sm:text-lg font-bold text-slate-900">Recent Transactions</CardTitle>
                  <CardDescription className="text-xs sm:text-sm mt-1">Latest financial activity</CardDescription>
                </div>
                <Button variant="ghost" size="sm" className="text-primary font-bold hover:bg-primary/5 text-xs sm:text-sm whitespace-nowrap" onClick={() => navigate('/transactions')}>
                  View All
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-slate-50">
                  {loading ? (
                    [...Array(5)].map((_, i) => (
                      <div key={i} className="p-3 sm:p-4 md:p-6 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                          <Skeleton className="h-8 w-8 sm:h-10 sm:w-10 rounded-full flex-shrink-0" />
                          <div className="space-y-2 min-w-0 flex-1">
                            <Skeleton className="h-3 w-32" />
                            <Skeleton className="h-2 w-24" />
                          </div>
                        </div>
                        <Skeleton className="h-3 w-16 flex-shrink-0" />
                      </div>
                    ))
                  ) : (
                    data.recentTransactions.map((tx) => (
                      <div key={tx.id} className="p-3 sm:p-4 md:p-6 flex items-center justify-between gap-2 hover:bg-slate-50/50 transition-colors group cursor-pointer" onClick={() => navigate('/transactions')}>
                        <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                          <div className={cn(
                            "h-8 w-8 sm:h-10 sm:w-10 rounded-full flex items-center justify-center transition-colors shadow-sm border border-slate-100 flex-shrink-0",
                            tx.amount > 0 ? "bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white" : "bg-rose-50 text-rose-600 group-hover:bg-rose-600 group-hover:text-white"
                          )}>
                            {tx.amount > 0 ? <CreditCard className="h-4 w-4 sm:h-5 sm:w-5" /> : <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs sm:text-sm font-bold text-slate-900 leading-tight break-words sm:truncate">{tx.description || 'Transaction'}</p>
                            <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 mt-0.5 text-xs">
                              <p className="text-[10px] sm:text-xs text-slate-500 font-medium whitespace-nowrap">{format(tx.createdAt, 'MMM d')}</p>
                              <span className="text-[8px] text-slate-300">•</span>
                              <p className="text-[10px] sm:text-xs text-slate-500 font-medium break-words sm:truncate">{tx.senderName}</p>
                            </div>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 min-w-[78px] sm:min-w-[110px] ml-1">
                          <p className={cn(
                            "text-xs sm:text-sm font-bold tracking-tight leading-tight whitespace-nowrap",
                            tx.amount > 0 ? "text-emerald-600" : "text-rose-600"
                          )}>
                            {tx.amount > 0 ? '+' : '-'}KES {Math.abs(tx.amount).toLocaleString()}
                          </p>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mt-0.5 leading-tight break-words">
                            {tx.transactionType.replace(/_/g, ' ')}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar Area: Recent Members */}
          <div className="space-y-6 sm:space-y-8">
            {canAccess('/members') && (
              <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden">
              <CardHeader className="border-b border-slate-50 px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base sm:text-lg font-bold text-slate-900">New Members</CardTitle>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-slate-100 flex-shrink-0" onClick={() => navigate('/members')}>
                    <Settings className="h-4 w-4 text-slate-400" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-3 sm:px-4 md:px-6 lg:px-8 py-4">
                <div className="space-y-1">
                  {loading ? (
                    [...Array(4)].map((_, i) => (
                      <div key={i} className="flex items-center gap-2 sm:gap-3 py-2 sm:py-3">
                        <Skeleton className="h-8 w-8 sm:h-10 sm:w-10 rounded-full flex-shrink-0" />
                        <div className="flex-1 space-y-1 min-w-0">
                          <Skeleton className="h-3 w-24" />
                          <Skeleton className="h-2 w-32" />
                        </div>
                      </div>
                    ))
                  ) : (
                    data.recentMembers.map((member) => (
                      <div 
                        key={member.id} 
                        className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group min-h-[44px] sm:min-h-[50px]"
                        onClick={() => navigate(`/members/${member.id}`)}
                      >
                        <div className="relative flex-shrink-0">
                          <Avatar className="h-8 w-8 sm:h-10 sm:w-10 border-2 border-slate-100 transition-all group-hover:scale-110">
                            <AvatarFallback className="bg-primary/5 text-primary text-[9px] sm:text-xs font-bold uppercase">
                              {member.name.substring(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          {member.isActive && (
                            <span className="absolute bottom-0 right-0 h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full bg-emerald-500 border-2 border-white" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs sm:text-sm font-bold text-slate-900 leading-tight break-words sm:truncate group-hover:text-primary transition-colors">{member.name}</p>
                          <p className="text-[9px] sm:text-[11px] text-slate-400 font-medium leading-tight break-words sm:truncate mt-0.5">{member.emailAddress || member.phoneNumber}</p>
                        </div>
                        <div className="hidden sm:flex h-7 w-7 rounded-lg bg-slate-50 items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <ChevronRight className="h-3 w-3 sm:h-4 sm:w-4 text-slate-400" />
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <Button variant="outline" className="w-full mt-3 sm:mt-4 h-10 sm:h-11 rounded-xl border-slate-100 text-slate-600 text-xs sm:text-sm font-semibold hover:bg-slate-50" onClick={() => navigate('/members')}>
                  View All People
                </Button>
              </CardContent>
              </Card>
            )}

            {/* Quick Actions / Info Card */}
            <div className="bg-primary rounded-2xl p-4 sm:p-6 md:p-8 text-white shadow-lg shadow-primary/20 relative overflow-hidden group">
              <div className="relative z-10">
                <h3 className="font-bold text-base sm:text-lg md:text-xl mb-2">Welcome!</h3>
                <p className="text-primary-foreground/80 text-xs sm:text-sm mb-3 sm:mb-4 leading-relaxed">Manage your community welfare group efficiently with our comprehensive platform.</p>
                {canAccess('/reports') && (
                  <Button variant="secondary" size="sm" className="w-full sm:w-auto rounded-lg font-bold shadow-sm text-xs sm:text-sm h-9 sm:h-10" onClick={() => navigate('/reports')}>
                    Open Reports
                  </Button>
                )}
              </div>
              {/* Decorative circle */}
              <div className="absolute -right-6 -bottom-6 h-20 w-20 sm:h-24 sm:w-24 rounded-full bg-white/10 blur-xl group-hover:scale-150 transition-transform duration-500" />
            </div>
          </div>
        </div>

        {/* Bottom Section: Active Cases */}
        {canAccess('/cases') && (
          <div className="space-y-4 md:space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Active Cases</h2>
            <Button variant="link" className="text-primary font-bold text-xs sm:text-sm h-9" onClick={() => navigate('/cases')}>
              Explore Cases
            </Button>
          </div>
          <div className="grid gap-4 md:gap-6 grid-cols-1 md:grid-cols-2">
            {loading ? (
              [...Array(2)].map((_, i) => <Skeleton key={i} className="h-40 md:h-48 w-full rounded-2xl shadow-sm" />)
            ) : (
              data.recentActiveCases.map((caseItem) => (
                <CaseCard
                  key={caseItem.id}
                  case={caseItem}
                  onClick={() => navigate(`/cases/${caseItem.id}`)}
                />
              ))
            )}
          </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
