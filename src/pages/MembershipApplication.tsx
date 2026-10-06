import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { invokePublicFunction } from '@/lib/appAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';

const villages = ['Kabiranduni', 'Chembe', 'Kibaoni', 'Ziani', 'Soyosoyo', 'Muthoroni', 'Yembe', 'Majengo', 'Ngamani', 'Kadzitosoni', 'Kisimani', 'Bahati', 'Muungano', 'Malanga'];

export default function MembershipApplication() {
  const [submitted, setSubmitted] = useState<{ reference: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resident, setResident] = useState('resident');
  const [dependants, setDependants] = useState([{ full_name: '', relationship: '', date_of_birth: '' }]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) || '').trim();
    try {
      const result = await invokePublicFunction<{ application: { application_reference: string } }>('api-membership-applications', {
        action: 'submit', full_name: value('full_name'), national_id_number: value('national_id_number'),
        date_of_birth: value('date_of_birth'), gender: value('gender'), phone_number: value('phone_number'),
        alternative_phone_number: value('alternative_phone_number'), email_address: value('email_address'),
        residence_status: resident, village: resident === 'resident' ? value('village') : null,
        current_location: resident === 'non_resident' ? value('current_location') : null,
        dependants: dependants.filter((item) => item.full_name).map((item) => ({ ...item })),
        next_of_kin: { name: value('next_of_kin_name'), relationship: value('next_of_kin_relationship'), phone_number: value('next_of_kin_phone') },
        declaration_accepted: form.get('declaration') === 'on',
      });
      setSubmitted({ reference: result.application.application_reference });
      toast({ title: 'Application submitted', description: 'A confirmation SMS has been sent to your phone.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Application failed', description: error instanceof Error ? error.message : 'Please try again.' });
    } finally { setSubmitting(false); }
  }

  if (submitted) return <main className="min-h-screen bg-slate-50 p-4 sm:p-8"><Card className="mx-auto mt-12 max-w-xl"><CardContent className="space-y-4 p-8 text-center"><CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" /><h1 className="text-2xl font-bold">Application received</h1><p>Your application reference is <strong>{submitted.reference}</strong>. Keep it for future communication. Your application is awaiting Welfare Committee review.</p><Link className="text-blue-700 underline" to="/">Return to home</Link></CardContent></Card></main>;

  return <main className="min-h-screen bg-slate-50 p-4 sm:p-8"><Card className="mx-auto max-w-4xl"><CardHeader><div className="mb-2 flex items-center justify-between gap-3"><CardTitle>Malanga Community Welfare Online Membership Application</CardTitle><Link to="/" className="shrink-0 text-sm text-blue-700 underline">Back Home</Link></div><p className="text-sm text-muted-foreground">Complete the form accurately. Applicants above 75 years are not eligible for admission.</p></CardHeader><CardContent><form onSubmit={submit} className="space-y-6">
    <section className="grid gap-4 sm:grid-cols-2"><h2 className="sm:col-span-2 text-lg font-semibold">Personal Information</h2><Field name="full_name" label="Full name as it appears on National ID" required /><Field name="national_id_number" label="National ID number" required /><Field name="date_of_birth" label="Date of birth" type="date" required /><div><Label>Gender *</Label><select name="gender" required className="mt-1 h-10 w-full rounded-md border bg-background px-3"><option value="">Select</option><option>Female</option><option>Male</option><option>Other</option></select></div><Field name="phone_number" label="Phone number (Safaricom)" required /><Field name="alternative_phone_number" label="Alternative phone number" /><Field name="email_address" label="Email address (optional)" type="email" /></section>
    <section className="grid gap-4 sm:grid-cols-2"><h2 className="sm:col-span-2 text-lg font-semibold">Residence Information</h2><div className="sm:col-span-2"><Label>Are you a resident of Malanga? *</Label><select value={resident} onChange={(e) => setResident(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3"><option value="resident">Yes</option><option value="non_resident">No</option></select></div>{resident === 'resident' ? <div className="sm:col-span-2"><Label>Malanga village *</Label><select name="village" required className="mt-1 h-10 w-full rounded-md border bg-background px-3"><option value="">Select village</option>{villages.map((v) => <option key={v} value={`Malanga - ${v}`}>Malanga - {v}</option>)}</select></div> : <Field name="current_location" label="Current residence/location" placeholder="Example: Malindi - Shella" required />}</section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Dependants</h2>{dependants.map((item, index) => <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-3" key={index}><Input aria-label="Dependant full name" placeholder="Full name" value={item.full_name} onChange={(e) => setDependants((all) => all.map((d, i) => i === index ? { ...d, full_name: e.target.value } : d))} /><Input aria-label="Dependant relationship" placeholder="Relationship" value={item.relationship} onChange={(e) => setDependants((all) => all.map((d, i) => i === index ? { ...d, relationship: e.target.value } : d))} /><Input aria-label="Dependant date of birth" type="date" value={item.date_of_birth} onChange={(e) => setDependants((all) => all.map((d, i) => i === index ? { ...d, date_of_birth: e.target.value } : d))} /></div>)}<Button type="button" variant="outline" onClick={() => setDependants((all) => [...all, { full_name: '', relationship: '', date_of_birth: '' }])}>Add dependant</Button></section>
    <section className="grid gap-4 sm:grid-cols-3"><h2 className="sm:col-span-3 text-lg font-semibold">Next of Kin</h2><Field name="next_of_kin_name" label="Full name" required /><Field name="next_of_kin_relationship" label="Relationship" required /><Field name="next_of_kin_phone" label="Phone number" required /></section>
    <label className="flex items-start gap-2 text-sm"><input name="declaration" type="checkbox" required className="mt-1" />I declare that the information provided is true and accurate to the best of my knowledge.</label><Button disabled={submitting} type="submit" className="w-full sm:w-auto">{submitting ? 'Submitting…' : 'Submit application'}</Button>
  </form></CardContent></Card></main>;
}

function Field({ name, label, type = 'text', required = false, placeholder }: { name: string; label: string; type?: string; required?: boolean; placeholder?: string }) { return <div><Label htmlFor={name}>{label}{required ? ' *' : ''}</Label><Input id={name} name={name} type={type} required={required} placeholder={placeholder} className="mt-1" /></div>; }
