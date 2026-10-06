export type SmsTriggerKey =
  | 'welcome_member'
  | 'registration_submitted'
  | 'registration_pending_review'
  | 'registration_approved'
  | 'registration_rejected'
  | 'case_opened'
  | 'case_closed'
  | 'payment_received'
  | 'payment_failed'
  | 'case_due'
  | 'overdue_reminder'
  | 'amount_due'
  | 'renewal_reminder'
  | 'closed_case_overdue'
  | 'probation_ending'
  | 'probation_completed'
  | 'penalty_posted'
  | 'status_changed'
  | 'auto_inactive'
  | 'manual_custom';

export type SmsRecipient = {
  id?: string;
  name?: string;
  phoneNumber: string;
  memberNumber?: string;
  memberId?: string;
  residence?: string;
  status?: string;
  amount?: string;
  caseNumber?: string;
  deadline?: string;
  unpaid?: string;
  due?: string;
};

export type SmsTemplateContext = {
  audienceCount: number;
  memberName?: string;
  memberNumber?: string;
  caseNumber?: string;
  amount?: string;
  deadline?: string;
  balance?: string;
};

export type SmsTemplate = {
  key: SmsTriggerKey;
  label: string;
  description: string;
  category: 'member' | 'case' | 'payment' | 'renewal' | 'registration' | 'custom';
  message: (context: SmsTemplateContext) => string;
  rawTemplate: string;
};

