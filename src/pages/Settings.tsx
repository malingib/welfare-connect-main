import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Save, Edit, X, MessageSquare, PenLine, ChevronDown, ChevronRight } from 'lucide-react';
import DashboardLayout from '@/layouts/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import ResidenceForm from '@/components/forms/ResidenceForm';
import { SmsMessageComposer } from '@/components/messages/SmsMessageComposer';
import type { SmsRecipient, SmsSendSummary, SmsTriggerKey } from '@/lib/smsMessaging';
import { summarizeSkippedReasons } from '@/lib/smsMessaging';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { invokeWithAppToken } from '@/lib/appAuth';
import { fetchSafeSettings } from '@/lib/settingsClient';
import { listAdminUsers, type AdminUserRow } from '@/lib/adminUsersApi';

interface Residence {
  id: string;
  name: string;
  created_at: string;
}

interface SettingsData {
  id: string;
  registration_fee: number;
  renewal_fee: number;
  penalty_amount: number;
  paybill_number: string | null;
  organization_name: string;
  organization_email: string | null;
  organization_phone: string | null;
  whatsapp_group_link: string | null;
  member_id_start: number | null;
  case_id_start: number | null;
  mpesa_consumer_key: string | null;
  mpesa_consumer_secret: string | null;
  mpesa_passkey: string | null;
  mpesa_shortcode: string | null;
  mpesa_initiator_name: string | null;
  mpesa_initiator_password: string | null;
  mpesa_env: 'sandbox' | 'production';
  has_mpesa_consumer_key?: boolean;
  has_mpesa_consumer_secret?: boolean;
  has_mpesa_passkey?: boolean;
  has_mpesa_initiator_password?: boolean;
}

type SmsSummary = {
  sent: number;
  delivered: number;
  failed: number;
  balance: number | null;
  recent: Array<{
    action: string;
    status: string | null;
    timestamp: string;
    metadata?: Record<string, unknown> | null;
  }>;
  total: number;
  page: number;
  page_size: number;
};

type MembersListResponse = {
  members: Array<{
    id: string;
    member_number: string | null;
    name: string | null;
    phone_number: string | null;
    status: string | null;
  }>;
  has_more?: boolean;
};

type SmsAlertSetting = {
  trigger_key: string;
  admin_user_ids: string[];
  is_active: boolean;
  updated_at?: string;
};

const smsAlertEvents = [
  { key: 'registration_submitted', label: 'Registration submitted', description: 'A new membership application has been submitted.' },
  { key: 'registration_pending_review', label: 'Registration pending review', description: 'An application is waiting for Committee review.' },
  { key: 'registration_approved', label: 'Registration approved', description: 'An applicant has been approved and should pay the registration fee.' },
  { key: 'registration_payment_pending', label: 'Registration payment pending', description: 'An approved applicant has not completed payment.' },
  { key: 'registration_payment_received', label: 'Registration payment received', description: 'Payment was received and is awaiting administrator verification.' },
  { key: 'registration_activated', label: 'Membership activated', description: 'Verified payment created the member account.' },
  { key: 'registration_expired', label: 'Application expired', description: 'An unpaid or rejected application expired after one week.' },
  { key: 'whatsapp_group_invite', label: 'WhatsApp group invitation', description: 'Send the group link separately after activation.' },
  { key: 'registration_rejected', label: 'Registration rejected', description: 'An application has been rejected.' },
  { key: 'payment_received', label: 'Payment received', description: 'A member payment has been received.' },
  { key: 'payment_failed', label: 'Payment failed or needs attention', description: 'A payment failed or could not be confirmed.' },
  { key: 'case_opened', label: 'Case opened', description: 'A welfare case has been opened.' },
  { key: 'case_closed', label: 'Case closed', description: 'A welfare case has been closed.' },
  { key: 'status_changed', label: 'Member status changed', description: 'A member status changed manually.' },
  { key: 'auto_inactive', label: 'Suspension / inactive status', description: 'A member was suspended or became inactive.' },
  { key: 'penalty_posted', label: 'Penalty posted', description: 'A penalty was posted to a member account.' },
  { key: 'probation_ending', label: 'Probation ending', description: 'A member probation period is nearing its end.' },
  { key: 'probation_completed', label: 'Probation completed', description: 'A member became a full member.' },
  { key: 'closed_case_overdue', label: 'Closed case overdue', description: 'A closed-case balance remains unpaid.' },
] as const;

const settingsFormSchema = z.object({
  registration_fee: z.coerce.number().min(0, 'Fee must be a positive number'),
  renewal_fee: z.coerce.number().min(0, 'Fee must be a positive number'),
  penalty_amount: z.coerce.number().min(0, 'Fee must be a positive number'),
  paybill_number: z.string().optional(),
  organization_name: z.string().min(1, 'Organization name is required'),
  organization_email: z.string().email().optional().or(z.literal('')),
  organization_phone: z.string().optional().or(z.literal('')),
  whatsapp_group_link: z.string().url('Enter a valid WhatsApp group URL').optional().or(z.literal('')),
  member_id_start: z.coerce.number().min(1, 'Member ID start must be a positive number').optional(),
  case_id_start: z.coerce.number().min(1, 'Case ID start must be a positive number').optional(),
  mpesa_consumer_key: z.string().optional().or(z.literal('')),
  mpesa_consumer_secret: z.string().optional().or(z.literal('')),
  mpesa_passkey: z.string().optional().or(z.literal('')),
  mpesa_shortcode: z.string().optional().or(z.literal('')),
  mpesa_initiator_name: z.string().optional().or(z.literal('')),
  mpesa_initiator_password: z.string().optional().or(z.literal('')),
  mpesa_env: z.enum(['sandbox', 'production']).default('sandbox'),
});

