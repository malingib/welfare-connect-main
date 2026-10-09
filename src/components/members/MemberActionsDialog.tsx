import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/use-toast'
import { Member } from '@/lib/types'
import { AlertTriangle } from 'lucide-react'
import { invokeWithAppToken } from '@/lib/appAuth'

interface MemberActionsDialogProps {
  member: Member | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

type TransitionHistoryRow = {
  id: string
  from_status: string | null
  to_status: string
  reason: string
  performed_by_role: string | null
  created_at: string
}

export function MemberActionsDialog({
  member,
  open,
  onOpenChange,
  onSuccess,
}: MemberActionsDialogProps) {
  const [newStatus, setNewStatus] = useState<'probation' | 'active' | 'inactive' | 'deceased'>('active')
  const [isProcessing, setIsProcessing] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyRows, setHistoryRows] = useState<TransitionHistoryRow[]>([])

  useEffect(() => {
    if (!member) return
    setNewStatus((member.status || 'active') as 'probation' | 'active' | 'inactive' | 'deceased')
    setShowDeleteConfirm(false)
    setHistoryRows([])
  }, [member, open])

  useEffect(() => {
    if (!open || !member) return
    let active = true

    const loadHistory = async () => {
      setHistoryLoading(true)
      try {
        const data = await invokeWithAppToken<{ transitions: TransitionHistoryRow[] }>('api-member-status-history', {
          member_id: member.id,
          limit: 10,
        })
        if (!active) return
        setHistoryRows(data.transitions || [])
      } catch (error: any) {
        if (!active) return
        setHistoryRows([])
        toast({
          variant: 'destructive',
          title: 'Could not load status history',
          description: error?.message || 'Failed to fetch transition audit trail.',
        })
      } finally {
        if (active) setHistoryLoading(false)
      }
    }

    loadHistory()

    return () => {
      active = false
    }
  }, [open, member])

  if (!member) {
    return null
  }

  const handleStatusChange = async () => {
    if (newStatus === member.status) {
      toast({ title: 'No changes', description: 'Status is unchanged.' })
      return
    }

    setIsProcessing(true)

    try {
      await invokeWithAppToken('api-member-status-update', {
        member_id: member.id,
        status: newStatus,
      })

      toast({
        title: 'Status updated',
        description: `Member status changed to ${newStatus}`,
      })

      onSuccess()
      onOpenChange(false)
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Update failed',
        description: error.message,
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDeleteMember = async () => {
    setIsProcessing(true)

    try {
      const result = await invokeWithAppToken<{ success: boolean; message: string }>('api-member-delete', {
        member_id: member.id,
      })
      if (!result.success) {
        throw new Error(result.message)
      }

      toast({
        title: result.message,
        variant: result.success ? 'default' : 'destructive',
      })

      if (result.success) {
        onSuccess()
        onOpenChange(false)
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: error.message,
      })
    } finally {
      setIsProcessing(false)
      setShowDeleteConfirm(false)
    }
  }

  const canDelete = member.walletBalance === 0
  const isInactive = String(member.status || '').toLowerCase() === 'inactive'

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Member</DialogTitle>
            <DialogDescription>
              Update eligible member statuses or remove a member from the system
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="p-4 bg-muted/50 rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Name</span>
                <span className="font-medium">{member.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Member Number</span>
                <span className="font-medium">{member.memberNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Current Status</span>
                <span className="capitalize">{member.status || 'active'}</span>
              </div>
              <div className="flex justify-between pt-2 border-t">
                <span className="text-sm text-muted-foreground">Wallet Balance</span>
                <span
                  className={`font-semibold ${
                    member.walletBalance < 0
                      ? 'text-red-600'
                      : member.walletBalance > 0
                        ? 'text-green-600'
                        : ''
                  }`}
                >
                  KES {member.walletBalance.toLocaleString()}
                </span>
              </div>
            </div>

            {isInactive && (
              <div className="space-y-3 rounded-lg border p-3 bg-muted/20">
                <p className="font-medium">Automatic Reactivation</p>
                <p className="text-sm text-muted-foreground">
                  Wallet top-ups first settle the KES 300 reinstatement penalty. Once fully paid, the member automatically moves to probation; finalized and active cases are then paid in priority order when fully affordable.
                </p>
              </div>
            )}

            {!isInactive && (
              <div className="space-y-2">
                <Label htmlFor="status">Member Status</Label>
                <Select value={newStatus} onValueChange={(v) => setNewStatus(v as any)}>
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="probation">Probation</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="deceased">Deceased</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Inactive members can only be reactivated automatically through wallet top-ups.
                </p>
              </div>
            )}

            <div className="space-y-2 rounded-lg border p-3">
              <p className="font-medium">Status Transition Audit (Latest 10)</p>
              {historyLoading ? (
                <p className="text-xs text-muted-foreground">Loading transition history...</p>
              ) : historyRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No transition history yet.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {historyRows.map((row) => (
                    <div key={row.id} className="flex items-center justify-between text-xs rounded border px-2 py-1">
                      <span>
                        {row.from_status || '-'} → <strong>{row.to_status}</strong> ({row.reason})
                      </span>
                      <span className="text-muted-foreground">{new Date(row.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!showDeleteConfirm ? (
              <div className="pt-4 border-t">
                <Button
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={!canDelete}
                  className="w-full"
                >
                  {canDelete ? 'Delete Member' : 'Cannot Delete (Non-zero Balance)'}
                </Button>
                {!canDelete && (
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    Member must have zero wallet balance to be deleted
                  </p>
                )}
              </div>
            ) : (
              <div className="pt-4 border-t space-y-3">
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-900">Confirm Deletion</p>
                    <p className="text-xs text-red-700 mt-1">
                      This will permanently remove {member.name} from the system. This action cannot
                      be undone.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isProcessing}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDeleteMember}
                    disabled={isProcessing}
                    className="flex-1"
                  >
                    {isProcessing ? 'Deleting...' : 'Confirm Delete'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="sm:justify-start">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
              Cancel
            </Button>
            <Button onClick={handleStatusChange} disabled={isProcessing || isInactive}>
              {isProcessing ? 'Updating...' : 'Update Status'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
