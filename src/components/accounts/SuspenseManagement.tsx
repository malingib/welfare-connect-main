import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { supabase } from '@/integrations/supabase/client'
import { invokeWithAppToken } from '@/lib/appAuth'
import { toast } from 'sonner'
import { Search, CheckCircle, XCircle, User, RefreshCw, AlertTriangle, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'

interface WrongMpesaTransaction {
  id: string
  mpesa_receipt_number: string | null
  phone_number: string | null
  amount: number | null
  sender_name: string | null
  transaction_date: string | null
  status: 'pending' | 'matched' | 'reversed' | 'ignored' | 'PENDING_REVIEW' | 'RESOLVED'
  matched_member_id?: string | null
  matched_at?: string | null
  matched_by?: string | null
  reversed_by?: string | null
  ignored_by?: string | null
  notes?: string | null
  source?: string | null
  reference?: string | null
  // NEW: Case reference fields
  intended_case_id?: string | null
  intended_member_id?: string | null
  reference_type?: string | null
  matched_member?: {
    name: string
    member_number: string
  } | null
  intended_case?: {
    id: string
    case_number: string
    case_type: string
    contribution_per_member: number
  } | null
  intended_member?: {
    id: string
    name: string
    member_number: string
  } | null
  registration_candidates?: RegistrationCandidate[]
}

interface RegistrationCandidate {
  id: string
  application_reference: string
  full_name: string
  phone_number: string
  status: string
  payment_code?: string | null
  amount_matches: boolean
  expected_amount: number
}

interface Member {
  id: string
  member_number: string
  name: string
  phone_number: string
}

export function SuspenseManagement() {
  const [transactions, setTransactions] = useState<WrongMpesaTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [searchReceipt, setSearchReceipt] = useState('')
  const [isMatching, setIsMatching] = useState(false)
  const [tableExists, setTableExists] = useState(true)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Member search dialog state
  const [selectedTransaction, setSelectedTransaction] = useState<WrongMpesaTransaction | null>(null)
  const [memberSearchOpen, setMemberSearchOpen] = useState(false)
  const [memberSearchTerm, setMemberSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<Member[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [registrationMatchOpen, setRegistrationMatchOpen] = useState(false)
  const [registrationCandidates, setRegistrationCandidates] = useState<RegistrationCandidate[]>([])
  const [isRegistrationMatching, setIsRegistrationMatching] = useState(false)

  // Auto-match confirmation dialog
  const [autoMatchDialogOpen, setAutoMatchDialogOpen] = useState(false)

  // Manual insert dialog state
  const [manualInsertOpen, setManualInsertOpen] = useState(false)
  const [manualInsertData, setManualInsertData] = useState({
    mpesa_receipt_number: '',
    phone_number: '',
    amount: '',
    sender_name: '',
    reference: ''
  })
  const [isInserting, setIsInserting] = useState(false)

  const checkTableExists = async () => true

  const fetchSuspenseTransactions = async (showRefreshing = false) => {
    await checkTableExists()

    if (showRefreshing) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    try {
      const loadOnce = async () => {
        const response = await invokeWithAppToken<{ transactions: WrongMpesaTransaction[] }>('api-suspense-list', {})
        return response?.transactions || []
      }

      let rows: WrongMpesaTransaction[] = []
      try {
        rows = await loadOnce()
      } catch (firstError) {
        // Transient startup race (token/storage/network) can fail first call; retry once quietly.
        await new Promise((resolve) => setTimeout(resolve, 400))
        rows = await loadOnce()
      }

      setTransactions(rows)
      setCurrentPage(1) // Reset to first page on fetch
    } catch (error: any) {
      toast.error('Error loading suspense transactions', {
        description: error.message,
      })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const handleAutoMatchClick = () => {
    if (pendingCount === 0) {
      toast.info('No pending transactions', {
        description: 'There are no transactions to auto-match',
      })
      return
    }
    setAutoMatchDialogOpen(true)
  }

  const handleAutoMatch = async () => {
    setAutoMatchDialogOpen(false)
    setIsMatching(true)
    try {
      const { data, error } = await supabase.rpc('match_suspense_transactions')

      if (error) throw error

      const matchCount = typeof data === 'number' ? data : 0

      toast.success('Auto-match complete', {
        description: `${matchCount} transaction(s) matched and processed`,
      })

      await fetchSuspenseTransactions()
    } catch (error: any) {
      toast.error('Auto-match failed', {
        description: error.message,
      })
    } finally {
      setIsMatching(false)
    }
  }

  const handleManualInsert = async () => {
    if (!manualInsertData.mpesa_receipt_number || !manualInsertData.phone_number || !manualInsertData.amount) {
      toast.error('Please fill in all required fields')
      return
    }

    setIsInserting(true)
    try {
      const { error } = await (supabase.from('wrong_mpesa_transactions') as any).insert({
        mpesa_receipt_number: manualInsertData.mpesa_receipt_number,
        phone_number: manualInsertData.phone_number,
        amount: Number(manualInsertData.amount),
        sender_name: manualInsertData.sender_name || 'Manual Entry',
        reference: manualInsertData.reference || null,
        status: 'pending',
        source: 'manual'
      })

      if (error) throw error

      toast.success('Transaction added to suspense', {
        description: `Added KES ${Number(manualInsertData.amount).toLocaleString()} from ${manualInsertData.phone_number}`,
      })

      setManualInsertOpen(false)
      setManualInsertData({
        mpesa_receipt_number: '',
        phone_number: '',
        amount: '',
        sender_name: '',
        reference: ''
      })
      await fetchSuspenseTransactions()
    } catch (error: any) {
      toast.error('Failed to add transaction', {
        description: error.message,
      })
    } finally {
      setIsInserting(false)
    }
  }

  const handleManualMatch = async (memberId: string, caseId?: string) => {
    if (!selectedTransaction) return

    setIsMatching(true)
    try {
      const targetCaseId = caseId || selectedTransaction.intended_case_id || null
      const isCasePayment = !!targetCaseId

      const result = await invokeWithAppToken<any>('api-suspense-match', {
        suspense_id: selectedTransaction.id,
        member_id: memberId,
        case_id: targetCaseId,
      })
      const deduplicated = !!result?.deduplicated

      toast.success('Transaction matched successfully', {
        description: deduplicated
          ? 'Duplicate receipt detected; existing transaction kept and suspense marked matched.'
          : isCasePayment
          ? `Payment allocated to member account and linked to case`
          : `Payment allocated to member account`,
      })

      setMemberSearchOpen(false)
      setSelectedTransaction(null)
      await fetchSuspenseTransactions()
    } catch (error: any) {
      toast.error('Match failed', {
        description: error.message,
      })
    } finally {
      setIsMatching(false)
    }
  }

  const handleReverse = async (transactionId: string) => {
    if (!confirm('Are you sure you want to mark this transaction as reversed?')) return

    try {
      const { error } = await (supabase
        .from('wrong_mpesa_transactions') as any)
        .update({ status: 'reversed' })
        .eq('id', transactionId)

      if (error) throw error

      toast.success('Transaction marked as reversed', {
        description: 'This transaction will no longer appear in pending list',
      })

      await fetchSuspenseTransactions()
    } catch (error: any) {
      toast.error('Reversal failed', {
        description: error.message,
      })
    }
  }

  const handleIgnore = async (transactionId: string) => {
    if (!confirm('Mark this transaction as ignored?')) return

    try {
      const { error } = await (supabase
        .from('wrong_mpesa_transactions') as any)
        .update({ status: 'ignored' })
        .eq('id', transactionId)

      if (error) throw error

      toast.success('Transaction ignored', {
        description: 'This transaction has been marked as ignored',
      })

      await fetchSuspenseTransactions()
    } catch (error: any) {
      toast.error('Failed to ignore transaction', {
        description: error.message,
      })
    }
  }

  const openMemberSearch = (transaction: WrongMpesaTransaction) => {
    setSelectedTransaction(transaction)
    setMemberSearchTerm('')
    setSearchResults([])
    setMemberSearchOpen(true)
  }

  const openRegistrationMatch = (transaction: WrongMpesaTransaction) => {
    setSelectedTransaction(transaction)
    setRegistrationCandidates(transaction.registration_candidates || [])
    setRegistrationMatchOpen(true)
  }

  const handleRegistrationMatch = async (candidate: RegistrationCandidate) => {
    if (!selectedTransaction || !candidate.amount_matches) return
    if (!confirm(`Activate ${candidate.full_name} using receipt ${selectedTransaction.mpesa_receipt_number}?`)) return

    setIsRegistrationMatching(true)
    try {
      const result = await invokeWithAppToken<{ member_number: string; application: string }>('api-membership-applications', {
        action: 'match_suspense_payment',
        suspense_id: selectedTransaction.id,
        application_id: candidate.id,
      })
      toast.success('Registration payment matched', {
        description: `${candidate.full_name} activated as member ${result.member_number}.`,
      })
      setRegistrationMatchOpen(false)
      setSelectedTransaction(null)
      await fetchSuspenseTransactions()
    } catch (error: any) {
      toast.error('Registration match failed', { description: error.message })
    } finally {
      setIsRegistrationMatching(false)
    }
  }

  const searchMembers = async () => {
    if (!memberSearchTerm.trim()) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    try {
      const { data, error } = await supabase
        .from('members')
        .select('id, member_number, name, phone_number')
        .or(`phone_number.ilike.%${memberSearchTerm}%,member_number.ilike.%${memberSearchTerm}%,name.ilike.%${memberSearchTerm}%`)
        .limit(10)

      if (error) throw error

      setSearchResults(data || [])
    } catch (error: any) {
      toast.error('Search failed', {
        description: error.message,
      })
    } finally {
      setIsSearching(false)
    }
  }

  useEffect(() => {
    fetchSuspenseTransactions()

    const channel = supabase
      .channel('wrong-mpesa-transactions-live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'wrong_mpesa_transactions',
        },
        () => {
          fetchSuspenseTransactions(true)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (memberSearchOpen) {
        searchMembers()
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [memberSearchTerm, memberSearchOpen])

  // Filter transactions by search and status
  const filteredTransactions = transactions.filter((t) => {
    const matchesSearch = searchReceipt === '' ||
      (t.mpesa_receipt_number?.toLowerCase().includes(searchReceipt.toLowerCase()) ?? false)

    const matchesStatus = statusFilter === 'all' || t.status === statusFilter

    return matchesSearch && matchesStatus
  })

  // Pagination
  const totalPages = Math.ceil(filteredTransactions.length / pageSize)
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const paginatedTransactions = filteredTransactions.slice(startIndex, endIndex)

  const pendingCount = transactions.filter((t) => t.status === 'pending' || t.status === 'PENDING_REVIEW').length

  return (
    <>
      {!tableExists ? (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-red-600" />
              <div>
                <CardTitle className="text-red-900">Suspense Account Table Not Found</CardTitle>
                <CardDescription className="text-red-700">
                  The required database table needs to be created first
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-sm text-red-800">
                The <code className="bg-red-100 px-2 py-1 rounded">wrong_mpesa_transactions</code> table doesn't exist in your database yet.
                Please run the SQL migration to create it.
              </p>

              <div className="bg-white border border-red-200 rounded-lg p-4">
                <h4 className="font-semibold text-red-900 mb-2">How to fix:</h4>
                <ol className="text-sm text-red-800 space-y-2 list-decimal list-inside">
                  <li>Go to <a href="https://supabase.com/dashboard/project/hfojxbfcjozguobwtcgt/sql/new" target="_blank" rel="noopener noreferrer" className="underline font-medium">Supabase SQL Editor</a></li>
                  <li>Copy the SQL below</li>
                  <li>Paste and click <strong>Run</strong></li>
                  <li>Refresh this page</li>
                </ol>
              </div>

              <div className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto">
                <pre className="text-xs font-mono">
                  {`CREATE TABLE IF NOT EXISTS wrong_mpesa_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mpesa_receipt_number VARCHAR(100) UNIQUE NOT NULL,
    phone_number VARCHAR(50) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    sender_name VARCHAR(255),
    transaction_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'reversed', 'ignored')),
    matched_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
    matched_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wrong_mpesa_phone ON wrong_mpesa_transactions(phone_number);
CREATE INDEX IF NOT EXISTS idx_wrong_mpesa_status ON wrong_mpesa_transactions(status);
CREATE INDEX IF NOT EXISTS idx_wrong_mpesa_matched ON wrong_mpesa_transactions(matched_member_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_wrong_mpesa_updated_at') THEN
        CREATE TRIGGER update_wrong_mpesa_updated_at
            BEFORE UPDATE ON wrong_mpesa_transactions
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;`}
                </pre>
              </div>

              <Button onClick={() => fetchSuspenseTransactions()} className="bg-red-600 hover:bg-red-700">
                <RefreshCw className="h-4 w-4 mr-2" />
                Check Again
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
              <div>
                <CardTitle className="text-lg md:text-xl">Suspense Account Management</CardTitle>
                <CardDescription className="text-xs md:text-sm mt-1">
                  Manage unmatched M-Pesa payments and allocate to member accounts
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={(e) => {
                    e.preventDefault()
                    fetchSuspenseTransactions(true)
                  }}
                  disabled={loading || refreshing}
                  className="text-xs md:text-sm h-9"
                >
                  <RefreshCw className={`mr-2 h-3.5 w-3.5 md:h-4 md:w-4 ${refreshing ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
                <Button onClick={handleAutoMatchClick} disabled={isMatching || pendingCount === 0} className="text-xs md:text-sm h-9">
                  <RefreshCw className={`mr-2 h-3.5 w-3.5 md:h-4 md:w-4 ${isMatching ? 'animate-spin' : ''}`} />
                  <span className="hidden lg:inline">Auto-Match All</span>
                  <span className="lg:hidden">Auto-Match</span>
                  <span className="ml-1">({pendingCount})</span>
                </Button>
                <Button variant="outline" onClick={() => setManualInsertOpen(true)} className="text-xs md:text-sm h-9">
                  <Plus className="mr-2 h-3.5 w-3.5 md:h-4 md:w-4" />
                  <span className="hidden sm:inline">Add Manual</span>
                  <span className="sm:hidden">Add</span>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Search and Filters */}
            <div className="mb-4 md:mb-6 space-y-3 md:space-y-4">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <Input
                  placeholder="Search by receipt..."
                  value={searchReceipt}
                  onChange={(e) => {
                    setSearchReceipt(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="flex-1 text-sm"
                />
              </div>

              {/* Status Filter */}
              <div className="flex flex-wrap items-center gap-2">
                <Label className="whitespace-nowrap text-xs md:text-sm">Status:</Label>
                <Select value={statusFilter} onValueChange={(value) => {
                  setStatusFilter(value)
                  setCurrentPage(1)
                }}>
                  <SelectTrigger className="w-full sm:w-48 text-xs md:text-sm h-9">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses ({transactions.length})</SelectItem>
                    <SelectItem value="pending">
                      Pending ({transactions.filter((t) => t.status === 'pending').length})
                    </SelectItem>
                    <SelectItem value="PENDING_REVIEW">
                      Pending Review ({transactions.filter((t) => t.status === 'PENDING_REVIEW').length})
                    </SelectItem>
                    <SelectItem value="matched">
                      Matched ({transactions.filter((t) => t.status === 'matched').length})
                    </SelectItem>
                    <SelectItem value="RESOLVED">
                      Resolved ({transactions.filter((t) => t.status === 'RESOLVED').length})
                    </SelectItem>
                    <SelectItem value="reversed">
                      Reversed ({transactions.filter((t) => t.status === 'reversed').length})
                    </SelectItem>
                    <SelectItem value="ignored">
                      Ignored ({transactions.filter((t) => t.status === 'ignored').length})
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Results info */}
              <div className="text-xs md:text-sm text-muted-foreground">
                Showing {paginatedTransactions.length > 0 ? startIndex + 1 : 0} to {Math.min(endIndex, filteredTransactions.length)} of {filteredTransactions.length}
              </div>
            </div>

            {/* Table */}
            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs md:text-sm whitespace-nowrap px-2 md:px-4">M-Pesa Receipt</TableHead>
                      <TableHead className="text-xs md:text-sm whitespace-nowrap px-2 md:px-4">Sender Name</TableHead>
                      <TableHead className="text-right text-xs md:text-sm whitespace-nowrap px-2 md:px-4">Amount</TableHead>
                      <TableHead className="text-xs md:text-sm whitespace-nowrap px-2 md:px-4">Date & Time</TableHead>
                      <TableHead className="text-xs md:text-sm whitespace-nowrap px-2 md:px-4">Status</TableHead>
                      <TableHead className="text-xs md:text-sm whitespace-nowrap px-2 md:px-4">Matched Member</TableHead>
                      <TableHead className="text-xs md:text-sm whitespace-nowrap px-2 md:px-4">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 md:py-12">
                          <div className="flex items-center justify-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-xs md:text-sm">Loading suspense transactions...</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : paginatedTransactions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 md:py-12 text-xs md:text-sm text-muted-foreground">
                          {filteredTransactions.length === 0 ? 'No results for this search' : 'No suspense transactions found'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedTransactions.map((tx) => (
                        <TableRow key={tx.id}>
                          <TableCell className="font-medium text-xs md:text-sm px-2 md:px-4 whitespace-nowrap">{tx.mpesa_receipt_number || 'N/A'}</TableCell>
                          <TableCell className="text-xs md:text-sm px-2 md:px-4 whitespace-nowrap truncate max-w-[120px] md:max-w-none">{tx.sender_name || 'N/A'}</TableCell>
                          <TableCell className="text-right font-medium text-xs md:text-sm px-2 md:px-4 whitespace-nowrap">
                            {tx.amount ? `KES ${Number(tx.amount).toLocaleString()}` : 'N/A'}
                          </TableCell>
                          <TableCell className="text-xs md:text-sm px-2 md:px-4 whitespace-nowrap">
                            {tx.transaction_date ? new Date(tx.transaction_date).toLocaleString('en-KE', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            }) : 'N/A'}
                          </TableCell>
                          <TableCell className="px-2 md:px-4">
                            <Badge
                              variant={
                                tx.status === 'pending'
                                  ? 'secondary'
                                  : tx.status === 'PENDING_REVIEW'
                                    ? 'secondary'
                                    : tx.status === 'matched'
                                      ? 'default'
                                      : tx.status === 'reversed'
                                        ? 'destructive'
                                        : tx.status === 'RESOLVED'
                                          ? 'outline'
                                          : 'outline'
                              }
                              className="text-[10px] md:text-xs"
                            >
                              {tx.status === 'PENDING_REVIEW' ? 'Pending Review' : tx.status === 'RESOLVED' ? 'Resolved' : tx.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs md:text-sm px-2 md:px-4">
                            {tx.matched_member ? (
                              <div className="min-w-0">
                                <p className="font-medium truncate">{tx.matched_member.name}</p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {tx.matched_member.member_number}
                                </p>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">Unmatched</span>
                            )}
                          </TableCell>
                          <TableCell className="px-2 md:px-4 whitespace-nowrap">
                            {(tx.status === 'pending' || tx.status === 'PENDING_REVIEW') && (
                              <div className="flex gap-1 md:gap-2">
                                {(tx.registration_candidates?.length || 0) > 0 && (
                                  <Button
                                    size="sm"
                                    variant="default"
                                    onClick={() => openRegistrationMatch(tx)}
                                    className="h-7 md:h-8 text-xs"
                                  >
                                    <CheckCircle className="mr-1 h-3 w-3 md:h-4 md:w-4" />
                                    <span className="hidden lg:inline">Registration</span>
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openMemberSearch(tx)}
                                  className="h-7 md:h-8 text-xs"
                                >
                                  <User className="mr-1 h-3 w-3 md:h-4 md:w-4" />
                                  <span className="hidden lg:inline">Match</span>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleReverse(tx.id)}
                                  title="Mark as reversed"
                                  className="h-7 md:h-8 w-7 md:w-8 p-0"
                                >
                                  <XCircle className="h-3 w-3 md:h-4 md:w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleIgnore(tx.id)}
                                  title="Mark as ignored"
                                  className="h-7 md:h-8 w-7 md:w-8 p-0"
                                >
                                  <CheckCircle className="h-3 w-3 md:h-4 md:w-4" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Pagination Controls */}
            {filteredTransactions.length > 0 && (
              <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-xs md:text-sm text-muted-foreground text-center sm:text-left">
                  Page {currentPage} of {totalPages}
                </div>
                <div className="flex gap-1.5 md:gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="text-xs md:text-sm h-8 md:h-9"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    className="text-xs md:text-sm h-8 md:h-9"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Auto-Match Confirmation Dialog */}
      <Dialog open={autoMatchDialogOpen} onOpenChange={setAutoMatchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Auto-Match</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p>
              This will attempt to automatically match all <strong>{pendingCount} pending</strong> suspense transactions to member accounts by phone number.
            </p>
            <div className="bg-muted p-3 rounded-lg">
              <p className="text-sm">
                <strong>Note:</strong> Only transactions with matching phone numbers will be processed. Unmatched transactions will remain pending.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAutoMatchDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAutoMatch} disabled={isMatching}>
              {isMatching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isMatching ? 'Matching...' : 'Confirm Auto-Match'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Member Search Dialog */}
      <Dialog open={registrationMatchOpen} onOpenChange={setRegistrationMatchOpen}>
        <DialogContent className="w-[95vw] sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Match Registration Payment</DialogTitle>
          </DialogHeader>
          {selectedTransaction && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
                <p><strong>Receipt:</strong> {selectedTransaction.mpesa_receipt_number || 'N/A'}</p>
                <p><strong>Sender phone:</strong> {selectedTransaction.phone_number || 'N/A'}</p>
                <p><strong>Amount:</strong> KES {Number(selectedTransaction.amount || 0).toLocaleString()}</p>
                <p className="text-muted-foreground">Candidates are suggested by the payer phone. Confirm the applicant before activating.</p>
              </div>
              <div className="divide-y rounded-lg border">
                {registrationCandidates.map((candidate) => (
                  <div key={candidate.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{candidate.full_name}</p>
                      <p className="text-xs text-muted-foreground">{candidate.application_reference} · {candidate.phone_number}</p>
                      <p className="text-xs text-muted-foreground capitalize">{candidate.status.replaceAll('_', ' ')}</p>
                    </div>
                    <Button size="sm" onClick={() => void handleRegistrationMatch(candidate)} disabled={!candidate.amount_matches || isRegistrationMatching}>
                      {candidate.amount_matches ? 'Confirm & activate' : `Amount must be KES ${candidate.expected_amount.toLocaleString()}`}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegistrationMatchOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={memberSearchOpen} onOpenChange={setMemberSearchOpen}>
        <DialogContent className="w-[95vw] sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Match to Member</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Transaction Details */}
            {selectedTransaction && (
              <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
                <p>
                  <strong>Amount:</strong> KES {selectedTransaction.amount.toLocaleString()}
                </p>
                <p>
                  <strong>Phone:</strong> {selectedTransaction.phone_number}
                </p>
                <p>
                  <strong>Receipt:</strong> {selectedTransaction.mpesa_receipt_number}
                </p>
                {selectedTransaction.reference && (
                  <p>
                    <strong>Reference:</strong> {selectedTransaction.reference}
                  </p>
                )}
                {selectedTransaction.intended_case && (
                  <p className="text-purple-700 font-medium">
                    📋 Intended Case: {selectedTransaction.intended_case.case_number} ({selectedTransaction.intended_case.case_type})
                  </p>
                )}
                {selectedTransaction.intended_member && (
                  <p className="text-blue-700 font-medium">
                    👤 Intended Member: {selectedTransaction.intended_member.member_number} ({selectedTransaction.intended_member.name})
                  </p>
                )}
              </div>
            )}

            {/* Search Input */}
            <div className="space-y-2">
              <Label>Search Member</Label>
              <Input
                placeholder="Search by name, member number, or phone..."
                value={memberSearchTerm}
                onChange={(e) => setMemberSearchTerm(e.target.value)}
              />
            </div>

            {/* Search Results */}
            <div className="border rounded-lg max-h-[300px] overflow-y-auto">
              {isSearching ? (
                <div className="p-4 text-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
                  Searching...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  {memberSearchTerm ? 'No members found' : 'Start typing to search'}
                </div>
              ) : (
                <div className="divide-y">
                  {searchResults.map((member) => (
                    <button
                      key={member.id}
                      className="w-full p-3 text-left hover:bg-muted transition-colors flex items-center justify-between"
                      onClick={() => handleManualMatch(member.id, selectedTransaction?.intended_case_id || undefined)}
                      disabled={isMatching}
                    >
                      <div>
                        <p className="font-medium">{member.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {member.member_number} • {member.phone_number}
                        </p>
                      </div>
                      <User className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMemberSearchOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Insert Dialog */}
      <Dialog open={manualInsertOpen} onOpenChange={setManualInsertOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Manual Suspense Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Manually add a transaction to suspense when the webhook fails to capture it automatically.
            </p>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="receipt">M-Pesa Receipt Number *</Label>
                <Input
                  id="receipt"
                  placeholder="e.g., MLB123456789"
                  value={manualInsertData.mpesa_receipt_number}
                  onChange={(e) => setManualInsertData({ ...manualInsertData, mpesa_receipt_number: e.target.value })}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="phone">Phone Number *</Label>
                <Input
                  id="phone"
                  placeholder="e.g., +2547XXXXXXXX"
                  value={manualInsertData.phone_number}
                  onChange={(e) => setManualInsertData({ ...manualInsertData, phone_number: e.target.value })}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="amount">Amount (KES) *</Label>
                <Input
                  id="amount"
                  type="number"
                  placeholder="e.g., 1000"
                  value={manualInsertData.amount}
                  onChange={(e) => setManualInsertData({ ...manualInsertData, amount: e.target.value })}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="sender">Sender Name</Label>
                <Input
                  id="sender"
                  placeholder="e.g., JOHN DOE"
                  value={manualInsertData.sender_name}
                  onChange={(e) => setManualInsertData({ ...manualInsertData, sender_name: e.target.value })}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="ref">Account Reference</Label>
                <Input
                  id="ref"
                  placeholder="e.g., Case44 or member number"
                  value={manualInsertData.reference}
                  onChange={(e) => setManualInsertData({ ...manualInsertData, reference: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualInsertOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleManualInsert} disabled={isInserting}>
              {isInserting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add to Suspense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
