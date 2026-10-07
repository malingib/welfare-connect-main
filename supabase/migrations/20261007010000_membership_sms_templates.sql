-- Registration lifecycle SMS templates.
-- Payment uses an application code; a member number is only available after activation.

INSERT INTO public.sms_templates (trigger_key, label, description, category, raw_template)
VALUES
  ('registration_submitted', 'Registration Submitted', 'Confirm receipt of a new membership application.', 'registration',
   'Malanga Welfare: Your membership application has been received and is awaiting Welfare Committee review.'),
  ('registration_pending_review', 'Registration Pending Review', 'Notify an applicant that review is pending.', 'registration',
   'Malanga Welfare: Your membership application is pending Welfare Committee review.'),
  ('registration_approved', 'Registration Approved', 'Request payment after application approval.', 'registration',
   'Malanga Welfare: Your membership application has been approved. Pay KES {amount} via Paybill {paybill}, account {paymentCode} by {deadline}. Your member number will be issued after payment is verified.'),
  ('registration_payment_pending', 'Registration Payment Pending', 'Remind an approved applicant about unpaid registration fees.', 'registration',
   'Malanga Welfare: Payment for your approved membership is still pending. Pay KES {amount} via Paybill {paybill}, account {paymentCode} by {deadline}.'),
  ('registration_payment_received', 'Registration Payment Received', 'Acknowledge payment while administrator verification is pending.', 'payment',
   'Malanga Welfare: We have received payment for application code {paymentCode}. The Welfare Committee will verify it before activating your membership.'),
  ('registration_activated', 'Membership Activated', 'Notify an applicant after verified payment and member creation.', 'member',
   'Malanga Welfare: Congratulations {name}. Your membership is now active. Your member number is {memberNumber}.'),
  ('registration_rejected', 'Registration Rejected', 'Notify an applicant that the application was rejected.', 'registration',
   'Malanga Welfare: Your membership application was not approved. Please contact the Welfare Committee for assistance.'),
  ('registration_expired', 'Application Expired', 'Notify an applicant when an unpaid or rejected application expires after one week.', 'registration',
   'Malanga Welfare: Your membership application has expired after one week without completion. Please submit a new application or contact the Welfare Committee.'),
  ('whatsapp_group_invite', 'WhatsApp Group Invitation', 'Send separately after membership activation.', 'member',
   'Malanga Welfare: Join the members WhatsApp group here: {whatsappLink}. Please do not share this link publicly.')
ON CONFLICT (trigger_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  raw_template = EXCLUDED.raw_template,
  updated_at = now();
