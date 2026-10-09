-- Make application review and payment-code allocation atomic.
-- A second concurrent approval must observe the first transaction's status
-- change and must never generate or send another payment code.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS event_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_event_key
  ON public.notifications(event_key)
  WHERE event_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.review_membership_application(
  p_application_id UUID,
  p_decision TEXT,
  p_reviewed_by UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_application public.membership_applications%ROWTYPE;
  v_payment_code TEXT;
  v_payment_expires_at TIMESTAMPTZ;
  v_decision TEXT := lower(trim(COALESCE(p_decision, '')));
  v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_updated INTEGER;
BEGIN
  IF v_decision NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid review decision');
  END IF;

  SELECT * INTO v_application
  FROM public.membership_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Application not found');
  END IF;

  IF v_application.status <> 'pending_review' THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_processed', true,
      'status', v_application.status,
      'message', 'Application has already been reviewed'
    );
  END IF;

  IF v_decision = 'approve' THEN
    FOR v_updated IN 1..10 LOOP
      v_payment_code := 'REG-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8));
      v_payment_expires_at := now() + interval '7 days';

      BEGIN
        UPDATE public.membership_applications
        SET status = 'payment_pending',
            payment_status = 'pending',
            payment_reference = NULL,
            payment_code = v_payment_code,
            payment_expires_at = v_payment_expires_at,
            reviewed_at = now(),
            reviewed_by = p_reviewed_by,
            review_reason = v_reason,
            updated_at = now()
        WHERE id = p_application_id
          AND status = 'pending_review';

        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated = 1 THEN
          RETURN jsonb_build_object(
            'success', true,
            'decision', 'approve',
            'application_id', p_application_id,
            'application_reference', v_application.application_reference,
            'full_name', v_application.full_name,
            'phone_number', v_application.phone_number,
            'payment_code', v_payment_code,
            'payment_expires_at', v_payment_expires_at,
            'status', 'payment_pending'
          );
        END IF;
      EXCEPTION WHEN unique_violation THEN
      END;
    END LOOP;

    RETURN jsonb_build_object('success', false, 'message', 'Could not allocate a unique payment code');
  END IF;

  UPDATE public.membership_applications
  SET status = 'rejected',
      payment_status = 'not_required',
      payment_reference = NULL,
      payment_code = NULL,
      payment_expires_at = NULL,
      reviewed_at = now(),
      reviewed_by = p_reviewed_by,
      review_reason = v_reason,
      updated_at = now()
  WHERE id = p_application_id
    AND status = 'pending_review';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RETURN jsonb_build_object('success', false, 'already_processed', true, 'message', 'Application has already been reviewed');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'decision', 'reject',
    'application_id', p_application_id,
    'application_reference', v_application.application_reference,
    'full_name', v_application.full_name,
    'phone_number', v_application.phone_number,
    'status', 'rejected'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_membership_application(UUID, TEXT, UUID, TEXT) TO service_role;
