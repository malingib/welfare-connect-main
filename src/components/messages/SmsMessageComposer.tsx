import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  buildSmsPreview,
  getRawTemplate,
  isValidKenyanSmsPhone,
  normalizeSmsRecipients,
  partitionSmsRecipients,
  SmsRecipient,
  SmsSendSummary,
  SmsTriggerKey,
  smsTemplates,
  summarizeSkippedReasons,
} from '@/lib/smsMessaging';
import { invokeWithAppToken } from '@/lib/appAuth';

type ComposerPayload = {
  triggerKey: SmsTriggerKey;
  message: string;
  recipients: SmsRecipient[];
};

type SmsMessageComposerProps = {
  recipients: SmsRecipient[];
  audienceLabel: string;
  audienceDescription?: string;
  onSend: (payload: ComposerPayload) => Promise<SmsSendSummary | void>;
  isSending?: boolean;
  compact?: boolean;
  showRecipientCount?: boolean;
  /** Admin-edited templates (trigger key -> raw template). Overrides built-ins. */
  templateOverrides?: Partial<Record<SmsTriggerKey, string>>;
  /** Bump to refresh templates after an edit is saved elsewhere. */
  templatesVersion?: number | string;
};

const TAGS = ['{name}', '{memberNumber}', '{balance}', '{amount}', '{caseNumber}', '{deadline}', '{unpaid}', '{due}'] as const;

function buildContextFromRecipient(first: SmsRecipient | null) {
  return {
    audienceCount: first ? 1 : 0,
    memberName: first?.name || 'member',
    memberNumber: first?.memberNumber || 'M-0000',
    caseNumber: first?.caseNumber || 'CASE-001',
    amount: first?.amount || '0',
    deadline: first?.deadline || 'N/A',
    balance: '{balance}',
  };
}