export const smsTemplates: SmsTemplate[] = [
  {
    key: 'registration_submitted',
    label: 'Registration Submitted',
    description: 'Confirm a membership application was received.',
    category: 'member',
    message: () => 'Malanga Welfare: Your membership application has been received and is awaiting review.',
    rawTemplate: 'Malanga Welfare: Your membership application has been received and is awaiting review.',
  },
  {
    key: 'registration_pending_review',
    label: 'Registration Pending Review',
    description: 'Notify an applicant that review is pending.',
    category: 'member',
    message: () => 'Malanga Welfare: Your membership application is pending Welfare Committee review.',
    rawTemplate: 'Malanga Welfare: Your membership application is pending Welfare Committee review.',
  },
  {
    key: 'registration_approved',
    label: 'Registration Approved',
    description: 'Request registration-fee payment after approval.',
    category: 'payment',
    message: ({ memberNumber }) => `Malanga Welfare: Your application has been approved. Pay the registration fee using reference ${memberNumber || 'provided'}.`,
    rawTemplate: 'Malanga Welfare: Your application has been approved. Pay the registration fee using reference {memberNumber}.',
  },
  {
    key: 'registration_rejected',
    label: 'Registration Rejected',
    description: 'Notify an applicant that the application was not approved.',
    category: 'member',
    message: () => 'Malanga Welfare: Your membership application was not approved. Please contact the Welfare Committee for assistance.',
    rawTemplate: 'Malanga Welfare: Your membership application was not approved. Please contact the Welfare Committee for assistance.',
  },
  {
    key: 'welcome_member',
    label: 'Welcome Member',
    description: 'Send right after a member is registered.',
    category: 'member',
    message: ({ memberName, memberNumber }) =>
      `Malanga Welfare: Karibu ${memberName || 'mwanachama'}. Nambari yako ya mwanachama ni ${memberNumber || 'N/A'}.`,
    rawTemplate: 'Malanga Welfare: Karibu {name}. Nambari yako ya mwanachama ni {memberNumber}.',
  },
  {
    key: 'case_opened',
    label: 'Case Opened',
    description: 'Notify members when a new case has been opened.',
    category: 'case',
    message: ({ memberName, caseNumber, deadline }) =>
      [
        `Malanga Welfare: Kesi ${caseNumber || 'N/A'} imefunguliwa.`,
        memberName ? `Mwanachama: ${memberName}.` : null,
        deadline ? `Tarehe: ${deadline}.` : null,
      ]
        .filter(Boolean)
        .join(' '),
    rawTemplate: [
      'Malanga Welfare: Kesi {caseNumber} imefunguliwa.',
      'Mwanachama: {name}.',
      'Tarehe: {deadline}.',
    ].join(' '),
  },
  {
    key: 'case_closed',
    label: 'Case Closed',
    description: 'Notify members when a welfare case is closed.',
    category: 'case',
    message: ({ caseNumber }) => `Malanga Welfare: Case ${caseNumber || 'N/A'} has been closed. Thank you for your support.`,
    rawTemplate: 'Malanga Welfare: Case {caseNumber} has been closed. Thank you for your support.',
  },
  {
    key: 'payment_received',
    label: 'Payment Received',
    description: 'Confirm a successful contribution or wallet payment.',
    category: 'payment',
    message: ({ amount, balance }) =>
      [
        `Malanga Welfare: Malipo${amount ? ` KES ${amount}` : ''} yamepokelewa.`,
        balance ? `Salio: KES ${balance}.` : null,
      ]
        .filter(Boolean)
        .join(' '),
    rawTemplate: 'Malanga Welfare: Malipo KES {amount} yamepokelewa. Salio: KES {balance}.',
  },
  {
    key: 'payment_failed',
    label: 'Payment Failed',
    description: 'Let the member know a payment did not complete.',
    category: 'payment',
    message: ({ memberName }) =>
      `Malanga Welfare: Malipo yako hayajakamilika${memberName ? `, ${memberName}` : ''}. Tafadhali jaribu tena au wasiliana nasi.`,
    rawTemplate: 'Malanga Welfare: Malipo yako hayajakamilika, {name}. Tafadhali jaribu tena au wasiliana nasi.',
  },
  {
    key: 'case_due',
    label: 'Case Due Reminder',
    description: 'Remind members before case contribution deadlines.',
    category: 'case',
    message: ({ caseNumber, amount, memberNumber, deadline }) =>
      [
        `Mwanachama mpendwa, hujalipa case ${caseNumber || 'N/A'}.`,
        amount ? `Tafadhali lipa KES ${amount} kwa paybill 4164179 account ${memberNumber || 'N/A'} kabla ${deadline || 'sasa'}.` : null,
      ]
        .filter(Boolean)
        .join(' '),
    rawTemplate: 'Mwanachama mpendwa, hujalipa case {caseNumber}. Tafadhali lipa KES {amount} kwa paybill 4164179 account {memberNumber} kabla {deadline}.',
  },
  {
    key: 'overdue_reminder',
    label: 'Overdue Reminder',
    description: 'Follow up on unpaid case contributions.',
    category: 'case',
    message: ({ caseNumber, amount }) =>
      [
        `Mwanachama mpendwa, malipo ya case ${caseNumber || 'N/A'} yamechelewa.`,
        amount ? `Tafadhali lipa KES ${amount} haraka iwezekanavyo.` : 'Tafadhali lipa haraka iwezekanavyo.',
      ].join(' '),
    rawTemplate: 'Mwanachama mpendwa, malipo ya case {caseNumber} yamechelewa. Tafadhali lipa KES {amount} haraka iwezekanavyo.',
  },
  {
    key: 'amount_due',
    label: 'Amount Due',
    description: 'Notify members about their total outstanding balance (unpaid cases + penalty).',
    category: 'case',
    message: ({ memberName, amount, caseNumber, due }) =>
      [
        `Malanga Welfare: Mwanachama ${memberName || 'mdarawa'}, una deni la KES ${due || amount || '0'}.`,
        caseNumber ? `Kesi ${caseNumber}.` : null,
        'Tafadhali lipa haraka iwezekanavyo.',
      ]
        .filter(Boolean)
        .join(' '),
    rawTemplate: 'Malanga Welfare: Mwanachama {name}, una deni la KES {due}. {caseNumber} Tafadhali lipa haraka iwezekanavyo.',
  },
  {
    key: 'renewal_reminder',
    label: 'Renewal Reminder',
    description: 'Notify members before renewal falls due.',
    category: 'renewal',
    message: ({ deadline }) =>
      [
        'Malanga Welfare: Usajili wako unakaribia kufikia mwisho.',
        deadline ? `Tafadhali lipa kabla ya ${deadline}.` : 'Tafadhali lipa kabla ya muda.',
      ].join(' '),
    rawTemplate: 'Malanga Welfare: Usajili wako unakaribia kufikia mwisho. Tafadhali lipa kabla ya {deadline}.',
  },
  {
    key: 'closed_case_overdue',
    label: 'Closed Case Overdue',
    description: 'Follow up on unpaid balances for finalized (closed) cases.',
    category: 'case',
    message: ({ memberName, amount, caseNumber, memberNumber }) =>
      [
        `Mwanachama mpendwa ${memberName || 'mwanachama'}, kesi ${caseNumber || 'N/A'} ilifungwa na hujalipa KES ${amount || '0'}.`,
        `Tafadhali lipa kama malipo ya kuchelewa kwa paybill 4164179 account ${memberNumber || 'N/A'}.`,
      ].join(' '),
    rawTemplate: 'Mwanachama mpendwa {name}, kesi {caseNumber} ilifungwa na hujalipa KES {amount}. Tafadhali lipa kama malipo ya kuchelewa kwa paybill 4164179 account {memberNumber}.',
  },
  {
    key: 'probation_ending',
    label: 'Probation Ending',
    description: 'Notify members whose probation period ends soon.',
    category: 'member',
    message: ({ memberName, deadline }) =>
      [
        `Mwanachama mpendwa ${memberName || 'mwanachama'}, muda wako wa majaribio unaisha ${deadline || 'hivi karibuni'}.`,
        'Endelea kuchangia ili uwe mwanachama kamili.',
      ].join(' '),
    rawTemplate: 'Mwanachama mpendwa {name}, muda wako wa majaribio unaisha {deadline}. Endelea kuchangia ili uwe mwanachama kamili.',
  },
  {
    key: 'probation_completed',
    label: 'Probation Completed',
    description: 'Congratulate members who became full members.',
    category: 'member',
    message: ({ memberName }) =>
      `Hongera ${memberName || 'mwanachama'}! Muda wako wa majaribio umeisha na sasa wewe ni mwanachama kamili wa Malanga Welfare.`,
    rawTemplate: 'Hongera {name}! Muda wako wa majaribio umeisha na sasa wewe ni mwanachama kamili wa Malanga Welfare.',
  },
  {
    key: 'penalty_posted',
    label: 'Penalty Posted',
    description: 'Notify members when a reinstatement penalty is posted.',
    category: 'payment',
    message: ({ memberName, amount }) =>
      `Mwanachama mpendwa ${memberName || 'mwanachama'}, adhabu ya KES ${amount || '0'} imewekwa kwenye akaunti yako. Lipa kupitia paybill ili kuendelea kupata huduma.`,
    rawTemplate: 'Mwanachama mpendwa {name}, adhabu ya KES {amount} imewekwa kwenye akaunti yako. Lipa kupitia paybill ili kuendelea kupata huduma.',
  },
  {
    key: 'status_changed',
    label: 'Status Changed',
    description: 'Notify members when their membership status changes.',
    category: 'member',
    message: ({ memberName }) =>
      `Mwanachama mpendwa ${memberName || 'mwanachama'}, hali yako ya uanachama imebadilika. Fungua programu kuona maelezo.`,
    rawTemplate: 'Mwanachama mpendwa {name}, hali yako ya uanachama imebadilika kutoka {from} hadi {to}.',
  },
  {
    key: 'auto_inactive',
    label: 'Auto Inactive',
    description: 'Notify members suspended for unpaid contributions.',
    category: 'member',
    message: ({ memberName }) =>
      `Mwanachama mpendwa ${memberName || 'mwanachama'}, uanachama wako umesimamishwa kwa sababu ya malipo yanayodaiwa. Lipa kupitia paybill 4164179 ili kurejesha uanachama.`,
    rawTemplate: 'Mwanachama mpendwa {name}, uanachama wako umesimamishwa kwa sababu ya malipo yanayodaiwa. Lipa kupitia paybill 4164179 ili kurejesha uanachama.',
  },
  {
    key: 'manual_custom',
    label: 'Manual Custom',
    description: 'Write a completely custom message.',
    category: 'custom',
    message: () => '',
    rawTemplate: '',
  },
];

