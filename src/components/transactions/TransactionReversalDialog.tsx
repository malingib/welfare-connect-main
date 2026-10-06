import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import type { Database } from '@/integrations/supabase/types'
import { Transaction } from '@/lib/types'
import { buildSupabaseFunctionUrl, getAppToken } from '@/lib/appAuth'

interface TransactionReversalDialogProps {
  transaction: Transaction | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function TransactionReversalDialog({
  transaction,
  open,
  onOpenChange,
  onSuccess,
}: TransactionReversalDialogProps) {
  const [reason, setReason] = useState('')
  const [isReversing, setIsReversing] = useState(false)
  const [useMpesaReversal, setUseMpesaReversal] = useState(false)

  if (!transaction) return null

  const canReverse = transaction.status !== 'reversed'

  const handleReversal = async () => {
    if (!reason.trim()) {
      toast.error('Reversal failed', {
        description: 'Please provide a reason for reversal',
      })
      return
    }

    setIsReversing(true)

    try {
      const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}')
      if (!currentUser?.id) {
        throw new Error('Current user could not be determined')
      }

      const userRole = currentUser?.role
      const isAdminRole = ['super_admin', 'treasurer', 'chairperson'].includes(userRole)
      if (!isAdminRole) {
        throw new Error('You do not have permission to reverse transactions')
      }

      if (useMpesaReversal && transaction.paymentMethod === 'mpesa') {
        const mpesaReceipt = transaction.mpesaReference
        if (!mpesaReceipt) {
          throw new Error('M-Pesa receipt number is required for reversal. The transaction has no M-Pesa reference.')
        }

        const appToken = getAppToken()
        if (!appToken) {
          throw new Error('Session expired. Please login again.')
        }

        const endpoint = buildSupabaseFunctionUrl('mpesa-reversal')

        const reversalResp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-app-token': appToken,
          },
          body: JSON.stringify({
            transactionId: transaction.id,
            mpesaReceiptNumber: mpesaReceipt,
            amount: Math.abs(transaction.amount),
            memberId: transaction.memberId,
            reason: `Reversal: ${reason}`,
          }),
        })

        const reversalJson = await reversalResp.json().catch(() => ({}))
        if (!reversalResp.ok) {
          const message =
            String((reversalJson as { error?: unknown }).error || '').trim() ||
            `Reversal request failed with status ${reversalResp.status}`
          throw new Error(message)
        }

        const respCode = String((reversalJson as { ResponseCode?: unknown }).ResponseCode ?? '').trim()
        if (respCode !== '' && respCode !== '0') {
          const message =
            String((reversalJson as { ResponseDescription?: unknown }).ResponseDescription || '').trim() ||
            'Daraja reversal was not accepted'
          throw new Error(message)
        }
      }

      const reversalArgs: Database['public']['Functions']['revert_transaction']['Args'] = {
        p_transaction_id: transaction.id,
        p_admin_id: currentUser.id,
        p_reason: reason,
      }
      const { data, error } = await (supabase.rpc as any)('revert_transaction', reversalArgs)

      if (error) throw error

      const result = (data ?? {}) as { success?: boolean; message?: string }
      if (typeof result === 'object' && result !== null && result.success === false) {
        throw new Error(result.message || 'Reversal failed')
      }

      toast.success('Reversal successful', {
        description: 'Transaction has been reversed successfully',
      })

      setReason('')
      setUseMpesaReversal(false)
      onSuccess()
      onOpenChange(false)
    } catch (error: any) {
      console.error('Reversal error:', error)
      toast.error('Reversal failed', {
        description: error.message || 'An error occurred during reversal',
      })
    } finally {
      setIsReversing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Reverse Transaction</DialogTitle>
          <DialogDescription>
            This will create a reversing entry and adjust the member&apos;s wallet balance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-lg bg-muted/50 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Amount</span>
              <span className="font-semibold">
                KES {Math.abs(transaction.amount).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Type</span>
              <span className="capitalize">{transaction.transactionType.replace(/_/g, ' ')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Payment Method</span>
              <span className="capitalize">{transaction.paymentMethod || 'cash'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Date</span>
              <span>
                {transaction.createdAt.toLocaleDateString('en-KE', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            {transaction.status === 'reversed' && (
              <div className="border-t pt-2">
                <span className="text-xs font-medium text-red-600">
                  This transaction has already been reversed
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reversal Reason *</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Wrong amount entered, Duplicate payment, Incorrect member..."
              className="min-h-[100px]"
              disabled={isReversing || !canReverse}
            />
          </div>

          {transaction.paymentMethod === 'mpesa' && canReverse && (
            <div className="flex items-start space-x-3 rounded-lg border border-blue-100 bg-blue-50 p-3">
              <Switch
                id="mpesa-reversal"
                checked={useMpesaReversal}
                onCheckedChange={setUseMpesaReversal}
                disabled={isReversing}
              />
              <div className="space-y-1">
                <Label htmlFor="mpesa-reversal" className="cursor-pointer text-sm font-medium">
                  Process M-Pesa reversal
                </Label>
                <p className="text-xs text-muted-foreground">
                  This will reverse the original M-Pesa transaction via the Safaricom Reversal API.
                </p>
              </div>
            </div>
          )}

          {canReverse && (
            <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
              <p className="text-xs text-amber-800">
                <strong>Warning:</strong> This action cannot be undone. A reversal entry will be
                created in the transaction log.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setReason('')
              setUseMpesaReversal(false)
              onOpenChange(false)
            }}
            disabled={isReversing}
          >
            Cancel
          </Button>
          <Button
            variant={canReverse ? 'destructive' : 'secondary'}
            onClick={handleReversal}
            disabled={isReversing || !canReverse}
          >
            {isReversing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              'Reverse Transaction'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
