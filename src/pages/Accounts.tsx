import { useState } from 'react';
import DashboardLayout from '@/layouts/DashboardLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import RegistrationAccount from '@/components/accounts/RegistrationAccount';
import RenewalAccount from '@/components/accounts/RenewalAccount';
import PenaltyAccount from '@/components/accounts/PenaltyAccount';
import ArrearsAccount from '@/components/accounts/ArrearsAccount';
import LatePaymentsAccount from '@/components/accounts/LatePaymentsAccount';
import { SuspenseManagement } from '@/components/accounts/SuspenseManagement';

const Accounts = () => {
  const [activeTab, setActiveTab] = useState('registration');

  return (
    <DashboardLayout>
      <div className="space-y-4 md:space-y-6">
        <div>
          <h1 className="text-xl md:text-2xl lg:text-3xl font-bold">Accounts</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Manage financial accounts and view transaction history</p>
        </div>

        <Tabs defaultValue="registration" value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1 sm:gap-2 w-full h-auto">
            <TabsTrigger value="registration" className="text-[10px] sm:text-xs md:text-sm h-8 sm:h-9 px-1 sm:px-2">
              <span className="hidden sm:inline">Registration Fees</span>
              <span className="sm:hidden">Registration</span>
            </TabsTrigger>
            <TabsTrigger value="renewal" className="text-[10px] sm:text-xs md:text-sm h-8 sm:h-9 px-1 sm:px-2">
              <span className="hidden sm:inline">Renewal Fees</span>
              <span className="sm:hidden">Renewal</span>
            </TabsTrigger>
            <TabsTrigger value="penalty" className="text-[10px] sm:text-xs md:text-sm h-8 sm:h-9 px-1 sm:px-2">
              <span className="hidden sm:inline">Penalty Fees</span>
              <span className="sm:hidden">Penalty</span>
            </TabsTrigger>
            <TabsTrigger value="arrears" className="text-[10px] sm:text-xs md:text-sm h-8 sm:h-9 px-1 sm:px-2">
              <span className="hidden sm:inline">Arrears Account</span>
              <span className="sm:hidden">Arrears</span>
            </TabsTrigger>
            <TabsTrigger value="late" className="text-[10px] sm:text-xs md:text-sm h-8 sm:h-9 px-1 sm:px-2">
              <span className="hidden sm:inline">Late Payments</span>
              <span className="sm:hidden">Late</span>
            </TabsTrigger>
            <TabsTrigger value="suspense" className="text-[10px] sm:text-xs md:text-sm h-8 sm:h-9 px-1 sm:px-2">
              <span className="hidden sm:inline">Suspense Account</span>
              <span className="sm:hidden">Suspense</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="registration" className="space-y-4 md:space-y-6">
            <RegistrationAccount />
          </TabsContent>

          <TabsContent value="renewal" className="space-y-4 md:space-y-6">
            <RenewalAccount />
          </TabsContent>

          <TabsContent value="penalty" className="space-y-4 md:space-y-6">
            <PenaltyAccount />
          </TabsContent>

          <TabsContent value="arrears" className="space-y-4 md:space-y-6">
            <ArrearsAccount />
          </TabsContent>

          <TabsContent value="late" className="space-y-4 md:space-y-6">
            <LatePaymentsAccount />
          </TabsContent>

          <TabsContent value="suspense" className="space-y-4 md:space-y-6">
            <SuspenseManagement />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Accounts;
