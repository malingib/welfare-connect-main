-- Configurable administrator recipients for event-driven SMS alerts.
-- Admin users are selected by ID; their phone numbers are resolved from the
-- linked member record at send time so phone changes do not require settings edits.

CREATE TABLE IF NOT EXISTS public.sms_alert_recipient_settings (
  trigger_key TEXT PRIMARY KEY,
  admin_user_ids UUID[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NULL
);

ALTER TABLE public.sms_alert_recipient_settings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.sms_alert_recipient_settings TO service_role;

INSERT INTO public.sms_alert_recipient_settings (trigger_key)
VALUES
  ('registration_submitted'),
  ('registration_pending_review'),
  ('registration_approved'),
  ('registration_rejected'),
  ('payment_received'),
  ('payment_failed'),
  ('case_opened'),
  ('case_closed'),
  ('status_changed'),
  ('auto_inactive'),
  ('penalty_posted'),
  ('probation_ending'),
  ('probation_completed'),
  ('closed_case_overdue')
ON CONFLICT (trigger_key) DO NOTHING;

COMMENT ON TABLE public.sms_alert_recipient_settings IS
  'Admin-selected SMS recipients per member, payment, case, registration, penalty, suspension, and probation event.';

-- Templates for the registration and case lifecycle events that were not in
-- the original template seed. Existing templates remain admin-editable.
INSERT INTO public.sms_templates (trigger_key, label, description, category, raw_template) VALUES
  ('registration_submitted', 'Registration Submitted', 'Confirm that a membership application was received.', 'registration',
   'Malanga Welfare: Your membership application has been received and is awaiting review.'),
  ('registration_pending_review', 'Registration Pending Review', 'Notify the applicant and configured administrators that review is pending.', 'registration',
   'Malanga Welfare: Your membership application is pending Welfare Committee review.'),
  ('registration_approved', 'Registration Approved', 'Tell an approved applicant to pay the registration fee.', 'registration',
   'Malanga Welfare: Your application has been approved. Pay the registration fee using reference {memberNumber}.'),
  ('registration_rejected', 'Registration Rejected', 'Notify an applicant that the application was not approved.', 'registration',
   'Malanga Welfare: Your membership application was not approved. Please contact the Welfare Committee for assistance.'),
  ('case_closed', 'Case Closed', 'Notify members and configured administrators when a welfare case is closed.', 'case',
   'Malanga Welfare: Case {caseNumber} has been closed. Thank you for your support.' )
ON CONFLICT (trigger_key) DO NOTHING;

-- Emit one notification row for case opening and one when a case is finalized.
-- The notification SMS worker delivers the member SMS and the configured admin
-- copies from the same row, preventing separate hard-coded recipient paths.
CREATE OR REPLACE FUNCTION public.notify_case_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_case_number TEXT := COALESCE(NULLIF(TRIM(NEW.case_number::TEXT), ''), 'N/A');
  v_category TEXT;
  v_title TEXT;
  v_message TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_category := 'case_opened';
    v_title := 'Case Opened';
    v_message := 'Malanga Welfare: Case ' || v_case_number || ' has been opened.';
  ELSIF NEW.is_finalized IS TRUE AND COALESCE(OLD.is_finalized, FALSE) IS DISTINCT FROM TRUE THEN
    v_category := 'case_closed';
    v_title := 'Case Closed';
    v_message := 'Malanga Welfare: Case ' || v_case_number || ' has been closed. Thank you for your support.';
  ELSE
    RETURN NEW;
  END IF;

  IF NEW.affected_member_id IS NOT NULL THEN
    INSERT INTO public.notifications (member_id, role, title, message, category, data)
    VALUES (
      NEW.affected_member_id,
      'member',
      v_title,
      v_message,
      v_category,
      jsonb_build_object('source', 'case_lifecycle_trigger', 'case_id', NEW.id, 'case_number', v_case_number)
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_case_lifecycle ON public.cases;
CREATE TRIGGER trg_notify_case_lifecycle
  AFTER INSERT OR UPDATE OF is_finalized ON public.cases
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_case_lifecycle();
