-- Legacy application SMS rows were admin-only queue records. They have no
-- member phone and must not continue producing five-minute SMS_SKIPPED noise.
UPDATE public.notifications
SET sms_sent_at = COALESCE(sms_sent_at, now()),
    data = data || jsonb_build_object('sms_delivery_mode', 'legacy_retired')
WHERE role = 'admin'
  AND category IN ('registration_submitted', 'registration_approved', 'registration_rejected')
  AND event_key IS NULL
  AND sms_sent_at IS NULL;
