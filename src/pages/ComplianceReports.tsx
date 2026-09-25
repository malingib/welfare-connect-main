import { useState, useEffect, useMemo, useCallback } from 'react'
import { Download, Shield, CheckCircle, AlertTriangle, FileCheck, UserCheck, Filter, Search, X, CalendarIcon, FileSpreadsheet } from 'lucide-react'
import DashboardLayout from '@/layouts/DashboardLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/integrations/supabase/client'
import { useToast } from '@/components/ui/use-toast'
import ReportsSubnav from '@/components/reports/ReportsSubnav'
import { createReportFilename, exportRowsToCSV } from '@/lib/reportExport'
import { loadJsPdfWithAutotable, loadXlsx } from '@/lib/reportExportLibs'
import { invokeWithAppToken } from '@/lib/appAuth'
import {
  MEMBERS_ON_PROBATION_COMPLIANCE_COLUMNS,
  REVERSALS_AUDIT_COLUMNS,
  WRONG_MPESA_PENDING_COUNT_COLUMNS,
} from '@/lib/supabaseSelectColumns'
import { format, subDays, startOfYear } from 'date-fns'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination'

interface ComplianceIssue {
  id: string
  issue_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  affected_count: number
  recommendation: string
  details: string[]
}

interface AuditEntry {
  id: string
  action: string
  table_name: string
  status: string
  created_at: string
  timestamp?: string
  user_id?: string
  member_id?: string
  record_id?: string
  metadata?: any
  actor_kind?: string
  actor_name?: string
  actor_detail?: string
  member_number?: string
  member_name?: string
  subject_label?: string
  session_id?: string
}

interface ReversalEntry {
  reversal_id: string
  member_name: string
  member_number: string
  reversal_amount: number
  reason: string
  reversal_date: string
  original_transaction_date: string
  original_amount: number
}

interface CasePaymentCase {
  id: string
  case_number: string
  case_type: string
  contribution_per_member: number
  is_active: boolean
  is_finalized: boolean
}

interface CasePaymentComplianceRow {
  id: string
  case_id: string
  case_number: string
  case_type: string
  case_status: string
  member_id: string
  member_number: string
  member_name: string
  member_status: string
  expected_amount: number
  gross_paid: number
  total_refunded: number
  net_paid: number
  outstanding_amount: number
  payment_compliance: 'paid' | 'partial' | 'unpaid'
}

interface CasePaymentSummaryRow {
  case_id: string
  case_number: string
  case_type: string
  case_status: string
  eligible_members: number
  paid_members: number
  partial_members: number
  unpaid_members: number
  expected_total: number
  net_paid_total: number
  outstanding_total: number
  paid_amount_percent: number
  paid_members_percent: number
}

const ITEMS_PER_PAGE = 15
const MAX_EXPORT_ENTRIES = 200

const prettifyAction = (action: unknown) =>
  String(action || 'Unknown action').replace(/_/g, ' ').toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())

const formatAuditTimestamp = (log: AuditEntry) => {
  const raw = log.created_at || log.timestamp
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return '-'
  return format(d, 'dd MMM yyyy, HH:mm:ss')
}

const formatAuditActor = (log: AuditEntry): { name: string; detail: string } => {
  if (log.actor_name) {
    return { name: log.actor_name, detail: log.actor_detail || '' }
  }
  if (log.member_name || log.member_number) {
    return {
      name: log.member_name || 'Member',
      detail: log.member_number ? `#${log.member_number}` : '',
    }
  }
  if (log.member_id) return { name: 'Member', detail: `#${String(log.member_id).substring(0, 8)}` }
  if (log.user_id) return { name: 'User', detail: `#${String(log.user_id).substring(0, 8)}` }
  return { name: 'System', detail: 'automated' }
}

const describeAuditLog = (log: AuditEntry): string => {
  const meta = (log.metadata || {}) as Record<string, unknown>
  const str = (v: unknown) => String(v ?? '').trim()
  const action = String(log.action || '')
  const table = String(log.table_name || '')
  switch (action) {
    case 'LOGIN':
      return `Sign-in on ${table || 'portal'}`
    case 'LOGIN_FAILED':
      return 'Failed sign-in attempt'
    case 'SMS_SENT':
      return `SMS sent to ${str(meta.phone_number) || 'member'}` +
        (meta.trigger_key ? ` (${str(meta.trigger_key).replace(/_/g, ' ')})` : '')
    case 'SMS_FAILED':
      return `SMS failed to ${str(meta.phone_number) || 'member'}`
    case 'MPESA_CALLBACK_RECEIVED':
      return 'M-Pesa payment callback received'
    case 'STK_PUSH_INITIATED':
      return `STK push initiated${meta.amount ? ` for KES ${Number(meta.amount).toLocaleString()}` : ''}`
    case 'STK_CALLBACK_ERROR':
    case 'STK_CALLBACK_INVALID_FORMAT':
      return prettifyAction(action)
    case 'PAYMENT_FAILED':
      return `Payment failed${meta.amount ? ` (KES ${Number(meta.amount).toLocaleString()})` : ''}`
    case 'MEMBER_STATUS_UPDATE':
      return `Member status ${str(meta.from_status) && str(meta.to_status) ? `${meta.from_status} → ${meta.to_status}` : 'updated'}`
    case 'SUSPENSE_AUTO_MATCH':
      return 'Suspense payment auto-matched'
    case 'PROBATION_AUTO_UPDATE':
      return 'Probation status auto-updated'
    case 'SETTINGS_UPDATE':
      return 'Settings updated'
    case 'FEE_COLLECTION':
      return `Fee collected${meta.fee_type ? `: ${meta.fee_type}` : ''}${meta.amount ? ` (KES ${Number(meta.amount).toLocaleString()})` : ''}`
    case 'INSERT':
      return `Created ${table || 'record'}` +
        (meta.case_number ? ` for case #${meta.case_number}` : '') +
        (meta.amount ? ` (KES ${Number(meta.amount).toLocaleString()})` : '')
    case 'UPDATE':
      return `Updated ${table || 'record'}`
    case 'DELETE':
      return `Deleted ${table || 'record'}`
    case 'LOGIN_BLOCKED_UNHASHED_PASSWORD':
      return 'Sign-in blocked — password reset required'
    case 'WALLET_FUNDING':
      return `Wallet funded${meta.amount ? ` (KES ${Number(meta.amount).toLocaleString()})` : ''}`
    case 'WALLET_ADJUSTMENT':
      return `Wallet adjusted${meta.amount ? ` (KES ${Number(meta.amount).toLocaleString()})` : ''}${meta.reason ? ` — ${meta.reason}` : ''}`
    case 'WALLET_TRANSFER':
      return `Wallet transfer${meta.amount ? ` (KES ${Number(meta.amount).toLocaleString()})` : ''}`
    case 'DISBURSEMENT':
      return `Case disbursement${meta.amount ? ` (KES ${Number(meta.amount).toLocaleString()})` : ''}`
    case 'CASE_DEDUCTION':
      return 'Case wallet deduction'
    case 'CASE_PAYMENT':
      return 'Case payment received'
    case 'LATE_PAYMENT':
      return 'Late payment for closed case'
    case 'ARREARS_POSTING':
      return 'Arrears posting'
    case 'CASE_REFUND':
      return `Case contribution refund${meta.amount ? ` (KES ${Number(meta.amount).toLocaleString()})` : ''}`
    case 'FEE_POSTING':
    case 'PENALTY_POSTING':
      return prettifyAction(action)
    case 'USER_CREATE':
      return `User account created${meta.username ? ` (@${meta.username})` : ''}`
    case 'USER_ROLE_UPDATE':
      return `User role changed${meta.role ? ` to ${meta.role}` : ''}`
    case 'USER_STATUS_UPDATE':
      return `User account ${meta.is_active === false ? 'deactivated' : 'activated'}`
    case 'USER_PASSWORD_RESET':
      return 'User password reset'
    case 'USER_DELETE_MEMBER_LINKS':
      return `Removed ${Number(meta.deleted_user_count || 0)} linked user(s)`
    default:
      return table ? `${prettifyAction(action)} (${table})` : prettifyAction(action)
  }
}