const Settings = () => {
  const [residences, setResidences] = useState<Residence[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [smsSummary, setSmsSummary] = useState<SmsSummary | null>(null);
  const [smsRecipients, setSmsRecipients] = useState<SmsRecipient[]>([]);
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [smsTemplates, setSmsTemplates] = useState<Array<{ trigger_key: string; label: string; description: string; category: string; raw_template: string; is_active: boolean }>>([]);
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [editingRawTemplate, setEditingRawTemplate] = useState('');
  const [smsTemplatesSaving, setSmsTemplatesSaving] = useState(false);
  const [smsAlertSettings, setSmsAlertSettings] = useState<SmsAlertSetting[]>([]);
  const [smsAlertAdmins, setSmsAlertAdmins] = useState<AdminUserRow[]>([]);
  const [smsAlertLoading, setSmsAlertLoading] = useState(false);
  const [smsAlertSaving, setSmsAlertSaving] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [smsPage, setSmsPage] = useState(1);
  const [smsPageSize] = useState(20);
  const [onlyDebtors, setOnlyDebtors] = useState(false);
  const [debtorIds, setDebtorIds] = useState<Set<string> | null>(null);
  const [debtFilterLoading, setDebtFilterLoading] = useState(false);
  const [settingsMeta, setSettingsMeta] = useState<Pick<
    SettingsData,
    'has_mpesa_consumer_key' | 'has_mpesa_consumer_secret' | 'has_mpesa_passkey' | 'has_mpesa_initiator_password'
  >>({});

  const form = useForm<z.infer<typeof settingsFormSchema>>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      registration_fee: 500,
      renewal_fee: 200,
      penalty_amount: 300,
      paybill_number: '',
      organization_name: 'Welfare Society',
      organization_email: '',
      organization_phone: '',
      whatsapp_group_link: '',
      member_id_start: 1,
      case_id_start: 1,
      mpesa_consumer_key: '',
      mpesa_consumer_secret: '',
      mpesa_passkey: '',
      mpesa_shortcode: '',
      mpesa_initiator_name: '',
      mpesa_initiator_password: '',
      mpesa_env: 'sandbox',
    },
  });

  useEffect(() => {
    const fetchResidences = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('residences')
          .select('id, name, created_at')
          .order('name', { ascending: true });
          
        if (error) throw error;
        
        setResidences(data || []);
      } catch (error) {
        console.error('Error fetching residences:', error);
        toast({
          variant: "destructive",
          title: "Failed to load residences",
          description: "There was an error loading the residence data.",
        });
      } finally {
        setLoading(false);
      }
    };

    const fetchSettings = async () => {
      try {
        const settings = await fetchSafeSettings();
        if (settings) {
          setSettingsMeta({
            has_mpesa_consumer_key: false,
            has_mpesa_consumer_secret: false,
            has_mpesa_passkey: false,
            has_mpesa_initiator_password: false,
          });
          form.reset({
            registration_fee: settings.registration_fee,
            renewal_fee: settings.renewal_fee,
            penalty_amount: settings.penalty_amount,
            paybill_number: settings.paybill_number || '',
            organization_name: settings.organization_name,
            organization_email: settings.organization_email || '',
            organization_phone: settings.organization_phone || '',
            whatsapp_group_link: settings.whatsapp_group_link || '',
            member_id_start: settings.member_id_start || 1,
            case_id_start: settings.case_id_start || 1,
            mpesa_consumer_key: '',
            mpesa_consumer_secret: '',
            mpesa_passkey: '',
            mpesa_shortcode: settings.mpesa_shortcode || '',
            mpesa_initiator_name: settings.mpesa_initiator_name || '',
            mpesa_initiator_password: '',
            mpesa_env: (settings.mpesa_env as 'sandbox' | 'production') || 'sandbox',
          });
        }
      } catch (error) {
        console.error('Error fetching settings snapshot:', error);
      }
    };

    fetchResidences();
    fetchSettings();
  }, [refreshTrigger, form]);

  useEffect(() => {
    void fetchSmsData(1);
    void fetchSmsAlertSettings();
    const id = window.setInterval(() => fetchSmsData(), 30000);
    return () => window.clearInterval(id);
  }, []);

  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleResidenceAdded = () => {
    handleRefresh();
  };

  const fetchSmsData = async (page?: number) => {
    const currentPage = page ?? smsPage;
    setSmsLoading(true);
    try {
      // Load summary + templates first (fast, single requests)
      const [summary, templatesResult] = await Promise.all([
        invokeWithAppToken<SmsSummary>('api-sms-summary', { page: currentPage, page_size: smsPageSize }),
        invokeWithAppToken<{ templates: any[] }>('api-sms-templates', {}).catch(() => ({ templates: [] })),
      ]);

      // Fetch ALL active members with phones — sequential pages with timeout+retry
      // to avoid the burst of 3 parallel requests that fails on slow devices.
      const allMembers: MembersListResponse['members'] = [];
      let offset = 0;
      const maxPages = 20;
      for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
        let batch: MembersListResponse['members'] = [];
        let hasMore = false;
        // Retry each page up to 2 times with exponential backoff
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const membersResult = await invokeWithAppToken<MembersListResponse>('api-members-list', {
              status: 'active',
              limit: 300,
              offset,
            });
            clearTimeout(timeoutId);
            batch = membersResult.members || [];
            hasMore = membersResult.has_more ?? false;
            break; // success
          } catch (e: any) {
            if (attempt === 2) throw e; // last attempt, rethrow
            const delay = 500 * Math.pow(2, attempt);
            await new Promise(r => setTimeout(r, delay));
          }
        }
        allMembers.push(...batch);
        if (!hasMore || batch.length < 300 || allMembers.length >= 5000) break;
        offset += 300;
      }

      setSmsSummary(summary);
      setSmsRecipients(allMembers
        .filter((member) => String(member.phone_number || '').trim().length > 0)
        .map((member) => ({
          id: member.id,
          memberId: member.id,
          name: member.name || undefined,
          memberNumber: member.member_number || undefined,
          phoneNumber: String(member.phone_number || '').trim(),
          status: member.status || undefined,
        })));
      // A refresh can change the audience, so drop a stale debtor pre-filter.
      setDebtorIds(null);
      setOnlyDebtors(false);
      if (templatesResult?.templates) {
        setSmsTemplates(templatesResult.templates);
      }
    } catch (error: any) {
      console.error('Error loading SMS data:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to load SMS data',
        description: error.message || 'SMS balance and recipients could not be loaded.',
      });
    } finally {
      setSmsLoading(false);
    }
  };

  const fetchSmsAlertSettings = async () => {
    setSmsAlertLoading(true);
    try {
      const [settingsResult, admins] = await Promise.all([
        invokeWithAppToken<{ settings: SmsAlertSetting[] }>('api-sms-alert-settings', { action: 'list' }),
        listAdminUsers(),
      ]);
      setSmsAlertSettings(settingsResult.settings || []);
      setSmsAlertAdmins((admins || []).filter((admin) => admin.is_active && admin.role !== 'member'));
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to load SMS alert settings', description: error.message });
    } finally {
      setSmsAlertLoading(false);
    }
  };

  const saveSmsAlertRecipients = async (triggerKey: string, adminUserIds: string[]) => {
    setSmsAlertSaving(triggerKey);
    try {
      const result = await invokeWithAppToken<{ setting: SmsAlertSetting }>('api-sms-alert-settings', {
        action: 'update', trigger_key: triggerKey, admin_user_ids: adminUserIds,
      });
      setSmsAlertSettings((current) => [
        ...current.filter((item) => item.trigger_key !== triggerKey),
        result.setting,
      ].sort((a, b) => a.trigger_key.localeCompare(b.trigger_key)));
      toast({ title: 'Alert recipients saved' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to save alert recipients', description: error.message });
    } finally {
      setSmsAlertSaving(null);
    }
  };

  const getAlertRecipients = (triggerKey: string) =>
    smsAlertSettings.find((setting) => setting.trigger_key === triggerKey)?.admin_user_ids || [];

  const handleSaveTemplate = async (triggerKey: string) => {
    setSmsTemplatesSaving(true);
    try {
      await invokeWithAppToken('api-sms-templates', {
        action: 'update',
        trigger_key: triggerKey,
        raw_template: editingRawTemplate,
      });
      setEditingTemplate(null);
      await fetchSmsData();
      toast({ title: 'Template saved' });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Failed to save template',
        description: error.message,
      });
    } finally {
      setSmsTemplatesSaving(false);
    }
  };

  const smsTemplateOverrides = useMemo(() => {
    const map: Partial<Record<SmsTriggerKey, string>> = {};
    for (const tmpl of smsTemplates) {
      const text = String(tmpl?.raw_template || '').trim();
      if (tmpl?.trigger_key && text) map[tmpl.trigger_key as SmsTriggerKey] = text;
    }
    return map;
  }, [smsTemplates]);

  const smsComposerRecipients = useMemo(() => {
    if (!onlyDebtors || !debtorIds) return smsRecipients;
    return smsRecipients.filter((recipient) => recipient.id && debtorIds.has(recipient.id));
  }, [smsRecipients, onlyDebtors, debtorIds]);

  const handleToggleDebtFilter = async (enabled: boolean) => {
    setOnlyDebtors(enabled);
    if (!enabled || debtorIds) return;
    setDebtFilterLoading(true);
    try {
      const ids = smsRecipients.map((recipient) => recipient.id).filter(Boolean) as string[];
      const debtors = new Set<string>();
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        let data: any = null;
        let error: any = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const result = await supabase.rpc('get_members_bulk_unpaid_totals', { p_member_ids: chunk });
            data = result.data;
            error = result.error;
            if (!error) break;
          } catch (e) {
            error = e;
          }
          if (attempt === 2) throw error;
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
        }
        if (error) throw error;
        for (const row of ((data as Array<{ member_id: string; unpaid_case_count: number }> | null) || [])) {
          if (Number(row.unpaid_case_count || 0) > 0) debtors.add(row.member_id);
        }
      }
      setDebtorIds(debtors);
      if (debtors.size === 0) {
        toast({
          title: 'No debtors found',
          description: 'None of the active members currently have unpaid case balances.',
        });
      }
    } catch (error: any) {
      console.error('Error computing debtor list:', error);
      setOnlyDebtors(false);
      toast({
        variant: 'destructive',
        title: 'Could not filter debtors',
        description: error.message || 'The unpaid-balance lookup failed.',
      });
    } finally {
      setDebtFilterLoading(false);
    }
  };

  const handleSendSms = async (payload: { triggerKey: string; message: string; recipients: SmsRecipient[] }) => {
    setSmsSending(true);
    try {
      const result = await invokeWithAppToken<SmsSendSummary>('send-sms', {
        recipients: payload.recipients,
        message: payload.message,
        triggerKey: payload.triggerKey,
        source: 'settings_sms_tab',
      });

      const skippedNote = result.skipped
        ? ` ${result.skipped.toLocaleString()} skipped${summarizeSkippedReasons(result) ? ` (${summarizeSkippedReasons(result)})` : ''}.`
        : '';
      toast({
        title: result.failed ? 'SMS partially sent' : 'SMS sent',
        description: `${result.sent.toLocaleString()} of ${result.recipients.toLocaleString()} recipient(s) accepted.${result.failed ? ` ${result.failed.toLocaleString()} failed.` : ''}${skippedNote}`,
        variant: result.failed ? 'destructive' : 'default',
      });
      await fetchSmsData();
      return result;
    } catch (error: any) {
      console.error('Error sending SMS:', error);
      toast({
        variant: 'destructive',
        title: 'SMS failed',
        description: error.message || 'The SMS provider rejected the message.',
      });
    } finally {
      setSmsSending(false);
    }
  };

  const onSubmitSettings = async (values: z.infer<typeof settingsFormSchema>) => {
    setSavingSettings(true);
    try {
      const result = await invokeWithAppToken<{ success: boolean; settings: SettingsData | null }>('api-settings', {
        action: 'update',
        settings: values,
      });

      if (result?.settings) {
        setSettingsMeta({
          has_mpesa_consumer_key: result.settings.has_mpesa_consumer_key,
          has_mpesa_consumer_secret: result.settings.has_mpesa_consumer_secret,
          has_mpesa_passkey: result.settings.has_mpesa_passkey,
          has_mpesa_initiator_password: result.settings.has_mpesa_initiator_password,
        });
      }
        
      toast({
        title: "Settings updated",
        description: "Your changes have been saved successfully.",
      });
      
      setEditingField(null);
    } catch (error: any) {
      console.error('Error updating settings:', error);
      toast({
        variant: "destructive",
        title: "Failed to update settings",
        description: error.message || "There was an error saving your changes.",
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleEdit = (fieldName: string) => {
    setEditingField(editingField === fieldName ? null : fieldName);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-1">Settings</h1>
          <p className="text-muted-foreground">Manage system settings and configurations</p>
        </div>

        <Tabs defaultValue="fees">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-3 lg:grid-cols-6">
            <TabsTrigger value="fees" className="min-h-10 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm">Fees & Payments</TabsTrigger>
            <TabsTrigger value="ids" className="min-h-10 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm">ID Configuration</TabsTrigger>
            <TabsTrigger value="residences" className="min-h-10 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm">Residence Locations</TabsTrigger>
            <TabsTrigger value="organization" className="min-h-10 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm">Organization</TabsTrigger>
            <TabsTrigger value="mpesa" className="min-h-10 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm">M-Pesa API</TabsTrigger>
            <TabsTrigger value="sms" className="min-h-10 whitespace-normal px-2 py-2 text-xs leading-tight sm:text-sm">SMS</TabsTrigger>
          </TabsList>
          
          <TabsContent value="fees" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Fee Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmitSettings)} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="registration_fee"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Registration Fee (KES)</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input 
                                  type="number" 
                                  {...field} 
                                  readOnly={editingField !== 'registration_fee'}
                                  className={editingField !== 'registration_fee' ? "bg-muted cursor-not-allowed" : ""}
                                />
                              </FormControl>
                              {editingField === 'registration_fee' ? (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => toggleEdit('registration_fee')}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              ) : (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => toggleEdit('registration_fee')}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            <FormMessage />
                            {settingsMeta.has_mpesa_consumer_key && (
                              <p className="text-xs text-muted-foreground">A key is already configured. Leave blank to keep it unchanged.</p>
                            )}
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="renewal_fee"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Annual Renewal Fee (KES)</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input 
                                  type="number" 
                                  {...field} 
                                  readOnly={editingField !== 'renewal_fee'}
                                  className={editingField !== 'renewal_fee' ? "bg-muted cursor-not-allowed" : ""}
                                />
                              </FormControl>
                              {editingField === 'renewal_fee' ? (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => toggleEdit('renewal_fee')}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              ) : (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => toggleEdit('renewal_fee')}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            <FormMessage />
                            {settingsMeta.has_mpesa_consumer_secret && (
                              <p className="text-xs text-muted-foreground">A secret is already configured. Leave blank to keep it unchanged.</p>
                            )}
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="penalty_amount"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Penalty Amount (KES)</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input 
                                  type="number" 
                                  {...field} 
                                  readOnly={editingField !== 'penalty_amount'}
                                  className={editingField !== 'penalty_amount' ? "bg-muted cursor-not-allowed" : ""}
                                />
                              </FormControl>
                              {editingField === 'penalty_amount' ? (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => toggleEdit('penalty_amount')}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              ) : (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => toggleEdit('penalty_amount')}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            <FormMessage />
                            {settingsMeta.has_mpesa_passkey && (
                              <p className="text-xs text-muted-foreground">A passkey is already configured. Leave blank to keep it unchanged.</p>
                            )}
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="paybill_number"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>M-Pesa Paybill Number</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input 
                                  {...field} 
                                  readOnly={editingField !== 'paybill_number'}
                                  className={editingField !== 'paybill_number' ? "bg-muted cursor-not-allowed" : ""}
                                />
                              </FormControl>
                              {editingField === 'paybill_number' ? (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => toggleEdit('paybill_number')}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              ) : (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => toggleEdit('paybill_number')}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <div className="flex justify-end">
                      <Button type="submit" disabled={savingSettings || editingField === null}>
                        <Save className="w-4 h-4 mr-2" />
                        {savingSettings ? 'Saving...' : 'Save Changes'}
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="ids" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>ID Number Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmitSettings)} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="member_id_start"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Member ID Starting Number</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input 
                                  type="number" 
                                  {...field} 
                                  readOnly={editingField !== 'member_id_start'}
                                  className={editingField !== 'member_id_start' ? "bg-muted cursor-not-allowed" : ""}
                                />
                              </FormControl>
                              {editingField === 'member_id_start' ? (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => toggleEdit('member_id_start')}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              ) : (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => toggleEdit('member_id_start')}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              New member IDs will start from M{String(field.value || 1).padStart(3, '0')}
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="case_id_start"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Case ID Starting Number</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input 
                                  type="number" 
                                  {...field} 
                                  readOnly={editingField !== 'case_id_start'}
                                  className={editingField !== 'case_id_start' ? "bg-muted cursor-not-allowed" : ""}
                                />
                              </FormControl>
                              {editingField === 'case_id_start' ? (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => toggleEdit('case_id_start')}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              ) : (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => toggleEdit('case_id_start')}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              New case IDs will start from C{String(field.value || 1).padStart(3, '0')}
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <div className="flex justify-end">
                      <Button type="submit" disabled={savingSettings || editingField === null}>
                        <Save className="w-4 h-4 mr-2" />
                        {savingSettings ? 'Saving...' : 'Save Changes'}
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="residences" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Manage Residence Locations</h2>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleRefresh} disabled={loading}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Sheet>
                  <SheetTrigger asChild>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Add New Location
                    </Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Add New Residence Location</SheetTitle>
                    </SheetHeader>
                    <div className="py-6">
                      <ResidenceForm onSuccess={handleResidenceAdded} />
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Available Locations</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-4">Loading residences...</div>
                ) : residences.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-muted-foreground">No residence locations found</p>
                    <Sheet>
                      <SheetTrigger asChild>
                        <Button variant="outline" className="mt-4">
                          <Plus className="h-4 w-4 mr-2" />
                          Add New Location
                        </Button>
                      </SheetTrigger>
                      <SheetContent>
                        <SheetHeader>
                          <SheetTitle>Add New Residence Location</SheetTitle>
                        </SheetHeader>
                        <div className="py-6">
                          <ResidenceForm onSuccess={handleResidenceAdded} />
                        </div>
                      </SheetContent>
                    </Sheet>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {residences.map((residence) => (
                      <div 
                        key={residence.id} 
                        className="border rounded-md p-4 hover:bg-accent transition-colors"
                      >
                        <p className="font-medium">{residence.name}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="organization">
            <Card>
              <CardHeader>
                <CardTitle>Organization Information</CardTitle>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmitSettings)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="organization_name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Organization Name</FormLabel>
                          <div className="flex items-center gap-2">
                            <FormControl>
                              <Input 
                                {...field} 
                                readOnly={editingField !== 'organization_name'}
                                className={editingField !== 'organization_name' ? "bg-muted cursor-not-allowed" : ""}
                              />
                            </FormControl>
                            {editingField === 'organization_name' ? (
                              <Button 
                                type="button" 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => toggleEdit('organization_name')}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button 
                                type="button" 
                                variant="ghost" 
                                size="icon"
                                onClick={() => toggleEdit('organization_name')}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="organization_email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Organization Email</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input 
                                  type="email" 
                                  {...field} 
                                  readOnly={editingField !== 'organization_email'}
                                  className={editingField !== 'organization_email' ? "bg-muted cursor-not-allowed" : ""}
                                />
                              </FormControl>
                              {editingField === 'organization_email' ? (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => toggleEdit('organization_email')}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              ) : (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => toggleEdit('organization_email')}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="organization_phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Organization Phone</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input 
                                  {...field} 
                                  readOnly={editingField !== 'organization_phone'}
                                  className={editingField !== 'organization_phone' ? "bg-muted cursor-not-allowed" : ""}
                                />
                              </FormControl>
                              {editingField === 'organization_phone' ? (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => toggleEdit('organization_phone')}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              ) : (
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => toggleEdit('organization_phone')}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="whatsapp_group_link"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Members WhatsApp Group Link</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input
                                  type="url"
                                  placeholder="https://chat.whatsapp.com/..."
                                  {...field}
                                  readOnly={editingField !== 'whatsapp_group_link'}
                                  className={editingField !== 'whatsapp_group_link' ? "bg-muted cursor-not-allowed" : ""}
                                />
                              </FormControl>
                              {editingField === 'whatsapp_group_link' ? (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('whatsapp_group_link')}><X className="h-4 w-4" /></Button>
                              ) : (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('whatsapp_group_link')}><Edit className="h-4 w-4" /></Button>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <div className="flex justify-end">
                      <Button type="submit" disabled={savingSettings || editingField === null}>
                        <Save className="w-4 h-4 mr-2" />
                        {savingSettings ? 'Saving...' : 'Save Changes'}
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="mpesa">
            <Card>
              <CardHeader>
                <CardTitle>M-Pesa Daraja API Settings</CardTitle>
                <CardDescription>
                  Configure M-Pesa integration for STK Push, B2C payments, and reversals
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Info Banner */}
                <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h4 className="text-sm font-semibold text-blue-900 mb-2">📋 How to Get M-Pesa Credentials</h4>
                  <ol className="text-xs text-blue-800 space-y-1 list-decimal list-inside">
                    <li>Go to <a href="https://developer.safaricom.co.ke" target="_blank" rel="noopener noreferrer" className="underline font-medium">M-Pesa Daraja Developer Portal</a></li>
                    <li>Create an account or login to your existing account</li>
                    <li>Create a new app to get your Consumer Key and Consumer Secret</li>
                    <li>For STK Push: Get your Passkey from the app settings</li>
                    <li>For B2C/Reversals: Create an initiator on the Daraja portal</li>
                    <li>Download the public key and encrypt your initiator password</li>
                  </ol>
                  <p className="text-xs text-blue-700 mt-3 font-medium">
                    ℹ️ Start with Sandbox credentials for testing, then switch to Production when ready
                  </p>
                </div>

                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmitSettings)} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="mpesa_env"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Environment</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <select
                                  {...field}
                                  disabled={editingField !== 'mpesa_env'}
                                  className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${editingField !== 'mpesa_env' ? "bg-muted cursor-not-allowed" : ""}`}
                                >
                                  <option value="sandbox">🧪 Sandbox (Testing)</option>
                                  <option value="production">🚀 Production (Live)</option>
                                </select>
                              </FormControl>
                              {editingField === 'mpesa_env' ? (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('mpesa_env')}><X className="h-4 w-4" /></Button>
                              ) : (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('mpesa_env')}><Edit className="h-4 w-4" /></Button>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="mpesa_shortcode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Shortcode / Paybill Number</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input {...field} readOnly={editingField !== 'mpesa_shortcode'} className={editingField !== 'mpesa_shortcode' ? "bg-muted cursor-not-allowed" : ""} placeholder="e.g., 174379" />
                              </FormControl>
                              {editingField === 'mpesa_shortcode' ? (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('mpesa_shortcode')}><X className="h-4 w-4" /></Button>
                              ) : (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('mpesa_shortcode')}><Edit className="h-4 w-4" /></Button>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="mpesa_consumer_key"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Consumer Key</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input {...field} type="password" readOnly={editingField !== 'mpesa_consumer_key'} className={editingField !== 'mpesa_consumer_key' ? "bg-muted cursor-not-allowed" : ""} placeholder="Enter your Consumer Key" />
                              </FormControl>
                              {editingField === 'mpesa_consumer_key' ? (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('mpesa_consumer_key')}><X className="h-4 w-4" /></Button>
                              ) : (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('mpesa_consumer_key')}><Edit className="h-4 w-4" /></Button>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="mpesa_consumer_secret"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Consumer Secret</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input {...field} type="password" readOnly={editingField !== 'mpesa_consumer_secret'} className={editingField !== 'mpesa_consumer_secret' ? "bg-muted cursor-not-allowed" : ""} placeholder="Enter your Consumer Secret" />
                              </FormControl>
                              {editingField === 'mpesa_consumer_secret' ? (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('mpesa_consumer_secret')}><X className="h-4 w-4" /></Button>
                              ) : (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('mpesa_consumer_secret')}><Edit className="h-4 w-4" /></Button>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="mpesa_passkey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Passkey (for STK Push)</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input {...field} type="password" readOnly={editingField !== 'mpesa_passkey'} className={editingField !== 'mpesa_passkey' ? "bg-muted cursor-not-allowed" : ""} placeholder="Enter your Passkey" />
                              </FormControl>
                              {editingField === 'mpesa_passkey' ? (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('mpesa_passkey')}><X className="h-4 w-4" /></Button>
                              ) : (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('mpesa_passkey')}><Edit className="h-4 w-4" /></Button>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="mpesa_initiator_name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Initiator Name (for B2C/Reversals)</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input {...field} readOnly={editingField !== 'mpesa_initiator_name'} className={editingField !== 'mpesa_initiator_name' ? "bg-muted cursor-not-allowed" : ""} placeholder="e.g., testapi" />
                              </FormControl>
                              {editingField === 'mpesa_initiator_name' ? (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('mpesa_initiator_name')}><X className="h-4 w-4" /></Button>
                              ) : (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('mpesa_initiator_name')}><Edit className="h-4 w-4" /></Button>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">Required for B2C payments and reversals</p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="mpesa_initiator_password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Initiator Password (Security Credential)</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input {...field} type="password" readOnly={editingField !== 'mpesa_initiator_password'} className={editingField !== 'mpesa_initiator_password' ? "bg-muted cursor-not-allowed" : ""} placeholder="Enter encrypted password" />
                              </FormControl>
                              {editingField === 'mpesa_initiator_password' ? (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('mpesa_initiator_password')}><X className="h-4 w-4" /></Button>
                              ) : (
                                <Button type="button" variant="ghost" size="icon" onClick={() => toggleEdit('mpesa_initiator_password')}><Edit className="h-4 w-4" /></Button>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">Must be encrypted with M-Pesa public key for production</p>
                            <FormMessage />
                            {settingsMeta.has_mpesa_initiator_password && (
                              <p className="text-xs text-muted-foreground">A security credential is already configured. Leave blank to keep it unchanged.</p>
                            )}
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Test Connection Button */}
                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-semibold">Test M-Pesa Connection</h4>
                          <p className="text-xs text-muted-foreground">Verify your credentials are working</p>
                        </div>
                        <Button 
                          type="button" 
                          variant="outline"
                          onClick={async () => {
                            try {
                              const toast = await import('@/components/ui/use-toast')
                              toast.toast({
                                title: 'Testing connection...',
                                description: 'Please wait',
                              })
                              
                              // Test by getting access token
                              const response = await fetch(
                                form.getValues('mpesa_env') === 'production'
                                  ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
                                  : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
                                {
                                  method: 'GET',
                                  headers: {
                                    Authorization: 'Basic ' + btoa(`${form.getValues('mpesa_consumer_key')}:${form.getValues('mpesa_consumer_secret')}`),
                                  },
                                }
                              )
                              
                              if (response.ok) {
                                const data = await response.json()
                                toast.toast({
                                  title: '✅ Connection Successful!',
                                  description: `Access token received. Expires in ${data.expires_in} seconds.`,
                                })
                              } else {
                                const error = await response.json()
                                toast.toast({
                                  variant: 'destructive',
                                  title: '❌ Connection Failed',
                                  description: error.error_description || 'Check your credentials',
                                })
                              }
                            } catch (error: any) {
                              const toast = await import('@/components/ui/use-toast')
                              toast.toast({
                                variant: 'destructive',
                                title: '❌ Connection Error',
                                description: error.message || 'Unable to connect to M-Pesa',
                              })
                            }
                          }}
                          disabled={!form.getValues('mpesa_consumer_key') || !form.getValues('mpesa_consumer_secret')}
                        >
                          📡 Test Connection
                        </Button>
                      </div>
                    </div>

                    <div className="flex justify-end pt-4">
                      <Button type="submit" disabled={savingSettings || editingField === null}>
                        <Save className="w-4 h-4 mr-2" />
                        {savingSettings ? 'Saving...' : 'Save M-Pesa Configuration'}
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="sms" className="space-y-4">
            <Tabs defaultValue="delivery" className="space-y-4">
              <TabsList className="grid h-auto w-full grid-cols-2">
                <TabsTrigger value="delivery">SMS & Templates</TabsTrigger>
                <TabsTrigger value="recipients">Member Alert Recipients</TabsTrigger>
              </TabsList>
              <TabsContent value="delivery" className="space-y-4">
                <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Mobiwave balance</CardDescription>
                  <CardTitle className="text-2xl">
                    {smsSummary?.balance == null ? 'N/A' : smsSummary.balance.toLocaleString()}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Sent</CardDescription>
                  <CardTitle className="text-2xl">{(smsSummary?.sent || 0).toLocaleString()}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Delivered</CardDescription>
                  <CardTitle className="text-2xl">{(smsSummary?.delivered || 0).toLocaleString()}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Failed</CardDescription>
                  <CardTitle className="text-2xl">{(smsSummary?.failed || 0).toLocaleString()}</CardTitle>
                </CardHeader>
              </Card>
                </div>

            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={() => void fetchSmsData()} disabled={smsLoading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${smsLoading ? 'animate-spin' : ''}`} />
                Refresh SMS Data
              </Button>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <Checkbox
                id="sms-only-debtors"
                checked={onlyDebtors}
                disabled={debtFilterLoading || smsRecipients.length === 0}
                onCheckedChange={(checked) => void handleToggleDebtFilter(checked === true)}
              />
              <label htmlFor="sms-only-debtors" className="text-sm text-slate-700">
                Only members with unpaid case balances
                {debtFilterLoading
                  ? ' — checking balances…'
                  : debtorIds
                    ? ` (${debtorIds.size.toLocaleString()} of ${smsRecipients.length.toLocaleString()})`
                    : ' (recommended for overdue / amount-due triggers)'}
              </label>
            </div>

            <SmsMessageComposer
              recipients={smsComposerRecipients}
              audienceLabel={onlyDebtors ? 'Active members with unpaid balances' : 'Active members with phone numbers'}
              audienceDescription="Send a Mobiwave SMS to active members that have phone numbers on file."
              onSend={handleSendSms}
              isSending={smsSending}
              templateOverrides={smsTemplateOverrides}
              templatesVersion={refreshTrigger}
            />

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquare className="h-4 w-4" />
                  Recent SMS Activity
                </CardTitle>
                <CardDescription>
                  {smsSummary?.total != null ? `${smsSummary.total.toLocaleString()} total entries` : 'Loading...'} — Page {smsSummary?.page || 1} of {smsSummary?.total != null ? Math.max(1, Math.ceil(smsSummary.total / smsPageSize)) : 1}. Click a row to expand.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[480px] overflow-y-auto overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Trigger</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Message</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(smsSummary?.recent || []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground">
                            {smsLoading ? 'Loading SMS logs...' : 'No SMS activity recorded yet.'}
                          </TableCell>
                        </TableRow>
                      ) : (
                        (smsSummary?.recent || []).map((row, index) => {
                          const metadata = row.metadata || {};
                          const logKey = `sms-${index}`;
                          const isOpen = expandedLog === logKey;
                          const msg = String(metadata.message || '');
                          const trigger = String(metadata.trigger_key || '-');
                          return (
                            <React.Fragment key={logKey}>
                              <TableRow
                                className="cursor-pointer hover:bg-muted/50"
                                onClick={() => setExpandedLog(isOpen ? null : logKey)}
                              >
                                <TableCell>{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</TableCell>
                                <TableCell className="text-xs whitespace-nowrap">{row.timestamp ? new Date(row.timestamp).toLocaleString() : '-'}</TableCell>
                                <TableCell className="text-xs font-mono">{String(metadata.phone_number || '-')}</TableCell>
                                <TableCell><Badge variant="outline" className="text-[10px]">{trigger}</Badge></TableCell>
                                <TableCell>
                                  <Badge variant={row.status === 'error' ? 'destructive' : 'secondary'}>
                                    {row.status || 'unknown'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs max-w-[300px] truncate">{msg || '-'}</TableCell>
                              </TableRow>
                              {isOpen && msg && (
                                <TableRow key={`${logKey}-expanded`}>
                                  <TableCell colSpan={6} className="bg-muted/20 p-3">
                                    <pre className="text-xs whitespace-pre-wrap font-sans break-words">{msg}</pre>
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
                {/* Pagination */}
                {smsSummary?.total != null && smsSummary.total > smsPageSize && (
                  <div className="flex items-center justify-between border-t px-4 py-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={smsPage <= 1 || smsLoading}
                      onClick={() => { setSmsPage(1); void fetchSmsData(1); }}
                    >
                      First
                    </Button>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={smsPage <= 1 || smsLoading}
                        onClick={() => { const p = smsPage - 1; setSmsPage(p); void fetchSmsData(p); }}
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Page {smsPage} of {Math.ceil(smsSummary.total / smsPageSize)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={smsPage >= Math.ceil(smsSummary.total / smsPageSize) || smsLoading}
                        onClick={() => { const p = smsPage + 1; setSmsPage(p); void fetchSmsData(p); }}
                      >
                        Next
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={smsPage >= Math.ceil(smsSummary.total / smsPageSize) || smsLoading}
                      onClick={() => { const p = Math.ceil(smsSummary.total / smsPageSize); setSmsPage(p); void fetchSmsData(p); }}
                    >
                      Last
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PenLine className="h-4 w-4" />
                  Message Templates
                </CardTitle>
                <CardDescription>Customise the SMS templates used by trigger messages. Use <code className="bg-slate-200 px-1 rounded">{'{\u2026}'}</code> tags for per-recipient data: <code>{'{name}'}</code>, <code>{'{memberNumber}'}</code>, <code>{'{amount}'}</code>, <code>{'{caseNumber}'}</code>, <code>{'{deadline}'}</code>, <code>{'{balance}'}</code>.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {smsTemplates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No templates loaded. Refresh SMS data.</p>
                ) : (
                  smsTemplates.map((tmpl) => (
                    <div key={tmpl.trigger_key} className="border rounded-lg p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{tmpl.label}</span>
                            <Badge variant="outline" className="text-[10px]">{tmpl.category}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{tmpl.description}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingTemplate(editingTemplate === tmpl.trigger_key ? null : tmpl.trigger_key);
                            setEditingRawTemplate(tmpl.raw_template);
                          }}
                        >
                          <Edit className="h-3.5 w-3.5 mr-1" />
                          {editingTemplate === tmpl.trigger_key ? 'Cancel' : 'Edit'}
                        </Button>
                      </div>
                      {editingTemplate === tmpl.trigger_key ? (
                        <div className="mt-3 space-y-2">
                          <textarea
                            className="w-full min-h-[80px] rounded-lg border border-slate-200 p-2 text-xs font-mono resize-y"
                            value={editingRawTemplate}
                            onChange={(e) => setEditingRawTemplate(e.target.value)}
                          />
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              onClick={() => void handleSaveTemplate(tmpl.trigger_key)}
                              disabled={smsTemplatesSaving}
                            >
                              <Save className="h-3.5 w-3.5 mr-1" />
                              {smsTemplatesSaving ? 'Saving...' : 'Save Template'}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-slate-600 font-mono bg-slate-50 rounded px-2 py-1">{tmpl.raw_template}</p>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
              </TabsContent>
              <TabsContent value="recipients" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Member Alert SMS Recipients</CardTitle>
                    <CardDescription>
                      Select the active administrators who should receive a copy of each member, payment, case, suspension, penalty, probation, or registration alert. Choose one or two administrators for routine events; leave an event unselected if no admin SMS is required.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {smsAlertLoading ? (
                      <p className="text-sm text-muted-foreground">Loading administrators and alert settings…</p>
                    ) : smsAlertAdmins.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No active administrators with SMS-ready accounts were found.</p>
                    ) : (
                      <div className="space-y-3">
                        {smsAlertEvents.map((event) => {
                          const selected = getAlertRecipients(event.key);
                          return (
                            <div key={event.key} className="rounded-lg border p-3">
                              <div className="mb-2">
                                <p className="font-semibold text-sm">{event.label}</p>
                                <p className="text-xs text-muted-foreground">{event.description}</p>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {smsAlertAdmins.map((admin) => {
                                  const checked = selected.includes(admin.id);
                                  return (
                                    <label key={admin.id} className="flex items-start gap-2 rounded-md border bg-slate-50 p-2 text-sm">
                                      <Checkbox
                                        checked={checked}
                                        onCheckedChange={(value) => {
                                          const next = value === true
                                            ? [...selected, admin.id]
                                            : selected.filter((id) => id !== admin.id);
                                          setSmsAlertSettings((current) => [
                                            ...current.filter((item) => item.trigger_key !== event.key),
                                            { trigger_key: event.key, admin_user_ids: next, is_active: true },
                                          ]);
                                        }}
                                      />
                                      <span>
                                        <span className="block font-medium">{admin.name} <Badge variant="outline" className="ml-1 text-[10px]">{admin.role}</Badge></span>
                                        <span className="block text-xs text-muted-foreground">{admin.phone_number || 'No linked phone number'}</span>
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                              <div className="mt-3 flex justify-end">
                                <Button
                                  size="sm"
                                  onClick={() => void saveSmsAlertRecipients(event.key, getAlertRecipients(event.key))}
                                  disabled={smsAlertSaving === event.key}
                                >
                                  <Save className="mr-1 h-3.5 w-3.5" />
                                  {smsAlertSaving === event.key ? 'Saving…' : 'Save recipients'}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">Admin SMS delivery uses the phone number on the administrator’s linked member record. Update that member phone number if it changes.</p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Settings;
