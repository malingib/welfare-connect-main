import { useEffect, useState } from 'react';
import DashboardLayout from '@/layouts/DashboardLayout';
import { invokeWithAppToken } from '@/lib/appAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';

type Application = {
  id: string; application_reference: string; full_name: string; national_id_number: string; date_of_birth: string; gender?: string;
  phone_number: string; email_address?: string; residence_status: string; village?: string; current_location?: string;
  dependants?: Array<Record<string, unknown>>; next_of_kin?: Record<string, unknown>; status: string; payment_status?: string;
  payment_code?: string; payment_expires_at?: string; payment_receipt?: string; payment_amount?: number; application_date: string;
  reviewed_at?: string; review_reason?: string; activated_at?: string;
};

const formatDate = (value?: string) => value ? new Date(value).toLocaleString() : '—';
const display = (value: unknown) => value == null || value === '' ? '—' : String(value);

export default function Applications() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [selected, setSelected] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const result = await invokeWithAppToken<{ applications: Application[] }>('api-membership-applications', { action: 'list' });
      setApplications(result.applications || []);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Failed to load applications', description: error instanceof Error ? error.message : 'Please try again.' });
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const review = async (application: Application, decision: 'approve' | 'reject') => {
    const reason = decision === 'reject' ? window.prompt('Reason for rejection (optional):') || '' : '';
    try {
      await invokeWithAppToken('api-membership-applications', { action: 'review', application_id: application.id, decision, reason });
      toast({ title: decision === 'approve' ? 'Application approved' : 'Application rejected' });
      await load();
    } catch (error) { toast({ variant: 'destructive', title: 'Review failed', description: error instanceof Error ? error.message : 'Please try again.' }); }
  };

  const confirmPayment = async (application: Application) => {
    if (!window.confirm('Confirm the verified payment and activate this member?')) return;
    try {
      const result = await invokeWithAppToken<{ member_number: string; probation_end_date: string }>('api-membership-applications', { action: 'confirm_payment', application_id: application.id });
      toast({ title: 'Membership activated', description: `${result.member_number}; probation ends ${result.probation_end_date}` });
      setSelected(null); await load();
    } catch (error) { toast({ variant: 'destructive', title: 'Activation failed', description: error instanceof Error ? error.message : 'Please try again.' }); }
  };

  return <DashboardLayout><div className="space-y-6"><div><h1 className="text-3xl font-bold">Membership Applications</h1><p className="text-muted-foreground">Review applications, verify payment, and activate members.</p></div><Card><CardHeader><CardTitle>{loading ? 'Loading…' : `${applications.length} applications`}</CardTitle></CardHeader><CardContent className="space-y-3">
    {applications.map((application) => <div className="rounded-lg border p-4" key={application.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{application.full_name}</p><p className="text-sm text-muted-foreground">{application.application_reference} · {application.phone_number}</p><p className="text-sm">{application.residence_status === 'resident' ? application.village : application.current_location}</p></div><Badge variant={['rejected', 'expired'].includes(application.status) ? 'destructive' : 'secondary'}>{application.status.replaceAll('_', ' ')}</Badge></div><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setSelected(application)}>View details</Button>{application.status === 'pending_review' && <><Button size="sm" onClick={() => void review(application, 'approve')}>Approve and request payment</Button><Button size="sm" variant="outline" onClick={() => void review(application, 'reject')}>Reject</Button></>}{application.status === 'payment_pending' && <Button size="sm" onClick={() => void confirmPayment(application)} disabled={!application.payment_receipt}>{application.payment_receipt ? 'Confirm payment and activate' : 'Awaiting payment verification'}</Button>}</div>{application.payment_code && <p className="mt-3 text-sm font-medium">Payment code: {application.payment_code}</p>}</div>)}
    {!loading && applications.length === 0 && <p className="text-sm text-muted-foreground">No applications received.</p>}</CardContent></Card></div>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">{selected && <><DialogHeader><DialogTitle>{selected.full_name} · Application details</DialogTitle></DialogHeader><div className="grid gap-5 text-sm sm:grid-cols-2"><section><h3 className="mb-2 font-semibold">Applicant</h3><dl className="space-y-1"><div><dt className="text-muted-foreground">Application</dt><dd>{selected.application_reference}</dd></div><div><dt className="text-muted-foreground">National ID</dt><dd>{selected.national_id_number}</dd></div><div><dt className="text-muted-foreground">Date of birth</dt><dd>{display(selected.date_of_birth)}</dd></div><div><dt className="text-muted-foreground">Gender</dt><dd>{display(selected.gender)}</dd></div><div><dt className="text-muted-foreground">Phone</dt><dd>{selected.phone_number}</dd></div><div><dt className="text-muted-foreground">Email</dt><dd>{display(selected.email_address)}</dd></div></dl></section><section><h3 className="mb-2 font-semibold">Residence and next of kin</h3><dl className="space-y-1"><div><dt className="text-muted-foreground">Residence</dt><dd>{display(selected.residence_status === 'resident' ? selected.village : selected.current_location)}</dd></div><div><dt className="text-muted-foreground">Next of kin</dt><dd>{display(selected.next_of_kin?.name)}</dd></div><div><dt className="text-muted-foreground">Relationship</dt><dd>{display(selected.next_of_kin?.relationship)}</dd></div><div><dt className="text-muted-foreground">Kin phone</dt><dd>{display(selected.next_of_kin?.phoneNumber || selected.next_of_kin?.phone_number)}</dd></div><div><dt className="text-muted-foreground">Dependants</dt><dd>{selected.dependants?.length || 0}</dd></div></dl></section><section><h3 className="mb-2 font-semibold">Application status</h3><dl className="space-y-1"><div><dt className="text-muted-foreground">Submitted</dt><dd>{formatDate(selected.application_date)}</dd></div><div><dt className="text-muted-foreground">Status</dt><dd>{selected.status.replaceAll('_', ' ')}</dd></div><div><dt className="text-muted-foreground">Reviewed</dt><dd>{formatDate(selected.reviewed_at)}</dd></div><div><dt className="text-muted-foreground">Reason</dt><dd>{display(selected.review_reason)}</dd></div></dl></section><section><h3 className="mb-2 font-semibold">Payment and activation</h3><dl className="space-y-1"><div><dt className="text-muted-foreground">Payment code</dt><dd>{display(selected.payment_code)}</dd></div><div><dt className="text-muted-foreground">Payment status</dt><dd>{display(selected.payment_status)}</dd></div><div><dt className="text-muted-foreground">Payment deadline</dt><dd>{formatDate(selected.payment_expires_at)}</dd></div><div><dt className="text-muted-foreground">Receipt</dt><dd>{display(selected.payment_receipt)}</dd></div><div><dt className="text-muted-foreground">Amount</dt><dd>{selected.payment_amount ? `KES ${selected.payment_amount}` : '—'}</dd></div><div><dt className="text-muted-foreground">Activated</dt><dd>{formatDate(selected.activated_at)}</dd></div></dl></section></div>{selected.status === 'payment_pending' && <Button className="w-full" onClick={() => void confirmPayment(selected)} disabled={!selected.payment_receipt}>Confirm verified payment and activate</Button>}</>}</DialogContent></Dialog>
  </DashboardLayout>;
}