export function getRawTemplate(key: SmsTriggerKey): string {
  return smsTemplates.find((t) => t.key === key)?.rawTemplate ?? '';
}

export function getSmsTemplate(key: SmsTriggerKey): SmsTemplate {
  return smsTemplates.find((template) => template.key === key) || smsTemplates[0];
}

export function buildSmsPreview(
  key: SmsTriggerKey,
  context: SmsTemplateContext,
): string {
  const template = getSmsTemplate(key);
  return template.message(context).trim();
}

function normalizePhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith('7')) return `254${digits}`;
  return digits;
}

export function isValidKenyanSmsPhone(phone: string): boolean {
  // Mirrors the backend check in supabase/functions/_shared/sms.ts.
  // Kenyan mobiles: 254 + (7|1) + 8 digits. Anything else (e.g. '114366708')
  // is rejected by the provider, so we exclude it up front with an explanation.
  return /^254(7|1)\d{8}$/.test(normalizePhone(phone));
}

export type SmsSkippedDetail = {
  phoneNumber: string;
  reason: string;
  name?: string;
};

export type SmsSendSummary = {
  sent: number;
  failed: number;
  skipped: number;
  recipients: number;
  skippedDetails?: SmsSkippedDetail[];
  skippedSummary?: Record<string, number>;
};

export function summarizeSkippedReasons(summary: SmsSendSummary | null | undefined): string {
  const entries = Object.entries(summary?.skippedSummary || {});
  if (!entries.length) return '';
  return entries.map(([reason, count]) => `${count.toLocaleString()} × ${reason}`).join('; ');
}

export function partitionSmsRecipients(
  recipients: SmsRecipient[],
): { valid: SmsRecipient[]; invalid: SmsRecipient[] } {
  const valid: SmsRecipient[] = [];
  const invalid: SmsRecipient[] = [];
  for (const recipient of normalizeSmsRecipients(recipients)) {
    if (isValidKenyanSmsPhone(recipient.phoneNumber)) valid.push(recipient);
    else invalid.push(recipient);
  }
  return { valid, invalid };
}

export function normalizeSmsRecipients(
  recipients: SmsRecipient[],
): SmsRecipient[] {
  return recipients
    .map((recipient) => ({
      ...recipient,
      phoneNumber: normalizePhone(recipient.phoneNumber),
      name: recipient.name ? String(recipient.name).trim() : undefined,
      memberNumber: recipient.memberNumber ? String(recipient.memberNumber).trim() : undefined,
      memberId: recipient.memberId ? String(recipient.memberId).trim() : undefined,
      amount: recipient.amount ? String(recipient.amount).trim() : undefined,
      caseNumber: recipient.caseNumber ? String(recipient.caseNumber).trim() : undefined,
      deadline: recipient.deadline ? String(recipient.deadline).trim() : undefined,
    }))
    .filter((recipient) => recipient.phoneNumber.length > 0);
}
