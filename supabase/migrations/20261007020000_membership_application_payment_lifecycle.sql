-- Separate application payment codes from member numbers and make activation atomic.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS whatsapp_group_link TEXT;

ALTER TABLE public.membership_applications
  ADD COLUMN IF NOT EXISTS payment_code TEXT,
  ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_receipt TEXT,
  ADD COLUMN IF NOT EXISTS payment_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS payment_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS payment_metadata JSONB,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

UPDATE public.membership_applications
SET payment_code = payment_reference
WHERE payment_code IS NULL AND payment_reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_applications_payment_code
  ON public.membership_applications(payment_code)
  WHERE payment_code IS NOT NULL;

ALTER TABLE public.membership_applications
  DROP CONSTRAINT IF EXISTS membership_applications_status_check;

ALTER TABLE public.membership_applications
  ADD CONSTRAINT membership_applications_status_check
  CHECK (status IN ('pending_review', 'approved', 'rejected', 'payment_pending', 'activated', 'withdrawn', 'expired'));

-- One-week retention/expiry for applications that never complete the workflow.
CREATE OR REPLACE FUNCTION public.expire_membership_applications()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.membership_applications
  SET status = 'expired',
      expired_at = now(),
      updated_at = now()
  WHERE status IN ('payment_pending', 'rejected')
    AND (
      (status = 'payment_pending' AND payment_expires_at IS NOT NULL AND payment_expires_at <= now())
      OR
      (status = 'rejected' AND COALESCE(reviewed_at, updated_at, application_date) <= now() - interval '7 days')
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_membership_applications() TO service_role;

-- Locks allocation, verifies the application state, creates the member and ledger row,
-- and marks the application activated in one transaction.
CREATE OR REPLACE FUNCTION public.activate_membership_application(p_application_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_application public.membership_applications%ROWTYPE;
  v_settings public.settings%ROWTYPE;
  v_member_id UUID;
  v_member_number TEXT;
  v_registration_fee NUMERIC;
  v_start INTEGER;
BEGIN
  SELECT * INTO v_application
  FROM public.membership_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Application not found');
  END IF;

  IF v_application.status = 'activated' AND v_application.activated_member_id IS NOT NULL THEN
    SELECT member_number INTO v_member_number FROM public.members WHERE id = v_application.activated_member_id;
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'id', v_application.activated_member_id, 'member_number', v_member_number);
  END IF;

  IF v_application.status <> 'payment_pending' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Application is not awaiting payment');
  END IF;

  IF v_application.payment_status NOT IN ('received', 'verified') OR v_application.payment_receipt IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'A verified payment receipt is required before activation');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('malanga_member_number_allocator'));

  SELECT * INTO v_settings
  FROM public.settings
  ORDER BY id
  LIMIT 1;

  v_start := GREATEST(COALESCE(v_settings.member_id_start, 1), 1);
  SELECT GREATEST(
    v_start - 1,
    COALESCE(MAX(NULLIF(regexp_replace(member_number, '[^0-9]', '', 'g'), '')::BIGINT), v_start - 1)
  ) + 1
  INTO v_member_number
  FROM public.members;

  v_registration_fee := GREATEST(COALESCE(v_settings.registration_fee, 0), 0);

  INSERT INTO public.members (
    member_number, name, gender, date_of_birth, national_id_number,
    phone_number, email_address, residence, next_of_kin, dependants,
    wallet_balance, is_active, registration_date, pin_hash, status, probation_end_date
  ) VALUES (
    v_member_number, v_application.full_name, v_application.gender, v_application.date_of_birth,
    v_application.national_id_number, v_application.phone_number, v_application.email_address,
    CASE WHEN v_application.residence_status = 'resident' THEN v_application.village ELSE v_application.current_location END,
    v_application.next_of_kin, COALESCE(v_application.dependants, '[]'::jsonb),
    0, true, CURRENT_DATE, NULL, 'probation',
    CURRENT_DATE + CASE WHEN EXTRACT(YEAR FROM age(CURRENT_DATE, v_application.date_of_birth)) <= 50 THEN 90 ELSE 180 END
  ) RETURNING id INTO v_member_id;

  IF v_registration_fee > 0 THEN
    INSERT INTO public.transactions (
      member_id, amount, transaction_type, payment_method, status,
      mpesa_reference, reference, description, metadata
    ) VALUES (
      v_member_id, -v_registration_fee, 'registration', 'mpesa', 'completed',
      v_application.payment_receipt, v_application.payment_code,
      'Registration fee payment',
      jsonb_build_object(
        'source', 'membership_application',
        'application_id', v_application.id,
        'payment_code', v_application.payment_code,
        'payment_receipt', v_application.payment_receipt,
        'payment_amount', v_application.payment_amount
      )
    );
  END IF;

  UPDATE public.membership_applications
  SET status = 'activated',
      payment_status = 'verified',
      activated_member_id = v_member_id,
      activated_at = now(),
      updated_at = now()
  WHERE id = v_application.id;

  RETURN jsonb_build_object('success', true, 'id', v_member_id, 'member_number', v_member_number);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'message', 'A unique member or payment record already exists');
WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_membership_application(UUID) TO service_role;