function renderRawPreview(raw: string, first: SmsRecipient | null): string {
  const values: Record<string, string> = {
    name: first?.name || 'member',
    memberNumber: first?.memberNumber || 'M-0000',
    caseNumber: first?.caseNumber || 'CASE-001',
    amount: first?.amount || '0',
    deadline: first?.deadline || 'N/A',
    balance: '0',
    unpaid: first?.unpaid || '0',
    due: first?.due || '',
    ref: '',
    senderName: '',
  };
  let result = raw;
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{${key}}`, value || '');
    result = result.replaceAll(`[${key}]`, value || '');
  }
  return result.trim();
}

const MAX_LISTED_PHONES = 100;

export function SmsMessageComposer({
  recipients,
  audienceLabel,
  audienceDescription,
  onSend,
  isSending = false,
  compact = false,
  showRecipientCount = true,
  templateOverrides,
  templatesVersion,
}: SmsMessageComposerProps) {
  const normalizedRecipients = useMemo(() => normalizeSmsRecipients(recipients), [recipients]);
  const { valid: validRecipients, invalid: invalidRecipients } = useMemo(
    () => partitionSmsRecipients(recipients),
    [recipients],
  );
  const [activeTab, setActiveTab] = useState<'triggers' | 'custom'>('triggers');
  const [triggerKey, setTriggerKey] = useState<SmsTriggerKey>('welcome_member');
  const [customMessage, setCustomMessage] = useState('');
  const [lastResult, setLastResult] = useState<SmsSendSummary | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [remoteTemplates, setRemoteTemplates] = useState<Partial<Record<SmsTriggerKey, string>> | null>(null);

  // Prefer caller-supplied (DB) templates; otherwise fetch the admin-edited
  // templates once so preview/send match what the backend will actually use.
  useEffect(() => {
    if (templateOverrides) {
      setRemoteTemplates((prev) => {
        const keys = new Set([...Object.keys(prev || {}), ...Object.keys(templateOverrides)]);
        for (const key of keys) {
          if ((prev as Record<string, string> | null)?.[key] !== (templateOverrides as Record<string, string>)[key]) {
            return templateOverrides;
          }
        }
        return prev ?? templateOverrides;
      });
      return;
    }
    let cancelled = false;
    invokeWithAppToken<{ templates: Array<{ trigger_key: string; raw_template: string }> }>('api-sms-templates', {})
      .then((res) => {
        if (cancelled) return;
        const map: Partial<Record<SmsTriggerKey, string>> = {};
        for (const tpl of res?.templates || []) {
          const text = String(tpl?.raw_template || '').trim();
          if (tpl?.trigger_key && text) map[tpl.trigger_key as SmsTriggerKey] = text;
        }
        setRemoteTemplates(map);
      })
      .catch(() => {
        if (!cancelled) setRemoteTemplates({});
      });
    return () => {
      cancelled = true;
    };
  }, [templateOverrides, templatesVersion]);

  // Clear a stale result when the audience changes.
  useEffect(() => {
    setLastResult(null);
    setShowSkipped(false);
  }, [normalizedRecipients]);

  const resolveRawTemplate = (key: SmsTriggerKey): string => {
    const override = remoteTemplates?.[key]?.trim();
    return override || getRawTemplate(key);
  };

  const firstRecipient = validRecipients[0] || normalizedRecipients[0] || null;
  const previewContext = useMemo(
    () => buildContextFromRecipient(firstRecipient),
    [firstRecipient],
  );

  const previewMessage = activeTab === 'triggers'
    ? (remoteTemplates?.[triggerKey]?.trim()
      ? renderRawPreview(remoteTemplates[triggerKey] as string, firstRecipient)
      : buildSmsPreview(triggerKey, previewContext))
    : customMessage.trim();

  const handleSend = async () => {
    const message = activeTab === 'triggers'
      ? resolveRawTemplate(triggerKey)
      : customMessage.trim();

    if (!validRecipients.length || !message) {
      return;
    }

    const summary = await onSend({
      triggerKey: activeTab === 'triggers' ? triggerKey : 'manual_custom',
      message,
      recipients: validRecipients,
    });
    if (summary && typeof summary === 'object') {
      setLastResult(summary);
      setShowSkipped((summary.skipped || 0) > 0);
    }
  };

  const skippedDetails = lastResult?.skippedDetails || [];
  const listedSkipped = skippedDetails.slice(0, MAX_LISTED_PHONES);

  return (
    <Card className={cn('border-slate-200 shadow-sm', compact && 'shadow-none')}>
      <CardHeader className={cn('space-y-2', compact ? 'pb-3' : 'pb-4')}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base md:text-lg">Message composer</CardTitle>
            <CardDescription className="text-xs md:text-sm">
              {audienceDescription || `Compose an SMS for ${audienceLabel}.`}
            </CardDescription>
          </div>
          {showRecipientCount && (
            <Badge variant="secondary" className="h-fit">
              {validRecipients.length.toLocaleString()} recipients
            </Badge>
          )}
        </div>
        {invalidRecipients.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {invalidRecipients.length.toLocaleString()} number{invalidRecipients.length === 1 ? '' : 's'} excluded —{' '}
              {invalidRecipients.slice(0, 5).map((r) => r.phoneNumber).join(', ')}
              {invalidRecipients.length > 5 ? ` and ${invalidRecipients.length - 5} more` : ''} is not a valid
              Kenyan mobile number and would be rejected by the provider.
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'triggers' | 'custom')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="triggers">Triggers</TabsTrigger>
            <TabsTrigger value="custom">Custom</TabsTrigger>
          </TabsList>

          <TabsContent value="triggers" className="space-y-4">
            <div className="grid gap-2 md:grid-cols-2">
              {smsTemplates
                .filter((template) => template.key !== 'manual_custom')
                .map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    onClick={() => setTriggerKey(template.key)}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-all',
                      triggerKey === template.key
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{template.label}</p>
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        {template.category}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{template.description}</p>
                    {(triggerKey === 'case_due' || triggerKey === 'overdue_reminder' || triggerKey === 'amount_due' || triggerKey === 'case_opened') && (
                      <p className="mt-1 text-[11px] text-slate-400">
                        Only members with unpaid case balances receive this trigger — the rest are skipped.
                      </p>
                    )}
                  </button>
                ))}
            </div>

            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preview</p>
              <p className="mt-2 text-sm leading-6 text-slate-800">
                {previewMessage || 'Pick a trigger to preview the message.'}
              </p>
              {firstRecipient && (
                <p className="mt-1 text-xs text-slate-400">
                  Preview uses data from: {firstRecipient.name || firstRecipient.phoneNumber}
                  {firstRecipient.name ? ` (${firstRecipient.phoneNumber})` : ''}
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="custom" className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="custom-message">Custom message</Label>
              <Textarea
                id="custom-message"
                value={customMessage}
                onChange={(event) => setCustomMessage(event.target.value)}
                placeholder="Write your custom SMS here. You can use tags that will be replaced per-recipient:"
                rows={5}
              />
              <div className="flex flex-wrap gap-1.5">
                {TAGS.map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="cursor-pointer text-[10px] font-mono text-slate-500 hover:text-primary hover:border-primary"
                    onClick={() => setCustomMessage((prev) => `${prev}${tag} `)}
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-slate-400">
                Tags are replaced per-recipient with their actual data. {`{balance}`} is fetched from their wallet.
              </p>
            </div>
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preview</p>
              <p className="mt-2 text-sm leading-6 text-slate-800">
                {customMessage.trim() || 'Your custom message preview will appear here.'}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                In preview tags are shown as-is. Recipients will get their own values.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {lastResult && (
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last send result</p>
            <p className="text-sm text-slate-800">
              {(lastResult.sent || 0).toLocaleString()} sent
              {(lastResult.failed || 0) > 0 ? `, ${(lastResult.failed || 0).toLocaleString()} failed` : ''}
              {(lastResult.skipped || 0) > 0 ? `, ${(lastResult.skipped || 0).toLocaleString()} skipped` : ''}{' '}
              of {(lastResult.recipients || 0).toLocaleString()} recipients.
            </p>
            {(lastResult.skipped || 0) > 0 && (
              <div>
                <p className="text-xs text-slate-500">{summarizeSkippedReasons(lastResult)}</p>
                <button
                  type="button"
                  onClick={() => setShowSkipped((v) => !v)}
                  className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  {showSkipped ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  {showSkipped ? 'Hide' : 'Show'} skipped numbers
                </button>
                {showSkipped && (
                  <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg bg-white p-2">
                    {listedSkipped.map((row, index) => (
                      <p key={`${row.phoneNumber}-${index}`} className="text-xs text-slate-600">
                        <span className="font-mono">{row.phoneNumber}</span>
                        {row.name ? ` — ${row.name}` : ''} — {row.reason}
                      </p>
                    ))}
                    {skippedDetails.length > MAX_LISTED_PHONES && (
                      <p className="text-xs text-slate-400">
                        …and {(skippedDetails.length - MAX_LISTED_PHONES).toLocaleString()} more.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">{audienceLabel}</p>
            <p className="text-xs text-slate-500">
              {validRecipients.length
                ? `Ready to send to ${validRecipients.length.toLocaleString()} recipient${validRecipients.length === 1 ? '' : 's'}.`
                : 'No recipients selected yet.'}
            </p>
          </div>
          <Button onClick={() => void handleSend()} disabled={isSending || validRecipients.length === 0 || !previewMessage.trim()}>
            {isSending ? 'Sending...' : 'Send message'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Re-exported for validation parity checks in tests/consumers.
export { isValidKenyanSmsPhone };
