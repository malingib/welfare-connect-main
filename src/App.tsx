import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { identifyCurrentUser, trackPageview } from "@/lib/posthog";
import ErrorBoundary from "@/components/ErrorBoundary";
import ProtectedRoute from "@/components/ProtectedRoute";
import MemberProtectedRoute from "@/components/MemberProtectedRoute";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ADMIN_ROLES,
  COMPLIANCE_ROLES,
  FINANCE_ROLES,
  MEMBER_MANAGEMENT_ROLES,
  REPORTS_ROLES,
  SETTINGS_ROLES,
  TRANSACTION_VIEW_ROLES,
  USER_MANAGEMENT_ROLES,
} from "@/lib/rbac";

// Lazy-load all pages for route-level code splitting.
// Each page only downloads when the user navigates to it.
const Login = lazy(() => import("./pages/Login"));
const Index = lazy(() => import("./pages/Index"));
const AppDownload = lazy(() => import("./pages/AppDownload"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Members = lazy(() => import("./pages/Members"));
const MemberDetails = lazy(() => import("./pages/MemberDetails"));
const NewMember = lazy(() => import("./pages/NewMember"));
const MembershipApplication = lazy(() => import("./pages/MembershipApplication"));
const Applications = lazy(() => import("./pages/Applications"));
const Cases = lazy(() => import("./pages/Cases"));
const CaseDetails = lazy(() => import("./pages/CaseDetails"));
const NewCase = lazy(() => import("./pages/NewCase"));
const EditCase = lazy(() => import("./pages/EditCase"));
const Reports = lazy(() => import("./pages/Reports"));
const FiscalReports = lazy(() => import("./pages/FiscalReports"));
const ComplianceReports = lazy(() => import("./pages/ComplianceReports"));
const Transactions = lazy(() => import("./pages/Transactions"));
const Accounts = lazy(() => import("./pages/Accounts"));
const Settings = lazy(() => import("./pages/Settings"));
const Users = lazy(() => import("./pages/Users"));
const NotFound = lazy(() => import("./pages/NotFound"));
const MemberDashboard = lazy(() => import("./pages/members/MemberDashboard"));
const MemberSummary = lazy(() => import("./pages/members/MemberSummary"));
const MemberCases = lazy(() => import("./pages/members/MemberCases"));
const MemberTransactions = lazy(() => import("./pages/members/MemberTransactions"));
const MemberReport = lazy(() => import("./pages/members/MemberReport"));
const MemberDependants = lazy(() => import("./pages/members/MemberDependants"));

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen bg-background">
    <div className="space-y-4 w-64">
      <Skeleton className="h-8 w-full rounded-lg" />
      <Skeleton className="h-4 w-3/4 rounded" />
      <Skeleton className="h-4 w-1/2 rounded" />
    </div>
  </div>
);

const PosthogRouteTracker = () => {
  const location = useLocation();

  useEffect(() => {
    identifyCurrentUser();
  }, []);

  useEffect(() => {
    trackPageview(location.pathname, document.title, location.search);
  }, [location.pathname, location.search]);

  return null;
};

const App = () => (
  <ErrorBoundary>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <PosthogRouteTracker />
        <Suspense fallback={<PageLoader />}>
          <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/download" element={<AppDownload />} />
          <Route path="/login" element={<Login />} />
          <Route path="/admin/login" element={<Navigate to="/login" replace />} />
          <Route path="/apply" element={<MembershipApplication />} />
          <Route path="/signup" element={<MembershipApplication />} />
          <Route path="/register" element={<MembershipApplication />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute allowedRoles={ADMIN_ROLES}>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/members"
            element={
              <ProtectedRoute allowedRoles={MEMBER_MANAGEMENT_ROLES}>
                <Members />
              </ProtectedRoute>
            }
          />
          <Route
            path="/members/:id"
            element={
              <ProtectedRoute allowedRoles={MEMBER_MANAGEMENT_ROLES}>
                <MemberDetails />
              </ProtectedRoute>
            }
          />
          <Route
            path="/members/new"
            element={
              <ProtectedRoute allowedRoles={MEMBER_MANAGEMENT_ROLES}>
                <NewMember />
              </ProtectedRoute>
            }
          />
          <Route
            path="/applications"
            element={
              <ProtectedRoute allowedRoles={MEMBER_MANAGEMENT_ROLES}>
                <Applications />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cases"
            element={
              <ProtectedRoute allowedRoles={MEMBER_MANAGEMENT_ROLES}>
                <Cases />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cases/:id"
            element={
              <ProtectedRoute allowedRoles={MEMBER_MANAGEMENT_ROLES}>
                <CaseDetails />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cases/:id/edit"
            element={
              <ProtectedRoute allowedRoles={MEMBER_MANAGEMENT_ROLES}>
                <EditCase />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cases/new"
            element={
              <ProtectedRoute allowedRoles={MEMBER_MANAGEMENT_ROLES}>
                <NewCase />
              </ProtectedRoute>
            }
          />
          <Route
            path="/transactions"
            element={
              <ProtectedRoute allowedRoles={TRANSACTION_VIEW_ROLES}>
                <Transactions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/accounts"
            element={
              <ProtectedRoute allowedRoles={FINANCE_ROLES}>
                <Accounts />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute allowedRoles={REPORTS_ROLES}>
                <Reports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/fiscal"
            element={
              <ProtectedRoute allowedRoles={FINANCE_ROLES}>
                <FiscalReports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/compliance"
            element={
              <ProtectedRoute allowedRoles={COMPLIANCE_ROLES}>
                <ComplianceReports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute allowedRoles={USER_MANAGEMENT_ROLES}>
                <Users />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute allowedRoles={SETTINGS_ROLES}>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route path="/member/login" element={<Navigate to="/login?role=member" replace />} />
          <Route
            path="/member/dashboard"
            element={
              <MemberProtectedRoute>
                <MemberDashboard />
              </MemberProtectedRoute>
            }
          />
          <Route
            path="/member/summary"
            element={
              <MemberProtectedRoute>
                <MemberSummary />
              </MemberProtectedRoute>
            }
          />
          <Route
            path="/member/cases"
            element={
              <MemberProtectedRoute>
                <MemberCases />
              </MemberProtectedRoute>
            }
          />
          <Route
            path="/member/transactions"
            element={
              <MemberProtectedRoute>
                <MemberTransactions />
              </MemberProtectedRoute>
            }
          />
          <Route
            path="/member/report"
            element={
              <MemberProtectedRoute>
                <MemberReport />
              </MemberProtectedRoute>
            }
          />
          <Route
            path="/member/dependants"
            element={
              <MemberProtectedRoute>
                <MemberDependants />
              </MemberProtectedRoute>
            }
          />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
      </TooltipProvider>
    </AuthProvider>
  </ErrorBoundary>
);

export default App;