const auditDetails = (log: AuditEntry): string => {
  const base = describeAuditLog(log)
  const subject = String(log.subject_label || '').trim()
  if (!subject) return base
  if (base.toLowerCase().includes(subject.toLowerCase())) return base
  return `${base} — ${subject}`
}
const FAILED_TRANSACTION_STATUSES = ['failed', 'error', 'cancelled', 'canceled', 'reversed', 'voided']
const COMPLIANCE_MEMBER_STATUSES = ['active', 'probation']

const severityColorMap: Record<string, string> = {
  critical: 'bg-destructive',
  high: 'bg-accent',
  medium: 'bg-primary/80',
  low: 'bg-primary',
}

const ComplianceReports = () => {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState('case-payments')
  const [loading, setLoading] = useState(true)
  const [auditPage, setAuditPage] = useState(1)
  const [auditSearch, setAuditSearch] = useState('')
  const [auditSession, setAuditSession] = useState<string>('all')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [datePreset, setDatePreset] = useState<'7days' | '30days' | '90days' | 'thisYear' | 'all'>('30days')
  const [showFilters, setShowFilters] = useState(false)
  const [expandedIssues, setExpandedIssues] = useState<Record<string, boolean>>({})
  
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([])
  const [reversals, setReversals] = useState<ReversalEntry[]>([])
  const [complianceIssues, setComplianceIssues] = useState<ComplianceIssue[]>([])
  const [casePaymentCases, setCasePaymentCases] = useState<CasePaymentCase[]>([])
  const [casePaymentRowsBase, setCasePaymentRowsBase] = useState<CasePaymentComplianceRow[]>([])
  const [casePaymentSummaryRowsBase, setCasePaymentSummaryRowsBase] = useState<CasePaymentSummaryRow[]>([])
  const [casePaymentCaseSearch, setCasePaymentCaseSearch] = useState('')
  const [casePaymentMemberSearch, setCasePaymentMemberSearch] = useState('')
  const [casePaymentCaseStatus, setCasePaymentCaseStatus] = useState<'all' | 'active' | 'finalized' | 'closed'>('all')
  const [casePaymentCaseType, setCasePaymentCaseType] = useState('all')
  const [casePaymentStatusFilter, setCasePaymentStatusFilter] = useState<'all' | 'paid' | 'partial' | 'unpaid'>('all')
  const [casePaymentPage, setCasePaymentPage] = useState(1)
  const [stats, setStats] = useState<any>(null)

  const fetchAuditLogs = async () => {
    try {
      const data = (await invokeWithAppToken<{ logs?: Record<string, unknown>[] }>('api-audit-logs', { limit: 500 })) as any
      const logs = ((data?.logs || []) as Record<string, unknown>[]).map((row) => ({
        ...row,
        created_at: (row.created_at as string) || (row.timestamp as string),
      })) as AuditEntry[]
      setAuditLogs(logs)
    } catch (error: any) {
      console.error('Error fetching audit logs:', error)
      toast({
        title: 'Error fetching audit logs',
        description: error.message,
        variant: 'destructive',
      })
    }
  }

  const fetchReversals = async () => {
    try {
      const { data, error } = await supabase
        .from('reversals_audit')
        .select(REVERSALS_AUDIT_COLUMNS)
        .order('reversal_date', { ascending: false })

      if (error) throw error
      setReversals(data || [])
    } catch (error: any) {
      console.error('Error fetching reversals:', error)
      toast({
        title: 'Error fetching reversals',
        description: error.message,
        variant: 'destructive',
      })
    }
  }

  const checkCompliance = async () => {
    const issues: ComplianceIssue[] = []

    try {
      const [
        { data: noPhone },
        { data: defaulters },
        { data: suspense },
        { data: prolongedProbation },
        { data: failedTx },
      ] = await Promise.all([
        supabase
          .from('members')
          .select('id, member_number, name')
          .is('phone_number', null)
          .in('status', COMPLIANCE_MEMBER_STATUSES),
        supabase
          .from('active_defaulters')
          .select('id, member_number, name, wallet_balance'),
        supabase
          .from('wrong_mpesa_transactions')
          .select(WRONG_MPESA_PENDING_COUNT_COLUMNS)
          .eq('status', 'pending'),
        supabase
          .from('members_on_probation')
          .select(MEMBERS_ON_PROBATION_COMPLIANCE_COLUMNS)
          .gt('days_overdue', 0),
        supabase
          .from('transactions')
          .select('id, member_id, amount, mpesa_reference, created_at, members!inner(status)')
          .in('status', FAILED_TRANSACTION_STATUSES)
          .in('members.status', COMPLIANCE_MEMBER_STATUSES),
      ])

      if (noPhone && noPhone.length > 0) {
        issues.push({
          id: 'no-phone',
          issue_type: 'Missing Contact Information',
          severity: 'medium',
          description: 'Members without phone numbers',
          affected_count: noPhone.length,
          recommendation: 'Update member records with valid phone numbers',
          details: noPhone.map((member: any) => `${member.member_number || member.id}: ${member.name || 'Unknown member'}`),
        })
      }

      if (defaulters && defaulters.length > 0) {
        issues.push({
          id: 'defaulters',
          issue_type: 'Outstanding Balances',
          severity: 'high',
          description: 'Active and probation members with negative wallet balance',
          affected_count: defaulters.length,
          recommendation: 'Follow up with members to clear outstanding balances',
          details: defaulters.map((entry: any) => {
            const amount = Number(entry.wallet_balance || 0)
            return `${entry.member_number || entry.id}: ${entry.name || 'Unknown'} (KES ${Math.abs(amount).toLocaleString()} overdue)`
          }),
        })
      }

      if (suspense && suspense.length > 0) {
        issues.push({
          id: 'suspense-pending',
          issue_type: 'Unmatched Payments',
          severity: 'medium',
          description: 'M-Pesa payments pending matching to member accounts',
          affected_count: suspense.length,
          recommendation: 'Review and match suspense transactions to member accounts',
          details: suspense.map((entry: any) => {
            const reference = entry.reference || entry.mpesa_receipt_number || entry.id
            const amount = Number(entry.amount || 0)
            return `Ref ${reference}: KES ${Math.abs(amount).toLocaleString()} pending match`
          }),
        })
      }

      if (prolongedProbation && prolongedProbation.length > 0) {
        issues.push({
          id: 'prolonged-probation',
          issue_type: 'Probation Status',
          severity: 'low',
          description: 'Members whose probation period has ended but status not updated',
          affected_count: prolongedProbation.length,
          recommendation: 'Run probation auto-update or manually update member status',
          details: prolongedProbation.map((entry: any) => {
            const memberRef = entry.member_number || entry.id
            const memberName = entry.name || 'Unknown member'
            const overdueDays = Number(entry.days_overdue || 0)
            return `${memberRef}: ${memberName} (${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue)`
          }),
        })
      }

      if (failedTx && failedTx.length > 0) {
        issues.push({
          id: 'failed-transactions',
          issue_type: 'Failed Transactions',
          severity: 'medium',
          description: 'Transactions that failed to complete for active/probation members',
          affected_count: failedTx.length,
          recommendation: 'Review failed transactions and retry or refund as necessary',
          details: failedTx.map((entry: any) => {
            const reference = entry.mpesa_reference || entry.id
            const amount = Number(entry.amount || 0)
            const date = entry.created_at ? format(new Date(entry.created_at), 'dd MMM yyyy') : 'Unknown date'
            return `Ref ${reference}: KES ${Math.abs(amount).toLocaleString()} failed on ${date}`
          }),
        })
      }

      setComplianceIssues(issues)
    } catch (error: any) {
      console.error('Error checking compliance:', error)
      toast({
        title: 'Error checking compliance',
        description: error.message,
        variant: 'destructive',
      })
    }
  }

  const fetchStats = async () => {
    try {
      const { data, error } = await supabase.rpc('get_enhanced_dashboard_summary')
      if (error) throw error
      setStats((data && data[0]) || {})
    } catch (error: any) {
      console.error('Error fetching stats:', error)
      toast({
        title: 'Error fetching stats',
        description: error.message,
        variant: 'destructive',
      })
    }
  }

  const fetchCasePaymentComplianceData = async () => {
    try {
      const [{ data: rows, error: rowsError }, { data: summaryRows, error: summaryError }] = await Promise.all([
        supabase.rpc('get_case_payment_compliance_rows'),
        supabase.rpc('get_case_payment_compliance_summary'),
      ])
      if (rowsError) throw rowsError
      if (summaryError) throw summaryError

      const mappedRows: CasePaymentComplianceRow[] = ((rows || []) as any[]).map((row) => ({
        id: `${row.case_id}:${row.member_id}`,
        case_id: String(row.case_id),
        case_number: String(row.case_number || ''),
        case_type: String(row.case_type || ''),
        case_status: String(row.case_status || 'closed'),
        member_id: String(row.member_id),
        member_number: String(row.member_number || ''),
        member_name: String(row.member_name || 'Unknown member'),
        member_status: String(row.member_status || ''),
        expected_amount: Number(row.expected_amount || 0),
        gross_paid: Number(row.gross_paid || 0),
        total_refunded: Number(row.total_refunded || 0),
        net_paid: Number(row.net_paid || 0),
        outstanding_amount: Number(row.outstanding_amount || 0),
        payment_compliance: (row.payment_compliance || 'unpaid') as 'paid' | 'partial' | 'unpaid',
      }))

      const mappedSummaryRows: CasePaymentSummaryRow[] = ((summaryRows || []) as any[]).map((row) => ({
        case_id: String(row.case_id),
        case_number: String(row.case_number || ''),
        case_type: String(row.case_type || ''),
        case_status: String(row.case_status || 'closed'),
        eligible_members: Number(row.eligible_members || 0),
        paid_members: Number(row.paid_members || 0),
        partial_members: Number(row.partial_members || 0),
        unpaid_members: Number(row.unpaid_members || 0),
        expected_total: Number(row.expected_total || 0),
        net_paid_total: Number(row.net_paid_total || 0),
        outstanding_total: Number(row.outstanding_total || 0),
        paid_amount_percent: Number(row.paid_amount_percent || 0),
        paid_members_percent: Number(row.paid_members_percent || 0),
      }))

      setCasePaymentRowsBase(mappedRows)
      setCasePaymentSummaryRowsBase(mappedSummaryRows)
      setCasePaymentCases(
        mappedSummaryRows.map((row) => ({
          id: row.case_id,
          case_number: row.case_number,
          case_type: row.case_type,
          contribution_per_member: row.eligible_members > 0 ? row.expected_total / row.eligible_members : 0,
          is_active: row.case_status === 'active',
          is_finalized: row.case_status === 'finalized',
        }))
      )
    } catch (error: any) {
      console.error('Error fetching case payment compliance:', error)
      toast({
        title: 'Error fetching case payment compliance',
        description: error.message,
        variant: 'destructive',
      })
    }
  }

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      await Promise.all([
        fetchAuditLogs(),
        fetchReversals(),
        checkCompliance(),
        fetchStats(),
        fetchCasePaymentComplianceData(),
      ])
      setLoading(false)
    }
    fetchData()
  }, [])

  const getAuditDateRange = useCallback(() => {
    const now = new Date()
    switch (datePreset) {
      case '7days': return subDays(now, 7)
      case '30days': return subDays(now, 30)
      case '90days': return subDays(now, 90)
      case 'thisYear': return startOfYear(now)
      case 'all': return new Date(2000, 0, 1)
      default: return subDays(now, 30)
    }
  }, [datePreset])

  const auditSessions = useMemo(() => {
    const byId = new Map<string, { id: string; label: string; time: string }>()
    for (const log of auditLogs) {
      const sid = String(log.session_id || '')
      if (!sid || byId.has(sid)) continue
      const actor = formatAuditActor(log)
      const isLogin = String(log.action || '').startsWith('LOGIN')
      byId.set(sid, {
        id: sid,
        label: `${actor.name}${actor.detail ? ` (${actor.detail})` : ''}${isLogin ? '' : ' — no sign-in row in range'}`,
        time: String(log.created_at || log.timestamp || ''),
      })
    }
    return Array.from(byId.values()).sort((a, b) =>
      new Date(b.time).getTime() - new Date(a.time).getTime())
  }, [auditLogs])

  const filteredAuditLogs = useMemo(() => {
    const startDate = getAuditDateRange()
    return auditLogs.filter(log => {
      const logDate = new Date(log.created_at)
      if (logDate < startDate) return false
      if (auditSession !== 'all' && String(log.session_id || '') !== auditSession) return false
      if (auditSearch) {
        const search = auditSearch.toLowerCase()
        const actor = formatAuditActor(log)
        const matches = [
          log.action,
          log.table_name,
          log.status,
          log.member_id,
          log.user_id,
          log.actor_name,
          log.actor_detail,
          log.member_number,
          log.member_name,
          actor.name,
          actor.detail,
          auditDetails(log),
        ].some(v => v?.toLowerCase().includes(search))
        if (!matches) return false
      }
      return true
    })
  }, [auditLogs, getAuditDateRange, auditSearch, auditSession])

  const paginatedAuditLogs = useMemo(() => {
    const start = (auditPage - 1) * ITEMS_PER_PAGE
    return {
      data: filteredAuditLogs.slice(start, start + ITEMS_PER_PAGE),
      total: filteredAuditLogs.length,
      totalPages: Math.ceil(filteredAuditLogs.length / ITEMS_PER_PAGE)
    }
  }, [filteredAuditLogs, auditPage])

  const filteredComplianceIssues = useMemo(() => {
    if (severityFilter === 'all') return complianceIssues
    return complianceIssues.filter(i => i.severity === severityFilter)
  }, [complianceIssues, severityFilter])

  const casePaymentCaseTypeOptions = useMemo(() => {
    return Array.from(new Set(casePaymentCases.map((c) => c.case_type).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  }, [casePaymentCases])

  const filteredCasePaymentCases = useMemo(() => {
    const term = casePaymentCaseSearch.trim().toLowerCase()
    return casePaymentCases.filter((c) => {
      const searchMatch =
        term === '' ||
        c.case_number.toLowerCase().includes(term) ||
        c.case_type.toLowerCase().includes(term)
      const statusMatch =
        casePaymentCaseStatus === 'all' ||
        (casePaymentCaseStatus === 'active' && c.is_active) ||
        (casePaymentCaseStatus === 'finalized' && c.is_finalized) ||
        (casePaymentCaseStatus === 'closed' && !c.is_active && !c.is_finalized)
      const typeMatch = casePaymentCaseType === 'all' || c.case_type === casePaymentCaseType
      return searchMatch && statusMatch && typeMatch
    })
  }, [casePaymentCases, casePaymentCaseSearch, casePaymentCaseStatus, casePaymentCaseType])

  const casePaymentRows = useMemo(() => {
    const allowedCaseIds = new Set(filteredCasePaymentCases.map((c) => c.id))
    return casePaymentRowsBase.filter((row) => allowedCaseIds.has(row.case_id))
  }, [casePaymentRowsBase, filteredCasePaymentCases])

  const casePaymentSummaryRows = useMemo(() => {
    const allowedCaseIds = new Set(filteredCasePaymentCases.map((c) => c.id))
    return casePaymentSummaryRowsBase
      .filter((row) => allowedCaseIds.has(row.case_id))
      .sort((a, b) => b.outstanding_total - a.outstanding_total || b.case_number.localeCompare(a.case_number))
  }, [casePaymentSummaryRowsBase, filteredCasePaymentCases])

  const filteredCasePaymentRows = useMemo(() => {
    const term = casePaymentMemberSearch.trim().toLowerCase()
    return casePaymentRows.filter((row) => {
      const searchMatch =
        term === '' ||
        row.member_name.toLowerCase().includes(term) ||
        row.member_number.toLowerCase().includes(term) ||
        row.case_number.toLowerCase().includes(term)
      const statusMatch = casePaymentStatusFilter === 'all' || row.payment_compliance === casePaymentStatusFilter
      return searchMatch && statusMatch
    })
  }, [casePaymentMemberSearch, casePaymentRows, casePaymentStatusFilter])

  const paginatedCasePaymentRows = useMemo(() => {
    const start = (casePaymentPage - 1) * ITEMS_PER_PAGE
    return {
      data: filteredCasePaymentRows.slice(start, start + ITEMS_PER_PAGE),
      total: filteredCasePaymentRows.length,
      totalPages: Math.ceil(filteredCasePaymentRows.length / ITEMS_PER_PAGE),
    }
  }, [casePaymentPage, filteredCasePaymentRows])

  const casePaymentTotals = useMemo(() => {
    const expectedTotal = casePaymentSummaryRows.reduce((sum, row) => sum + row.expected_total, 0)
    const netPaidTotal = casePaymentSummaryRows.reduce((sum, row) => sum + row.net_paid_total, 0)
    return {
      expectedTotal,
      netPaidTotal,
      paidAmountPercent: expectedTotal > 0 ? Number(((netPaidTotal / expectedTotal) * 100).toFixed(2)) : 0,
    }
  }, [casePaymentSummaryRows])

  const casePaymentMemberCount = useMemo(() => {
    return new Set(casePaymentRowsBase.map((row) => row.member_id)).size
  }, [casePaymentRowsBase])

  useEffect(() => {
    setCasePaymentPage(1)
  }, [casePaymentCaseSearch, casePaymentCaseStatus, casePaymentCaseType, casePaymentMemberSearch, casePaymentStatusFilter])

  const clearFilters = () => {
    setDatePreset('30days')
    setAuditSearch('')
    setAuditSession('all')
    setSeverityFilter('all')
    setAuditPage(1)
  }

  const hasActiveFilters = datePreset !== '30days' || auditSearch !== '' || severityFilter !== 'all'
  const toggleIssueExpansion = (issueId: string) => {
    setExpandedIssues((prev) => ({ ...prev, [issueId]: !prev[issueId] }))
  }

  const exportAuditToPDF = async () => {
    try {
      const jsPDF = await loadJsPdfWithAutotable()
      const doc = new jsPDF()
      
      doc.setFontSize(16)
      doc.text('Audit Trail Report', 14, 20)
      doc.setFontSize(10)
      doc.text(`Generated on: ${format(new Date(), 'dd MMMM yyyy')}`, 14, 28)
      
      const logsToExport = filteredAuditLogs.slice(0, MAX_EXPORT_ENTRIES)
      if (!logsToExport.length) {
        toast({ title: 'No data to export', description: 'Adjust filters and try again.', variant: 'destructive' })
        return
      }
      if (filteredAuditLogs.length > MAX_EXPORT_ENTRIES) {
        doc.setFontSize(8)
        doc.text(`Note: Export limited to first ${MAX_EXPORT_ENTRIES} entries. Total entries: ${filteredAuditLogs.length}`, 14, 34)
      }
      
      const tableData = logsToExport.map((log) => {
        const actor = formatAuditActor(log)
        return [
          formatAuditTimestamp(log),
          actor.detail ? `${actor.name} (${actor.detail})` : actor.name,
          log.action,
          auditDetails(log),
          log.status,
        ]
      })
      
      ;(doc as any).autoTable({
        head: [['Date/Time', 'Actor', 'Action', 'Details', 'Status']],
        body: tableData,
        startY: filteredAuditLogs.length > MAX_EXPORT_ENTRIES ? 40 : 35,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [41, 128, 185] },
        margin: { top: 20, left: 14, right: 14 },
      })
      
      doc.save(createReportFilename('compliance_audit_trail', 'pdf'))
    } catch (error: any) {
      console.error('Error exporting PDF:', error)
      toast({
        title: 'Export failed',
        description: 'Failed to export audit trail to PDF.',
        variant: 'destructive',
      })
    }
  }

  const exportAuditToCSV = () => {
    try {
      const logsToExport = filteredAuditLogs.slice(0, MAX_EXPORT_ENTRIES)
      if (!logsToExport.length) {
        toast({ title: 'No data to export', description: 'Adjust filters and try again.', variant: 'destructive' })
        return
      }
      const headers = ['Date/Time', 'Actor', 'Action', 'Details', 'Status']
      const rows = logsToExport.map(log => {
        const actor = formatAuditActor(log)
        return [
          formatAuditTimestamp(log),
          actor.detail ? `${actor.name} (${actor.detail})` : actor.name,
          log.action,
          auditDetails(log),
          log.status,
        ]
      })

      let csvContent = headers.join(',') + '\n'
      rows.forEach(row => {
        csvContent += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',') + '\n'
      })

      if (filteredAuditLogs.length > MAX_EXPORT_ENTRIES) {
        csvContent += `\n"Note: Export limited to first ${MAX_EXPORT_ENTRIES} entries. Total entries: ${filteredAuditLogs.length}"\n`
      }

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = createReportFilename('compliance_audit_trail', 'csv')
      link.click()
      URL.revokeObjectURL(url)
    } catch (error: any) {
      console.error('Error exporting CSV:', error)
      toast({
        title: 'Export failed',
        description: 'Failed to export audit trail to CSV.',
        variant: 'destructive',
      })
    }
  }

  const exportReversalsToExcel = async () => {
    try {
      if (!reversals.length) {
        toast({ title: 'No data to export', description: 'No reversals available for export.', variant: 'destructive' })
        return
      }
      const XLSX = await loadXlsx()
      const ws = XLSX.utils.json_to_sheet(reversals)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Reversals')
      XLSX.writeFile(wb, createReportFilename('compliance_reversals_audit', 'xlsx'))
    } catch (error: any) {
      console.error('Error exporting Excel:', error)
      toast({
        title: 'Export failed',
        description: 'Failed to export reversals to Excel.',
        variant: 'destructive',
      })
    }
  }

  const formatCurrency = (value: number) => `KES ${Number(value || 0).toLocaleString()}`

  const casePaymentSummaryExportRows = useMemo(() => (
    casePaymentSummaryRows.map((row) => ({
      case_number: row.case_number,
      case_type: row.case_type,
      case_status: row.case_status,
      eligible_members: row.eligible_members,
      paid_members: row.paid_members,
      partial_members: row.partial_members,
      unpaid_members: row.unpaid_members,
      expected_total: row.expected_total,
      net_paid_total: row.net_paid_total,
      outstanding_total: row.outstanding_total,
      paid_against_total_percent: row.paid_amount_percent,
      paid_members_percent: row.paid_members_percent,
    }))
  ), [casePaymentSummaryRows])

  const casePaymentListExportRows = useMemo(() => (
    filteredCasePaymentRows.map((row) => ({
      case_number: row.case_number,
      case_type: row.case_type,
      case_status: row.case_status,
      member_number: row.member_number,
      member_name: row.member_name,
      member_status: row.member_status,
      expected_amount: row.expected_amount,
      gross_paid: row.gross_paid,
      total_refunded: row.total_refunded,
      net_paid: row.net_paid,
      outstanding_amount: row.outstanding_amount,
      payment_compliance: row.payment_compliance,
    }))
  ), [filteredCasePaymentRows])

  const exportCasePaymentSummaryToPDF = async () => {
    try {
      if (!casePaymentSummaryRows.length) {
        toast({ title: 'No data to export', description: 'Adjust filters and try again.', variant: 'destructive' })
        return
      }
      const jsPDF = await loadJsPdfWithAutotable()
      const doc = new jsPDF()
      doc.setFontSize(16)
      doc.text('Case Payment Compliance Summary', 14, 20)
      doc.setFontSize(10)
      doc.text(`Generated on: ${format(new Date(), 'dd MMMM yyyy')}`, 14, 28)
      ;(doc as any).autoTable({
        head: [['Case', 'Type', 'Members', 'Paid', 'Partial', 'Unpaid', 'Expected', 'Net Paid', 'Paid/Total %']],
        body: casePaymentSummaryRows.map((row) => [
          row.case_number,
          row.case_type,
          row.eligible_members,
          row.paid_members,
          row.partial_members,
          row.unpaid_members,
          formatCurrency(row.expected_total),
          formatCurrency(row.net_paid_total),
          `${row.paid_amount_percent}%`,
        ]),
        startY: 35,
        styles: { fontSize: 7 },
        headStyles: { fillColor: [41, 128, 185] },
      })
      doc.save(createReportFilename('case_payment_compliance_summary', 'pdf'))
    } catch (error: any) {
      console.error('Error exporting case payment PDF:', error)
      toast({ title: 'Export failed', description: 'Failed to export case payment summary.', variant: 'destructive' })
    }
  }

  const exportCasePaymentSummaryToExcel = async () => {
    try {
      if (!casePaymentSummaryExportRows.length) {
        toast({ title: 'No data to export', description: 'Adjust filters and try again.', variant: 'destructive' })
        return
      }
      const XLSX = await loadXlsx()
      const ws = XLSX.utils.json_to_sheet(casePaymentSummaryExportRows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Case Payment Summary')
      XLSX.writeFile(wb, createReportFilename('case_payment_compliance_summary', 'xlsx'))
    } catch (error: any) {
      console.error('Error exporting case payment summary:', error)
      toast({ title: 'Export failed', description: 'Failed to export case payment summary.', variant: 'destructive' })
    }
  }

  const exportCasePaymentListToExcel = async () => {
    try {
      if (!casePaymentListExportRows.length) {
        toast({ title: 'No data to export', description: 'Adjust filters and try again.', variant: 'destructive' })
        return
      }
      const XLSX = await loadXlsx()
      const ws = XLSX.utils.json_to_sheet(casePaymentListExportRows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Case Payment List')
      XLSX.writeFile(wb, createReportFilename('case_payment_compliance_list', 'xlsx'))
    } catch (error: any) {
      console.error('Error exporting case payment list:', error)
      toast({ title: 'Export failed', description: 'Failed to export case payment list.', variant: 'destructive' })
    }
  }

  const exportCasePaymentSummaryToCSV = () => {
    if (!casePaymentSummaryExportRows.length) {
      toast({ title: 'No data to export', description: 'Adjust filters and try again.', variant: 'destructive' })
      return
    }
    const columns = Object.keys(casePaymentSummaryExportRows[0]).map((key) => ({ key, label: key.replace(/_/g, ' ').toUpperCase() }))
    exportRowsToCSV(createReportFilename('case_payment_compliance_summary', 'csv'), casePaymentSummaryExportRows, columns)
  }

  const exportCasePaymentListToCSV = () => {
    if (!casePaymentListExportRows.length) {
      toast({ title: 'No data to export', description: 'Adjust filters and try again.', variant: 'destructive' })
      return
    }
    const columns = Object.keys(casePaymentListExportRows[0]).map((key) => ({ key, label: key.replace(/_/g, ' ').toUpperCase() }))
    exportRowsToCSV(createReportFilename('case_payment_compliance_list', 'csv'), casePaymentListExportRows, columns)
  }

  const renderSkeletonRows = (cols: number) => (
    Array.from({ length: 5 }).map((_, i) => (
      <TableRow key={i}>
        {Array.from({ length: cols }).map((_, j) => (
          <TableCell key={j}>
            <Skeleton className="h-4 w-full" />
          </TableCell>
        ))}
      </TableRow>
    ))
  )

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Compliance Reports</h1>
            <p className="text-muted-foreground">Audit trails, reversals, and compliance monitoring</p>
          </div>
        </div>

        <ReportsSubnav />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Reversals</CardTitle>
              <FileCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{stats?.total_reversals_count || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    KES {stats?.total_reversals_amount?.toLocaleString() || '0'} reversed
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Compliance Issues</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{complianceIssues.length}</div>
                  <p className="text-xs text-muted-foreground">
                    {complianceIssues.filter((i) => i.severity === 'high' || i.severity === 'critical').length} critical/high
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Audit Entries</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{auditLogs.length}</div>
                  <p className="text-xs text-muted-foreground">Last 500 entries</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Suspense Pending</CardTitle>
              <UserCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{stats?.suspense_pending_count || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    KES {stats?.suspense_pending_amount?.toLocaleString() || '0'} pending
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={hasActiveFilters ? 'border-primary' : ''}
          >
            <Filter className="h-4 w-4 mr-2" />
            Filters
            {hasActiveFilters && (
              <span className="ml-1 h-2 w-2 rounded-full bg-primary" />
            )}
          </Button>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4 mr-1" />
              Clear All
            </Button>
          )}
        </div>

        {showFilters && (
          <Card>
            <CardContent className="pt-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Date Range</label>
                  <Select value={datePreset} onValueChange={(v) => { setDatePreset(v as any); setAuditPage(1) }}>
                    <SelectTrigger>
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7days">Last 7 Days</SelectItem>
                      <SelectItem value="30days">Last 30 Days</SelectItem>
                      <SelectItem value="90days">Last 90 Days</SelectItem>
                      <SelectItem value="thisYear">This Year</SelectItem>
                      <SelectItem value="all">All Time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Search Audit Logs</label>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by action, table, status..."
                      value={auditSearch}
                      onChange={(e) => { setAuditSearch(e.target.value); setAuditPage(1) }}
                      className="pl-8"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Severity Filter</label>
                  <Select value={severityFilter} onValueChange={setSeverityFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All severities" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Severities</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {hasActiveFilters && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {datePreset !== '30days' && (
                    <Badge variant="secondary">
                      Date: {datePreset === '7days' ? 'Last 7 Days' : datePreset === '90days' ? 'Last 90 Days' : datePreset === 'thisYear' ? 'This Year' : 'All Time'}
                      <button onClick={() => setDatePreset('30days')} className="ml-1 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                  {auditSearch && (
                    <Badge variant="secondary">
                      Search: {auditSearch}
                      <button onClick={() => { setAuditSearch(''); setAuditPage(1) }} className="ml-1 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                  {severityFilter !== 'all' && (
                    <Badge variant="secondary">
                      Severity: {severityFilter}
                      <button onClick={() => setSeverityFilter('all')} className="ml-1 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-4">
            <TabsTrigger value="case-payments" className="min-h-10 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm">Case Payments</TabsTrigger>
            <TabsTrigger value="audit" className="min-h-10 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm">Audit Trail</TabsTrigger>
            <TabsTrigger value="reversals" className="min-h-10 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm">Reversals Audit</TabsTrigger>
            <TabsTrigger value="compliance" className="min-h-10 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm">Compliance Issues</TabsTrigger>
          </TabsList>

          <TabsContent value="case-payments" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle>Case Payment Compliance</CardTitle>
                    <CardDescription>Active and probation member payment compliance for filterable cases</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={exportCasePaymentSummaryToPDF}>
                      <Download className="h-4 w-4 mr-2" />
                      Summary PDF
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportCasePaymentSummaryToExcel}>
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                      Summary Excel
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportCasePaymentSummaryToCSV}>
                      <Download className="h-4 w-4 mr-2" />
                      Summary CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportCasePaymentListToExcel}>
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                      List Excel
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportCasePaymentListToCSV}>
                      <Download className="h-4 w-4 mr-2" />
                      List CSV
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border p-4">
                    <p className="text-sm font-medium text-muted-foreground">Filtered Cases</p>
                    <div className="mt-2 text-2xl font-bold">{casePaymentSummaryRows.length.toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-sm font-medium text-muted-foreground">Eligible Members</p>
                    <div className="mt-2 text-2xl font-bold">{casePaymentMemberCount.toLocaleString()}</div>
                    <p className="text-xs text-muted-foreground">Active and probation only</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-sm font-medium text-muted-foreground">Expected Total</p>
                    <div className="mt-2 text-2xl font-bold">{formatCurrency(casePaymentTotals.expectedTotal)}</div>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-sm font-medium text-muted-foreground">Paid Against Total</p>
                    <div className="mt-2 text-2xl font-bold">{casePaymentTotals.paidAmountPercent.toLocaleString()}%</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="relative md:col-span-2">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search case number or type..."
                      value={casePaymentCaseSearch}
                      onChange={(e) => setCasePaymentCaseSearch(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  <Select value={casePaymentCaseStatus} onValueChange={(value: 'all' | 'active' | 'finalized' | 'closed') => setCasePaymentCaseStatus(value)}>
                    <SelectTrigger><SelectValue placeholder="Case status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Case Statuses</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="finalized">Finalized</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={casePaymentCaseType} onValueChange={setCasePaymentCaseType}>
                    <SelectTrigger><SelectValue placeholder="Case type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Case Types</SelectItem>
                      {casePaymentCaseTypeOptions.map((type) => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Case</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Members</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead className="text-right">Partial</TableHead>
                        <TableHead className="text-right">Unpaid</TableHead>
                        <TableHead className="text-right">Expected</TableHead>
                        <TableHead className="text-right">Net Paid</TableHead>
                        <TableHead className="text-right">Outstanding</TableHead>
                        <TableHead className="text-right">Paid/Total</TableHead>
                        <TableHead className="text-right">Paid Members</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? renderSkeletonRows(12) : casePaymentSummaryRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">No case payment compliance data found</TableCell>
                        </TableRow>
                      ) : (
                        casePaymentSummaryRows.map((row) => (
                          <TableRow key={row.case_id}>
                            <TableCell className="font-medium">{row.case_number}</TableCell>
                            <TableCell className="capitalize">{row.case_type}</TableCell>
                            <TableCell className="capitalize">{row.case_status}</TableCell>
                            <TableCell className="text-right">{row.eligible_members.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-primary">{row.paid_members.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{row.partial_members.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-destructive">{row.unpaid_members.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{formatCurrency(row.expected_total)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(row.net_paid_total)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(row.outstanding_total)}</TableCell>
                            <TableCell className="text-right font-medium">{row.paid_amount_percent.toLocaleString()}%</TableCell>
                            <TableCell className="text-right">{row.paid_members_percent.toLocaleString()}%</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-base font-semibold">Member Payment List</h3>
                      <p className="text-sm text-muted-foreground">The member list behind the filtered case-payment compliance report</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <div className="relative min-w-[240px]">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search member or case..."
                          value={casePaymentMemberSearch}
                          onChange={(e) => setCasePaymentMemberSearch(e.target.value)}
                          className="pl-8"
                        />
                      </div>
                      <Select value={casePaymentStatusFilter} onValueChange={(value: 'all' | 'paid' | 'partial' | 'unpaid') => setCasePaymentStatusFilter(value)}>
                        <SelectTrigger className="w-full sm:w-[170px]"><SelectValue placeholder="Payment status" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Payments</SelectItem>
                          <SelectItem value="paid">Paid</SelectItem>
                          <SelectItem value="partial">Partial</SelectItem>
                          <SelectItem value="unpaid">Unpaid</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Case</TableHead>
                          <TableHead>Member</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Expected</TableHead>
                          <TableHead className="text-right">Gross Paid</TableHead>
                          <TableHead className="text-right">Refunded</TableHead>
                          <TableHead className="text-right">Net Paid</TableHead>
                          <TableHead className="text-right">Outstanding</TableHead>
                          <TableHead>Compliance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loading ? renderSkeletonRows(9) : paginatedCasePaymentRows.data.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No member payment rows found</TableCell>
                          </TableRow>
                        ) : (
                          paginatedCasePaymentRows.data.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell>
                                <div>
                                  <p className="font-medium">{row.case_number}</p>
                                  <p className="text-xs text-muted-foreground capitalize">{row.case_type}</p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div>
                                  <p className="font-medium">{row.member_name}</p>
                                  <p className="text-xs text-muted-foreground">{row.member_number} · {row.member_status}</p>
                                </div>
                              </TableCell>
                              <TableCell className="capitalize">{row.case_status}</TableCell>
                              <TableCell className="text-right">{formatCurrency(row.expected_amount)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(row.gross_paid)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(row.total_refunded)}</TableCell>
                              <TableCell className="text-right font-medium">{formatCurrency(row.net_paid)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(row.outstanding_amount)}</TableCell>
                              <TableCell>
                                <Badge variant={row.payment_compliance === 'paid' ? 'default' : row.payment_compliance === 'partial' ? 'secondary' : 'destructive'} className="capitalize">
                                  {row.payment_compliance}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {!loading && paginatedCasePaymentRows.totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4">
                      <p className="text-sm text-muted-foreground">
                        Showing {(casePaymentPage - 1) * ITEMS_PER_PAGE + 1}-{Math.min(casePaymentPage * ITEMS_PER_PAGE, paginatedCasePaymentRows.total)} of {paginatedCasePaymentRows.total}
                      </p>
                      <Pagination>
                        <PaginationContent>
                          <PaginationItem>
                            <PaginationPrevious
                              onClick={() => setCasePaymentPage((p) => Math.max(1, p - 1))}
                              className={casePaymentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                            />
                          </PaginationItem>
                          {Array.from({ length: paginatedCasePaymentRows.totalPages }).slice(0, 7).map((_, i) => (
                            <PaginationItem key={i}>
                              <PaginationLink onClick={() => setCasePaymentPage(i + 1)} isActive={casePaymentPage === i + 1} className="cursor-pointer">
                                {i + 1}
                              </PaginationLink>
                            </PaginationItem>
                          ))}
                          <PaginationItem>
                            <PaginationNext
                              onClick={() => setCasePaymentPage((p) => Math.min(paginatedCasePaymentRows.totalPages, p + 1))}
                              className={casePaymentPage === paginatedCasePaymentRows.totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                            />
                          </PaginationItem>
                        </PaginationContent>
                      </Pagination>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Audit Trail</CardTitle>
                    <CardDescription>Who did what, and when — every system action with actor and timestamp</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <Select value={auditSession} onValueChange={(v) => { setAuditSession(v); setAuditPage(1) }}>
                      <SelectTrigger className="w-full sm:w-[260px]">
                        <SelectValue placeholder="Filter by session" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All sessions</SelectItem>
                        {auditSessions.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.label} — {s.time ? format(new Date(s.time), 'dd MMM HH:mm') : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={exportAuditToCSV}>
                      <Download className="h-4 w-4 mr-2" />
                      Export CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportAuditToPDF}>
                      <Download className="h-4 w-4 mr-2" />
                      Export PDF
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date/Time</TableHead>
                        <TableHead>Actor</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Details</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        renderSkeletonRows(5)
                      ) : paginatedAuditLogs.data.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                            No audit logs found
                          </TableCell>
                        </TableRow>
                      ) : (
                        paginatedAuditLogs.data.map((log) => {
                          const actor = formatAuditActor(log)
                          return (
                            <TableRow key={log.id}>
                              <TableCell className="text-sm whitespace-nowrap">
                                {formatAuditTimestamp(log)}
                              </TableCell>
                              <TableCell>
                                <div className="font-medium">{actor.name}</div>
                                {actor.detail && (
                                  <div className="text-xs text-muted-foreground">{actor.detail}</div>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{log.action}</Badge>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {auditDetails(log)}
                              </TableCell>
                              <TableCell>
                                <Badge variant={log.status === 'success' ? 'default' : 'destructive'}>
                                  {log.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          )
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
                {!loading && paginatedAuditLogs.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {(auditPage - 1) * ITEMS_PER_PAGE + 1}-{Math.min(auditPage * ITEMS_PER_PAGE, paginatedAuditLogs.total)} of {paginatedAuditLogs.total}
                    </p>
                    <Pagination>
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            onClick={() => setAuditPage(p => Math.max(1, p - 1))}
                            className={auditPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                          />
                        </PaginationItem>
                        {Array.from({ length: paginatedAuditLogs.totalPages }).map((_, i) => (
                          <PaginationItem key={i}>
                            <PaginationLink
                              onClick={() => setAuditPage(i + 1)}
                              isActive={auditPage === i + 1}
                              className="cursor-pointer"
                            >
                              {i + 1}
                            </PaginationLink>
                          </PaginationItem>
                        ))}
                        <PaginationItem>
                          <PaginationNext
                            onClick={() => setAuditPage(p => Math.min(paginatedAuditLogs.totalPages, p + 1))}
                            className={auditPage === paginatedAuditLogs.totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reversals" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Transaction Reversals</CardTitle>
                    <CardDescription>Complete audit of all transaction reversals</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={exportReversalsToExcel}>
                    <Download className="h-4 w-4 mr-2" />
                    Export Excel
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reversal Date</TableHead>
                        <TableHead>Member</TableHead>
                        <TableHead className="text-right">Reversal Amount</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Original Date</TableHead>
                        <TableHead className="text-right">Original Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        renderSkeletonRows(6)
                      ) : reversals.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            No reversals found
                          </TableCell>
                        </TableRow>
                      ) : (
                        reversals.map((reversal) => (
                          <TableRow key={reversal.reversal_id}>
                            <TableCell className="text-sm">
                              {format(new Date(reversal.reversal_date), 'dd MMM yyyy')}
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className="font-medium">{reversal.member_name}</p>
                                <p className="text-xs text-muted-foreground">{reversal.member_number}</p>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium text-destructive">
                              KES {Math.abs(reversal.reversal_amount).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-sm max-w-[200px] truncate">
                              {reversal.reason}
                            </TableCell>
                            <TableCell className="text-sm">
                              {reversal.original_transaction_date 
                                ? format(new Date(reversal.original_transaction_date), 'dd MMM yyyy') 
                                : '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              KES {Math.abs(reversal.original_amount || 0).toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="compliance" className="space-y-4">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Compliance Issues</CardTitle>
                  <CardDescription>
                    Automated compliance checks and recommendations
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="border rounded-lg p-4 flex items-start gap-4">
                        <Skeleton className="h-9 w-9 rounded-full" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-48" />
                          <Skeleton className="h-3 w-64" />
                          <Skeleton className="h-3 w-56" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filteredComplianceIssues.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="h-16 w-16 text-primary mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-primary">All Clear!</h3>
                    <p className="text-muted-foreground">No compliance issues detected</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredComplianceIssues.map((issue) => (
                      <div
                        key={issue.id}
                        className="border rounded-lg p-4 flex items-start gap-4"
                      >
                        <div className={`rounded-full p-2 ${severityColorMap[issue.severity] || 'bg-gray-600'}`}>
                          <AlertTriangle className="h-5 w-5 text-white" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold">{issue.issue_type}</h4>
                            <Badge variant="outline" className="text-xs">
                              {issue.severity.toUpperCase()}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">
                            {issue.description} - <span className="font-medium">{issue.affected_count} affected</span>
                          </p>
                          <p className="text-sm">
                            <span className="font-medium">Recommendation: </span>
                            {issue.recommendation}
                          </p>
                          {issue.details.length > 0 && (
                            <div className="mt-3 rounded-md bg-muted/50 p-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</p>
                              <ul className="mt-2 space-y-1 text-sm text-foreground">
                                {(expandedIssues[issue.id] ? issue.details : issue.details.slice(0, 5)).map((detail, index) => (
                                  <li key={`${issue.id}-detail-${index}`}>- {detail}</li>
                                ))}
                              </ul>
                              {issue.details.length > 5 && (
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="mt-2 h-auto p-0 text-xs"
                                  onClick={() => toggleIssueExpansion(issue.id)}
                                >
                                  {expandedIssues[issue.id]
                                    ? 'View less'
                                    : `View more (${issue.details.length - 5} more)`}
                                </Button>
                              )}
                              {issue.affected_count > issue.details.length && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  and {issue.affected_count - issue.details.length} more...
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}

export default ComplianceReports
