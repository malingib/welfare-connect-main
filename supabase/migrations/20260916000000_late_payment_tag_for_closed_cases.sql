-- Rename paid-after-close tag: arrears -> late_payment for case-linked payments.
--
-- Waterfall now emits transaction_type='late_payment' (instead of 'arrears')
-- when it settles a FINALIZED (closed) case. All case-payment read sets
-- (compliance, totals, defaulters, discipline, wallet effect, funding views)
-- accept both 'arrears' (legacy) and 'late_payment' so history keeps counting.
-- Case-linked legacy arrears rows are retagged below; manual-adjustment
-- arrears rows (case_id IS NULL) are left untouched.
--
-- New-member deductions on running cases already flow through the same
-- waterfall as case_wallet_deduction and are included in every total below.

-- ── transaction_wallet_effect ──
CREATE OR REPLACE FUNCTION public.transaction_wallet_effect(p_transaction_type text, p_amount numeric, p_status text DEFAULT 'completed'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  IF COALESCE(p_status, 'completed') <> 'completed' THEN
    RETURN 0;
  END IF;

  IF p_transaction_type = 'reversal_memo' THEN
    RETURN 0;
  END IF;

  IF p_transaction_type = 'contribution' THEN
    RETURN 0;
  END IF;

  -- Explicit wallet debits. wallet_manual_adjustment is a pure wallet correction
  -- (admin edit) - it reduces wallet_balance via -ABS(amount) but is deliberately
  -- NOT in the ('contribution','case_wallet_deduction','arrears','late_payment') case-payment sets.
  IF p_transaction_type IN ('registration', 'renewal', 'penalty', 'arrears', 'late_payment', 'case_wallet_deduction', 'wallet_manual_adjustment') THEN
    RETURN -ABS(COALESCE(p_amount, 0));
  END IF;

  -- Everything else credits wallet (e.g. wallet_funding, contribution_refund, disbursement).
  RETURN COALESCE(p_amount, 0);
END;
$function$;

-- ── apply_wallet_payment_waterfall ──
CREATE OR REPLACE FUNCTION public.apply_wallet_payment_waterfall(p_member_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member RECORD;
  v_case RECORD;
  v_case_paid NUMERIC := 0;
  v_case_remaining NUMERIC := 0;
  v_wallet NUMERIC := 0;
  v_penalty_required NUMERIC := 300;
  v_penalty_paid NUMERIC := 0;
  v_penalty_remaining NUMERIC := 0;
  v_payment NUMERIC := 0;
  v_inactivated_at TIMESTAMPTZ;
  v_open_cycle BOOLEAN := FALSE;
  v_case_unpaid BOOLEAN := FALSE;
  v_penalty_tx_count INT := 0;
  v_finalized_paid INT := 0;
  v_active_paid INT := 0;
  v_target_member_id UUID;
  v_probation_end DATE;
  v_guard_was_set BOOLEAN := FALSE;
BEGIN
  v_guard_was_set := COALESCE(current_setting('app.auto_wallet_reactivation', TRUE), 'false') = 'true';
  PERFORM set_config('app.auto_wallet_reactivation', 'true', true);

  SELECT id, status, is_active
    INTO v_member
  FROM public.members
  WHERE id = p_member_id
  FOR UPDATE;

  IF NOT FOUND OR v_member.status = 'deceased' THEN
    PERFORM set_config('app.auto_wallet_reactivation', v_guard_was_set::TEXT, true);
    RETURN jsonb_build_object('success', TRUE, 'skipped', 'member_not_payable');
  END IF;

  IF v_member.status = 'inactive' THEN
    SELECT t.created_at
      INTO v_inactivated_at
    FROM public.member_status_transitions t
    WHERE t.member_id = p_member_id
      AND t.reason = 'auto_inactive_two_consecutive_defaults'
      AND NOT EXISTS (
        SELECT 1
        FROM public.member_status_transitions later
        WHERE later.member_id = p_member_id
          AND later.reason = 'auto_wallet_reactivation'
          AND later.created_at > t.created_at
      )
    ORDER BY t.created_at DESC
    LIMIT 1;

    v_open_cycle := v_inactivated_at IS NOT NULL;

    IF v_open_cycle THEN
      SELECT COALESCE(SUM(ABS(t.amount)), 0)
        INTO v_penalty_paid
      FROM public.transactions t
      WHERE t.member_id = p_member_id
        AND t.transaction_type = 'penalty'
        AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success')
        AND COALESCE(t.metadata->>'source', '') IN ('auto_reinstatement_penalty', 'api_collect_fee')
        AND t.created_at >= v_inactivated_at;

      v_penalty_remaining := GREATEST(v_penalty_required - v_penalty_paid, 0);
    END IF;
  END IF;

  -- Cases-first: pay complete oldest obligations only. If the next case
  -- cannot be fully paid, remember that and block the penalty stage below.
  FOR v_case IN
    SELECT c.id,
           c.case_number,
           c.is_finalized,
           COALESCE(c.contribution_per_member, 0) AS required_amount
    FROM public.cases c
    WHERE (c.is_active = TRUE OR c.is_finalized = TRUE)
      AND public.member_case_obligation_applies(p_member_id, c.id)
    ORDER BY
      CASE WHEN c.is_finalized THEN 0 ELSE 1 END,
      COALESCE(c.end_date, c.start_date, c.created_at::DATE),
      c.created_at,
      c.id
  LOOP
    SELECT COALESCE(SUM(
      CASE
        WHEN t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment') THEN ABS(t.amount)
        WHEN t.transaction_type IN ('contribution_refund', 'case_wallet_refund') THEN -ABS(t.amount)
        ELSE 0
      END
    ), 0)
      INTO v_case_paid
    FROM public.transactions t
    WHERE t.member_id = p_member_id
      AND t.case_id = v_case.id
      AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success');

    v_case_remaining := GREATEST(v_case.required_amount - v_case_paid, 0);
    IF v_case_remaining <= 0 THEN
      CONTINUE;
    END IF;

    v_wallet := public.calculate_wallet_balance(p_member_id);
    IF v_wallet < v_case_remaining THEN
      v_case_unpaid := TRUE;
      EXIT;
    END IF;

    IF COALESCE(v_case.is_finalized, FALSE) THEN
      INSERT INTO public.transactions (
        member_id, case_id, amount, transaction_type, payment_method, status,
        created_at, description, metadata
      ) VALUES (
        p_member_id, v_case.id, v_case_remaining, 'late_payment', 'wallet', 'completed',
        clock_timestamp(),
        'Late payment for closed case #' || v_case.case_number,
        jsonb_build_object('source', 'auto_wallet_payment_waterfall', 'priority', 'finalized_case')
      );
      v_finalized_paid := v_finalized_paid + 1;
    ELSE
      INSERT INTO public.transactions (
        member_id, case_id, amount, transaction_type, payment_method, status,
        created_at, description, metadata
      ) VALUES (
        p_member_id, v_case.id, v_case_remaining, 'case_wallet_deduction', 'wallet', 'completed',
        clock_timestamp(),
        'Automatic active-case payment for case #' || v_case.case_number,
        jsonb_build_object('source', 'auto_wallet_payment_waterfall', 'priority', 'active_case')
      );
      v_active_paid := v_active_paid + 1;
    END IF;
  END LOOP;

  -- Penalty is only eligible after every payable case has been settled.
  IF v_member.status = 'inactive'
     AND v_open_cycle
     AND NOT v_case_unpaid
     AND v_penalty_remaining > 0 THEN
    v_wallet := public.calculate_wallet_balance(p_member_id);

    IF v_wallet > 0 THEN
      v_payment := LEAST(v_wallet, v_penalty_remaining);
      INSERT INTO public.transactions (
        member_id, amount, transaction_type, payment_method, status,
        created_at, description, reference, metadata
      ) VALUES (
        p_member_id, v_payment, 'penalty', 'wallet', 'completed',
        clock_timestamp(),
        'Automatic reinstatement penalty payment',
        'auto_reinstatement_penalty:' || p_member_id::TEXT || ':' || EXTRACT(EPOCH FROM clock_timestamp())::BIGINT,
        jsonb_build_object(
          'source', 'auto_reinstatement_penalty',
          'inactivation_at', v_inactivated_at,
          'required_amount', v_penalty_required,
          'partial_payment', v_payment < v_penalty_remaining
        )
      );
      v_penalty_tx_count := 1;
      v_penalty_paid := v_penalty_paid + v_payment;
      v_penalty_remaining := GREATEST(v_penalty_required - v_penalty_paid, 0);
    END IF;

    IF v_penalty_remaining <= 0 THEN
      v_probation_end := (CURRENT_DATE + INTERVAL '90 days')::DATE;
      UPDATE public.members
      SET status = 'probation', is_active = TRUE,
          probation_end_date = v_probation_end, updated_at = now()
      WHERE id = p_member_id;

      INSERT INTO public.member_status_transitions (
        member_id, from_status, to_status, from_is_active, to_is_active,
        reason, details, performed_by_role
      ) VALUES (
        p_member_id, 'inactive', 'probation', v_member.is_active, TRUE,
        'auto_wallet_reactivation',
        jsonb_build_object(
          'inactivation_at', v_inactivated_at,
          'penalty_required', v_penalty_required,
          'penalty_paid', v_penalty_paid,
          'probation_end_date', v_probation_end
        ),
        'system'
      );

      INSERT INTO public.member_default_streaks (
        member_id, current_streak, last_case_id, last_defaulted, updated_at
      ) VALUES (p_member_id, 0, NULL, FALSE, now())
      ON CONFLICT (member_id) DO UPDATE SET
        current_streak = 0, last_defaulted = FALSE, updated_at = now();

      v_target_member_id := p_member_id;
    END IF;
  END IF;

  PERFORM set_config('app.auto_wallet_reactivation', v_guard_was_set::TEXT, true);

  RETURN jsonb_build_object(
    'success', TRUE,
    'penalty_payments', v_penalty_tx_count,
    'finalized_cases_paid', v_finalized_paid,
    'active_cases_paid', v_active_paid,
    'flipped_to', CASE WHEN v_target_member_id IS NOT NULL THEN 'probation' ELSE NULL END,
    'wallet_balance', public.calculate_wallet_balance(p_member_id)
  );
END;
$function$;

-- ── sync_case_actual_amount ──
CREATE OR REPLACE FUNCTION public.sync_case_actual_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_case_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_case_id := OLD.case_id;
  ELSE
    v_case_id := NEW.case_id;
  END IF;

  IF v_case_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  UPDATE public.cases c
  SET actual_amount = (
    SELECT COALESCE(SUM(
      CASE
        WHEN t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment')
          THEN ABS(COALESCE(t.amount, 0))
        WHEN t.transaction_type IN ('contribution_refund', 'case_wallet_refund')
          THEN -ABS(COALESCE(t.amount, 0))
        ELSE 0
      END
    ), 0)::NUMERIC
    FROM public.transactions t
    WHERE t.case_id = v_case_id
      AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success')
  )
  WHERE c.id = v_case_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

-- ── record_case_defaulters_on_finalize ──
CREATE OR REPLACE FUNCTION public.record_case_defaulters_on_finalize()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.is_finalized IS TRUE AND COALESCE(OLD.is_finalized, FALSE) IS DISTINCT FROM TRUE THEN
    INSERT INTO case_defaulters (case_id, member_id)
    SELECT NEW.id, m.id
    FROM members m
    WHERE m.is_active = TRUE
      AND m.status IN ('active', 'probation')
      AND public.member_case_obligation_applies(m.id, NEW.id)
      AND NOT EXISTS (
        SELECT 1
        FROM transactions t
        WHERE t.member_id = m.id
          AND t.case_id = NEW.id
          AND t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment')
          AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success')
      )
    ON CONFLICT (case_id, member_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── admin_record_case_payment ──
CREATE OR REPLACE FUNCTION public.admin_record_case_payment(p_admin_id uuid, p_member_id uuid, p_case_id uuid, p_amount numeric, p_transaction_type text DEFAULT 'case_wallet_deduction'::text, p_description text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_case RECORD;
  v_existing_net NUMERIC;
  v_required NUMERIC;
  v_description TEXT;
  v_tx_id UUID;
BEGIN
  SELECT id, case_number, contribution_per_member, is_active, is_finalized
  INTO v_case
  FROM public.cases
  WHERE id = p_case_id
    AND (is_active = TRUE OR is_finalized = TRUE);

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Case not found or not payable (must be active or finalized)'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.members WHERE id = p_member_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Member not found');
  END IF;

  IF NOT public.member_case_obligation_applies(p_member_id, p_case_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Case #' || v_case.case_number || ' closed before this member was registered'
    );
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Amount must be positive');
  END IF;

  IF p_transaction_type NOT IN ('case_wallet_deduction', 'contribution', 'arrears', 'late_payment') THEN
    RETURN jsonb_build_object('success', false, 'message',
      'transaction_type must be case_wallet_deduction, contribution, arrears, or late_payment'
    );
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment')
        THEN ABS(COALESCE(t.amount, 0))
      WHEN t.transaction_type IN ('contribution_refund', 'case_wallet_refund')
        THEN -ABS(COALESCE(t.amount, 0))
      ELSE 0
    END
  ), 0) INTO v_existing_net
  FROM public.transactions t
  WHERE t.member_id = p_member_id
    AND t.case_id = p_case_id
    AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success');

  v_required := COALESCE(v_case.contribution_per_member, 0);

  IF v_required > 0 AND v_existing_net >= v_required THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Case #' || v_case.case_number || ' is already fully paid (net: ' || v_existing_net || ', required: ' || v_required || ')'
    );
  END IF;

  v_description := COALESCE(
    p_description,
    'Admin case payment for case #' || v_case.case_number || ' (' || p_transaction_type || ')'
  );

  INSERT INTO public.transactions (
    member_id,
    case_id,
    amount,
    transaction_type,
    status,
    description,
    metadata
  ) VALUES (
    p_member_id,
    p_case_id,
    p_amount,
    p_transaction_type,
    'completed',
    v_description,
    jsonb_build_object(
      'source', 'admin_manual_payment',
      'admin_id', p_admin_id,
      'case_number', v_case.case_number
    )
  )
  RETURNING id INTO v_tx_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, metadata)
  VALUES (
    p_admin_id,
    'INSERT',
    'transactions',
    v_tx_id,
    jsonb_build_object(
      'action', 'admin_record_case_payment',
      'member_id', p_member_id,
      'case_id', p_case_id,
      'case_number', v_case.case_number,
      'amount', p_amount,
      'transaction_type', p_transaction_type,
      'existing_net_paid', v_existing_net,
      'required_amount', v_required,
      'is_finalized', v_case.is_finalized
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Payment recorded for case #' || v_case.case_number,
    'transaction_id', v_tx_id,
    'amount', p_amount,
    'case_number', v_case.case_number,
    'existing_net_paid', v_existing_net,
    'new_net_paid', v_existing_net + p_amount,
    'required_amount', v_required
  );
END;
$function$;

-- ── apply_member_discipline_on_case_finalize ──
CREATE OR REPLACE FUNCTION public.apply_member_discipline_on_case_finalize()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  m RECORD;
  v_defaulted BOOLEAN;
  v_streak INT;
  v_paid NUMERIC;
BEGIN
  IF NEW.is_finalized IS TRUE AND COALESCE(OLD.is_finalized, FALSE) IS DISTINCT FROM TRUE THEN
    FOR m IN
      SELECT id, status, is_active
      FROM public.members
      WHERE status <> 'deceased'
        AND public.member_case_obligation_applies(id, NEW.id)
    LOOP
      SELECT COALESCE(SUM(CASE
          WHEN t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment') THEN ABS(COALESCE(t.amount, 0))
          WHEN t.transaction_type IN ('contribution_refund', 'case_wallet_refund') THEN -ABS(COALESCE(t.amount, 0))
          ELSE 0 END)::NUMERIC, 0)
      INTO v_paid
      FROM public.transactions t
      WHERE t.member_id = m.id
        AND t.case_id = NEW.id
        AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success');

      v_defaulted := v_paid < COALESCE(NEW.contribution_per_member, 0) - 0.009;

      -- Skip members in an open (recently restored) auto-inactive cycle so we
      -- do not override a pending correction / reinstatement.
      IF public.member_has_open_auto_inactive_cycle(m.id) THEN
        CONTINUE;
      END IF;

      v_streak := public.get_max_consecutive_unpaid_cases(m.id);

      INSERT INTO public.member_default_streaks (member_id, current_streak, last_case_id, last_defaulted, updated_at)
      VALUES (m.id, v_streak, NEW.id, v_defaulted, now())
      ON CONFLICT (member_id)
      DO UPDATE SET
        current_streak = EXCLUDED.current_streak,
        last_case_id = EXCLUDED.last_case_id,
        last_defaulted = EXCLUDED.last_defaulted,
        updated_at = now();

      IF v_streak >= 2 AND m.status IN ('active', 'probation') THEN
        UPDATE public.members
        SET status = 'inactive',
            is_active = FALSE,
            updated_at = now()
        WHERE id = m.id;

        INSERT INTO public.member_status_transitions (
          member_id, from_status, to_status, from_is_active, to_is_active,
          reason, details, performed_by_role
        ) VALUES (
          m.id, m.status, 'inactive', m.is_active, FALSE,
          'auto_inactive_two_consecutive_defaults',
          jsonb_build_object(
            'case_id', NEW.id,
            'case_number', NEW.case_number,
            'streak', v_streak,
            'source', 'consecutive_unpaid_rule'
          ),
          'system'
        );
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── get_case_payment_compliance_rows ──
CREATE OR REPLACE FUNCTION public.get_case_payment_compliance_rows()
 RETURNS TABLE(case_id uuid, case_number text, case_type text, case_status text, member_id uuid, member_number text, member_name text, member_status text, expected_amount numeric, gross_paid numeric, total_refunded numeric, net_paid numeric, outstanding_amount numeric, payment_compliance text)
 LANGUAGE sql
 STABLE
AS $function$
WITH eligible_members AS (
  SELECT
    m.id AS member_id,
    m.member_number,
    m.name,
    m.status AS member_status
  FROM public.members m
  WHERE m.status IN ('active', 'probation')
),
eligible_cases AS (
  SELECT
    c.id AS case_id,
    c.case_number,
    c.case_type,
    COALESCE(c.contribution_per_member, 0)::numeric(15,2) AS expected_amount,
    c.is_active,
    c.is_finalized
  FROM public.cases c
  WHERE c.is_active = true OR c.is_finalized = true
),
net_payments AS (
  SELECT
    t.member_id,
    t.case_id,
    SUM(CASE
      WHEN t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment') THEN ABS(COALESCE(t.amount, 0))
      WHEN t.transaction_type IN ('contribution_refund', 'case_wallet_refund') THEN -ABS(COALESCE(t.amount, 0))
      ELSE 0
    END)::numeric(15,2) AS net_paid,
    SUM(CASE
      WHEN t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment') THEN ABS(COALESCE(t.amount, 0))
      ELSE 0
    END)::numeric(15,2) AS gross_paid,
    SUM(CASE
      WHEN t.transaction_type IN ('contribution_refund', 'case_wallet_refund') THEN ABS(COALESCE(t.amount, 0))
      ELSE 0
    END)::numeric(15,2) AS total_refunded
  FROM public.transactions t
  WHERE COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success')
    AND t.member_id IS NOT NULL
    AND t.case_id IS NOT NULL
    AND t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment', 'contribution_refund', 'case_wallet_refund')
  GROUP BY t.member_id, t.case_id
)
SELECT
  c.case_id,
  c.case_number::text,
  c.case_type::text,
  CASE
    WHEN c.is_finalized THEN 'finalized'
    WHEN c.is_active THEN 'active'
    ELSE 'closed'
  END::text AS case_status,
  m.member_id,
  m.member_number::text,
  m.name::text AS member_name,
  m.member_status::text,
  c.expected_amount::numeric,
  COALESCE(p.gross_paid, 0)::numeric AS gross_paid,
  COALESCE(p.total_refunded, 0)::numeric AS total_refunded,
  COALESCE(p.net_paid, 0)::numeric AS net_paid,
  GREATEST(c.expected_amount - COALESCE(p.net_paid, 0), 0)::numeric AS outstanding_amount,
  CASE
    WHEN COALESCE(p.net_paid, 0) >= c.expected_amount THEN 'paid'
    WHEN COALESCE(p.net_paid, 0) > 0 THEN 'partial'
    ELSE 'unpaid'
  END::text AS payment_compliance
FROM eligible_cases c
CROSS JOIN eligible_members m
LEFT JOIN net_payments p
  ON p.case_id = c.case_id
 AND p.member_id = m.member_id
WHERE public.member_case_obligation_applies(m.member_id, c.case_id)
ORDER BY c.case_number DESC, m.member_number;
$function$;

-- ── get_case_payment_compliance_rows_for_case ──
CREATE OR REPLACE FUNCTION public.get_case_payment_compliance_rows_for_case(p_case_id uuid)
 RETURNS TABLE(case_id uuid, case_number text, case_type text, case_status text, member_id uuid, member_number text, member_name text, member_status text, phone_number text, expected_amount numeric, gross_paid numeric, total_refunded numeric, net_paid numeric, outstanding_amount numeric, reinstatement_penalty_due numeric, total_due numeric, payment_compliance text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  WITH eligible_case AS (
    SELECT c.id AS case_id, c.case_number, c.case_type,
      COALESCE(c.contribution_per_member, 0)::numeric(15,2) AS expected_amount,
      c.is_active, c.is_finalized
    FROM public.cases c
    WHERE c.id = p_case_id AND (c.is_active = TRUE OR c.is_finalized = TRUE)
  ),
  member_inactivation AS (
    SELECT
      m.id AS member_id,
      m.member_number,
      m.name,
      m.status AS member_status,
      m.phone_number,
      latest_transition.created_at AS auto_inactivated_at
    FROM public.members m
    LEFT JOIN LATERAL (
      SELECT st.created_at
      FROM public.member_status_transitions st
      WHERE st.member_id = m.id
        AND st.to_status = 'inactive'
        AND st.reason = 'auto_inactive_two_consecutive_defaults'
      ORDER BY st.created_at DESC
      LIMIT 1
    ) latest_transition ON TRUE
    WHERE m.status IN ('active', 'probation')
       OR (m.status = 'inactive' AND latest_transition.created_at IS NOT NULL)
  ),
  penalty_balances AS (
    SELECT
      m.member_id,
      CASE
        WHEN m.member_status = 'inactive' AND m.auto_inactivated_at IS NOT NULL THEN
          GREATEST(300 - COALESCE((
            SELECT SUM(ABS(t.amount))
            FROM public.transactions t
            WHERE t.member_id = m.member_id
              AND t.transaction_type = 'penalty'
              AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success')
              AND t.created_at >= m.auto_inactivated_at
              AND COALESCE(t.metadata->>'source', '') IN ('auto_reinstatement_penalty', 'api_collect_fee')
          ), 0), 0)::numeric
        ELSE 0::numeric
      END AS reinstatement_penalty_due
    FROM member_inactivation m
  ),
  net_payments AS (
    SELECT t.member_id, t.case_id,
      SUM(CASE
        WHEN t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment') THEN ABS(COALESCE(t.amount, 0))
        WHEN t.transaction_type IN ('contribution_refund', 'case_wallet_refund') THEN -ABS(COALESCE(t.amount, 0))
        ELSE 0 END)::numeric(15,2) AS net_paid,
      SUM(CASE WHEN t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment') THEN ABS(COALESCE(t.amount, 0)) ELSE 0 END)::numeric(15,2) AS gross_paid,
      SUM(CASE WHEN t.transaction_type IN ('contribution_refund', 'case_wallet_refund') THEN ABS(COALESCE(t.amount, 0)) ELSE 0 END)::numeric(15,2) AS total_refunded
    FROM public.transactions t
    WHERE t.case_id = p_case_id
      AND t.member_id IS NOT NULL
      AND t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment', 'contribution_refund', 'case_wallet_refund')
      AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success')
    GROUP BY t.member_id, t.case_id
  )
  SELECT
    c.case_id, c.case_number::text, c.case_type::text,
    CASE WHEN c.is_finalized THEN 'finalized' WHEN c.is_active THEN 'active' ELSE 'closed' END::text,
    m.member_id, m.member_number::text, m.name::text, m.member_status::text, m.phone_number::text,
    c.expected_amount::numeric,
    COALESCE(p.gross_paid, 0)::numeric,
    COALESCE(p.total_refunded, 0)::numeric,
    COALESCE(p.net_paid, 0)::numeric,
    GREATEST(c.expected_amount - COALESCE(p.net_paid, 0), 0)::numeric AS outstanding_amount,
    COALESCE(pb.reinstatement_penalty_due, 0)::numeric AS reinstatement_penalty_due,
    (GREATEST(c.expected_amount - COALESCE(p.net_paid, 0), 0) + COALESCE(pb.reinstatement_penalty_due, 0))::numeric AS total_due,
    CASE
      WHEN COALESCE(p.net_paid, 0) >= c.expected_amount THEN 'paid'
      WHEN COALESCE(p.net_paid, 0) > 0 THEN 'partial'
      ELSE 'unpaid'
    END::text
  FROM eligible_case c
  CROSS JOIN member_inactivation m
  LEFT JOIN penalty_balances pb ON pb.member_id = m.member_id
  LEFT JOIN net_payments p ON p.case_id = c.case_id AND p.member_id = m.member_id
  WHERE public.member_case_obligation_applies(m.member_id, c.case_id)
  ORDER BY m.member_number, m.name;
END;
$function$;

-- ── get_dashboard_summary ──
CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
 RETURNS TABLE(total_members integer, active_members integer, defaulters_count integer, total_wallet_balance numeric, active_cases integer, total_contributions numeric)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::INT                                                           AS total_members,
        COUNT(*) FILTER (WHERE m.is_active = true)::INT                        AS active_members,
        COUNT(*) FILTER (WHERE m.wallet_balance < 0)::INT                      AS defaulters_count,
        COALESCE(SUM(m.wallet_balance), 0)::NUMERIC                            AS total_wallet_balance,
        (SELECT COUNT(*)::INT FROM cases WHERE is_active = true)               AS active_cases,
        (SELECT COALESCE(SUM(ABS(t.amount)), 0)::NUMERIC
           FROM transactions t
          WHERE t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment')
            AND COALESCE(t.status, 'completed') = 'completed')                 AS total_contributions
    FROM members m;
END;
$function$;

-- ── get_late_payment_aggregate ──
CREATE OR REPLACE FUNCTION public.get_late_payment_aggregate(p_from_date timestamp with time zone)
 RETURNS TABLE(late_payment_count bigint, late_payment_total numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
  select
    count(*)::bigint as late_payment_count,
    coalesce(sum(abs(coalesce(t.amount, 0))), 0)::numeric as late_payment_total
  from public.transactions t
  where t.transaction_type in ('arrears', 'late_payment')
    and t.created_at >= p_from_date
    and lower(coalesce(t.status, '')) in ('completed', 'success');
$function$;

-- ── get_max_consecutive_unpaid_cases ──
CREATE OR REPLACE FUNCTION public.get_max_consecutive_unpaid_cases(p_member_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_case RECORD;
  v_paid NUMERIC;
  v_reactivated_at TIMESTAMPTZ;
  v_current_run INT := 0;
  v_max_run INT := 0;
BEGIN
  -- Pre-reactivation cases were settled by the reinstatement penalty.
  SELECT MAX(t.created_at)
    INTO v_reactivated_at
  FROM public.member_status_transitions t
  WHERE t.member_id = p_member_id
    AND t.reason = 'auto_wallet_reactivation';

  FOR v_case IN
    SELECT c.id, COALESCE(c.contribution_per_member, 0) AS required_amount
    FROM public.cases c
    WHERE c.is_finalized = TRUE
      AND public.member_case_obligation_applies(p_member_id, c.id)
      AND (v_reactivated_at IS NULL OR c.created_at > v_reactivated_at)
    ORDER BY c.created_at, c.id
  LOOP
    SELECT COALESCE(SUM(CASE
        WHEN t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment') THEN ABS(COALESCE(t.amount, 0))
        WHEN t.transaction_type IN ('contribution_refund', 'case_wallet_refund') THEN -ABS(COALESCE(t.amount, 0))
        ELSE 0 END)::NUMERIC, 0)
    INTO v_paid
    FROM public.transactions t
    WHERE t.member_id = p_member_id
      AND t.case_id = v_case.id
      AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success');

    IF v_paid >= v_case.required_amount - 0.009 THEN
      v_current_run := 0;          -- fully paid case breaks the run
    ELSE
      v_current_run := v_current_run + 1;
      IF v_current_run > v_max_run THEN
        v_max_run := v_current_run;
      END IF;
    END IF;
  END LOOP;

  RETURN v_max_run;
END;
$function$;

-- ── get_member_finalized_unpaid_case_count ──
CREATE OR REPLACE FUNCTION public.get_member_finalized_unpaid_case_count(p_member_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_count INT := 0;
BEGIN
  SELECT COUNT(*)::INT
  INTO v_count
  FROM public.cases c
  WHERE (c.is_active = TRUE OR c.is_finalized = TRUE)
    AND public.member_case_obligation_applies(p_member_id, c.id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.transactions t
      WHERE t.member_id = p_member_id
        AND t.case_id = c.id
        AND t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment')
        AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success')
    );

  RETURN COALESCE(v_count, 0);
END;
$function$;

-- ── get_member_total_due ──
CREATE OR REPLACE FUNCTION public.get_member_total_due(p_member_id uuid)
 RETURNS TABLE(unpaid_case_count integer, unpaid_case_total numeric, reinstatement_penalty_due numeric, total_due numeric, case_details jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_status TEXT;
  v_auto_inactivated_at TIMESTAMPTZ;
  v_penalty_paid NUMERIC;
  v_case_count INT := 0;
  v_case_total NUMERIC := 0;
  v_penalty_due NUMERIC := 0;
  v_case_details JSONB;
BEGIN
  SELECT m.status INTO v_status
  FROM public.members m
  WHERE m.id = p_member_id;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT 0::INT, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, '[]'::JSONB;
    RETURN;
  END IF;

  -- Case obligations: active/finalized cases with outstanding balance > 0.009
  WITH outstanding AS (
    SELECT
      c.id AS case_id,
      c.case_number,
      COALESCE(c.contribution_per_member, 0)::NUMERIC AS expected_amount,
      CASE WHEN c.is_finalized THEN 'closed' WHEN c.is_active THEN 'active' ELSE 'other' END::TEXT AS case_status,
      COALESCE(c.end_date, c.start_date, c.created_at::DATE) AS case_date,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN t2.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment') THEN ABS(COALESCE(t2.amount, 0))
            WHEN t2.transaction_type IN ('contribution_refund', 'case_wallet_refund') THEN -ABS(COALESCE(t2.amount, 0))
            ELSE 0
          END
        )::NUMERIC
        FROM public.transactions t2
        WHERE t2.member_id = p_member_id
          AND t2.case_id = c.id
          AND t2.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment', 'contribution_refund', 'case_wallet_refund')
          AND COALESCE(LOWER(t2.status), 'completed') IN ('completed', 'success')
      ), 0) AS net_paid
    FROM public.cases c
    WHERE (c.is_active = TRUE OR c.is_finalized = TRUE)
      AND public.member_case_obligation_applies(p_member_id, c.id)
  )
  SELECT
    COUNT(*)::INT,
    COALESCE(SUM(GREATEST(expected_amount - net_paid, 0)), 0)::NUMERIC,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'case_id', case_id,
        'case_number', case_number,
        'contribution_per_member', expected_amount,
        'case_status', case_status,
        'case_date', case_date
      )
      ORDER BY case_date DESC, case_number
    ) FILTER (WHERE expected_amount - net_paid > 0.009), '[]'::JSONB)
  INTO v_case_count, v_case_total, v_case_details
  FROM outstanding
  WHERE expected_amount - net_paid > 0.009;

  -- Penalty for inactive members, anchored at the latest inactivation
  -- regardless of reason (auto or manual).
  IF v_status = 'inactive' THEN
    SELECT st.created_at INTO v_auto_inactivated_at
    FROM public.member_status_transitions st
    WHERE st.member_id = p_member_id
      AND st.to_status = 'inactive'
    ORDER BY st.created_at DESC
    LIMIT 1;

    IF v_auto_inactivated_at IS NOT NULL THEN
      SELECT COALESCE(SUM(ABS(t.amount)), 0) INTO v_penalty_paid
      FROM public.transactions t
      WHERE t.member_id = p_member_id
        AND t.transaction_type = 'penalty'
        AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success')
        AND t.created_at >= v_auto_inactivated_at
        AND COALESCE(t.metadata->>'source', '') = 'auto_reinstatement_penalty';

      v_penalty_due := GREATEST(300 - v_penalty_paid, 0);
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    v_case_count,
    v_case_total,
    v_penalty_due,
    (v_case_total + v_penalty_due)::NUMERIC,
    v_case_details;
END;
$function$;

-- ── get_member_unpaid_case_obligations ──
CREATE OR REPLACE FUNCTION public.get_member_unpaid_case_obligations(p_member_id uuid)
 RETURNS TABLE(case_id uuid, case_number text, contribution_per_member numeric, case_status text, case_date date)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.case_number,
    COALESCE(c.contribution_per_member, 0)::NUMERIC,
    CASE
      WHEN c.is_finalized THEN 'closed'
      WHEN c.is_active THEN 'active'
      ELSE 'other'
    END::TEXT,
    COALESCE(c.end_date, c.start_date)
  FROM public.cases c
  WHERE (c.is_active = TRUE OR c.is_finalized = TRUE)
    AND public.member_case_obligation_applies(p_member_id, c.id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.transactions t
      WHERE t.member_id = p_member_id
        AND t.case_id = c.id
        AND t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment')
        AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success')
    )
  ORDER BY COALESCE(c.end_date, c.start_date, CURRENT_DATE) DESC, c.created_at DESC;
END;
$function$;

-- ── get_members_bulk_unpaid_totals ──
CREATE OR REPLACE FUNCTION public.get_members_bulk_unpaid_totals(p_member_ids uuid[])
 RETURNS TABLE(member_id uuid, unpaid_case_count bigint, unpaid_case_total numeric, reinstatement_penalty_due numeric, total_due numeric, case_details jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_ids ALIAS FOR p_member_ids;
BEGIN
  RETURN QUERY
  WITH
  member_cases AS (
    SELECT m.id AS mid, c.id AS cid,
           COALESCE(c.contribution_per_member, 0) AS contribution,
           c.case_number,
           CASE WHEN c.is_finalized THEN 'closed' WHEN c.is_active THEN 'active' ELSE 'other' END AS case_status,
           COALESCE(c.end_date, c.start_date, c.created_at::DATE) AS case_date
    FROM public.members m
    JOIN public.cases c ON (c.is_active OR c.is_finalized)
      AND public.member_case_obligation_applies(m.id, c.id)
    WHERE m.id = ANY(v_member_ids)
  ),
  member_payments AS (
    SELECT t.member_id AS mid, t.case_id AS cid,
      SUM(
        CASE
          WHEN t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment') THEN ABS(t.amount)
          WHEN t.transaction_type IN ('contribution_refund', 'case_wallet_refund') THEN -ABS(t.amount)
          ELSE 0
        END
      )::NUMERIC AS net_paid
    FROM public.transactions t
    WHERE t.member_id = ANY(v_member_ids)
      AND t.case_id IS NOT NULL
      AND t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment', 'contribution_refund', 'case_wallet_refund')
      AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success')
    GROUP BY t.member_id, t.case_id
  ),
  outstanding AS (
    SELECT
      mc.mid, mc.cid, mc.contribution, mc.case_number,
      mc.case_status, mc.case_date,
      GREATEST(mc.contribution - COALESCE(mp.net_paid, 0), 0) AS remaining
    FROM member_cases mc
    LEFT JOIN member_payments mp ON mp.mid = mc.mid AND mp.cid = mc.cid
  ),
  member_totals AS (
    SELECT
      o.mid,
      COUNT(*)::BIGINT AS unpaid_case_count,
      SUM(o.remaining)::NUMERIC AS unpaid_case_total,
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'case_id', o.cid,
          'case_number', o.case_number,
          'contribution_per_member', o.contribution,
          'case_status', o.case_status,
          'case_date', o.case_date
        )
        ORDER BY o.case_date DESC, o.case_number
      ) FILTER (WHERE o.remaining > 0.009) AS case_details
    FROM outstanding o
    WHERE o.remaining > 0.009
    GROUP BY o.mid
  ),
  inactive_members AS (
    SELECT m.id AS mid
    FROM public.members m
    WHERE m.id = ANY(v_member_ids) AND m.status = 'inactive'
  ),
  member_penalties AS (
    SELECT im.mid,
      COALESCE((
        SELECT SUM(ABS(t.amount))::NUMERIC
        FROM public.transactions t
        WHERE t.member_id = im.mid
          AND t.transaction_type = 'penalty'
          AND t.created_at >= COALESCE(
            (SELECT st.created_at
             FROM public.member_status_transitions st
             WHERE st.member_id = im.mid AND st.to_status = 'inactive'
             ORDER BY st.created_at DESC LIMIT 1),
            '1970-01-01'::TIMESTAMPTZ
          )
          AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success')
          AND COALESCE(t.metadata->>'source', '') = 'auto_reinstatement_penalty'
      ), 0) AS penalty_paid
    FROM inactive_members im
  )
  SELECT
    u.mid,
    COALESCE(mt.unpaid_case_count, 0),
    COALESCE(mt.unpaid_case_total, 0),
    COALESCE(GREATEST(300 - mp.penalty_paid, 0), 0),
    COALESCE(mt.unpaid_case_total, 0) + COALESCE(GREATEST(300 - mp.penalty_paid, 0), 0),
    COALESCE(mt.case_details, '[]'::JSONB)
  FROM UNNEST(v_member_ids) u(mid)
  LEFT JOIN member_totals mt ON mt.mid = u.mid
  LEFT JOIN member_penalties mp ON mp.mid = u.mid;
END;
$function$;

-- ── get_members_total_due_light ──
CREATE OR REPLACE FUNCTION public.get_members_total_due_light(p_member_ids uuid[])
 RETURNS TABLE(member_id uuid, total_due numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_ids ALIAS FOR p_member_ids;
BEGIN
  RETURN QUERY
  WITH
  -- All (member, case) pairs the member is obligated to, with the case's required amount.
  -- Inlines the member_case_obligation_applies logic as join predicates.
  member_cases AS (
    SELECT m.id AS mid,
           c.id AS cid,
           COALESCE(c.contribution_per_member, 0) AS contribution
    FROM public.members m
    JOIN public.cases c
      ON (c.is_active = TRUE OR c.is_finalized = TRUE)
     -- case effective start date >= member registration date
     AND COALESCE(c.start_date, c.created_at::DATE) >= COALESCE(m.registration_date, m.created_at::DATE, CURRENT_DATE)
    WHERE m.id = ANY(v_member_ids)
  ),
  -- Net paid per (member, case) pair across all relevant transaction types.
  member_payments AS (
    SELECT t.member_id AS mid,
           t.case_id AS cid,
           SUM(
             CASE
               WHEN t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment') THEN ABS(t.amount)
               WHEN t.transaction_type IN ('contribution_refund', 'case_wallet_refund') THEN -ABS(t.amount)
               ELSE 0
             END
           )::NUMERIC AS net_paid
    FROM public.transactions t
    WHERE t.member_id = ANY(v_member_ids)
      AND t.case_id IS NOT NULL
      AND t.transaction_type IN ('contribution', 'case_wallet_deduction', 'arrears', 'late_payment', 'contribution_refund', 'case_wallet_refund')
      AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success')
    GROUP BY t.member_id, t.case_id
  ),
  -- Total unpaid amount per member (only count cases where remaining > 0.009).
  case_totals AS (
    SELECT mc.mid,
           SUM(GREATEST(mc.contribution - COALESCE(mp.net_paid, 0), 0))::NUMERIC AS case_total
    FROM member_cases mc
    LEFT JOIN member_payments mp ON mp.mid = mc.mid AND mp.cid = mc.cid
    GROUP BY mc.mid
  ),
  -- Reinstatement penalty for inactive members, anchored at the latest
  -- inactivation transition (any reason). 300 hardcoded as in get_member_total_due.
  inactive_members AS (
    SELECT m.id AS mid
    FROM public.members m
    WHERE m.id = ANY(v_member_ids) AND m.status = 'inactive'
  ),
  latest_inactivation AS (
    SELECT DISTINCT ON (im.mid)
           im.mid,
           st.created_at AS inactivated_at
    FROM inactive_members im
    JOIN public.member_status_transitions st
      ON st.member_id = im.mid AND st.to_status = 'inactive'
    ORDER BY im.mid, st.created_at DESC
  ),
  penalty_totals AS (
    SELECT li.mid,
           GREATEST(300 - COALESCE((
             SELECT SUM(ABS(t.amount))::NUMERIC
             FROM public.transactions t
             WHERE t.member_id = li.mid
               AND t.transaction_type = 'penalty'
               AND t.created_at >= COALESCE(li.inactivated_at, '1970-01-01'::TIMESTAMPTZ)
               AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success')
               AND COALESCE(t.metadata->>'source', '') = 'auto_reinstatement_penalty'
           ), 0), 0) AS penalty_due
    FROM latest_inactivation li
  )
  SELECT u.mid,
         COALESCE(ct.case_total, 0) + COALESCE(pt.penalty_due, 0)
  FROM UNNEST(v_member_ids) u(mid)
  LEFT JOIN case_totals ct ON ct.mid = u.mid
  LEFT JOIN penalty_totals pt ON pt.mid = u.mid;
END;
$function$;

-- ── view_case_funding_summary ──
CREATE OR REPLACE VIEW public.case_funding_summary AS
SELECT c.id AS case_id,
    c.case_number,
    c.case_type,
    c.affected_member_id,
    c.contribution_per_member,
    c.start_date,
    c.end_date,
    c.expected_amount,
    COALESCE(sum(
        CASE
            WHEN (t.transaction_type = ANY (ARRAY['contribution'::text, 'case_wallet_deduction'::text, 'arrears'::text, 'late_payment'::text])) THEN abs(t.amount)
            WHEN (t.transaction_type = ANY (ARRAY['contribution_refund'::text, 'case_wallet_refund'::text])) THEN (- abs(t.amount))
            ELSE (0)::numeric
        END), (0)::numeric) AS actual_amount,
    (COALESCE(sum(
        CASE
            WHEN (t.transaction_type = ANY (ARRAY['contribution'::text, 'case_wallet_deduction'::text, 'arrears'::text, 'late_payment'::text])) THEN abs(t.amount)
            WHEN (t.transaction_type = ANY (ARRAY['contribution_refund'::text, 'case_wallet_refund'::text])) THEN (- abs(t.amount))
            ELSE (0)::numeric
        END), (0)::numeric) - c.expected_amount) AS variance,
    c.is_active,
    c.is_finalized
   FROM (cases c
     LEFT JOIN transactions t ON (((t.case_id = c.id) AND ((t.status IS NULL) OR (t.status = ''::text) OR (lower(t.status) = ANY (ARRAY['completed'::text, 'success'::text]))))))
  GROUP BY c.id, c.case_number, c.case_type, c.affected_member_id, c.contribution_per_member, c.start_date, c.end_date, c.expected_amount, c.is_active, c.is_finalized
  ORDER BY c.created_at DESC;

-- ── view_monthly_contributions_summary ──
CREATE OR REPLACE VIEW public.monthly_contributions_summary AS
SELECT date_trunc('month'::text, t.created_at) AS month,
    t.transaction_type,
    count(*) AS transaction_count,
    sum(abs(t.amount)) AS total_amount,
    count(DISTINCT t.member_id) AS unique_members
   FROM transactions t
  WHERE (((t.status IS NULL) OR (t.status = ''::text) OR (lower(t.status) = ANY (ARRAY['completed'::text, 'success'::text]))) AND (t.transaction_type = ANY (ARRAY['contribution'::text, 'case_wallet_deduction'::text, 'wallet_funding'::text, 'registration'::text, 'renewal'::text, 'penalty'::text, 'arrears'::text, 'late_payment'::text])))
  GROUP BY (date_trunc('month'::text, t.created_at)), t.transaction_type
  ORDER BY (date_trunc('month'::text, t.created_at)) DESC, t.transaction_type;

-- ── view_v_member_unpaid_obligations_summary ──
CREATE OR REPLACE VIEW public.v_member_unpaid_obligations_summary AS
WITH unpaid AS (
         SELECT m.id AS member_id,
            m.member_number,
            m.name,
            m.status,
            c.id AS case_id,
            c.case_number,
            COALESCE(c.contribution_per_member, (0)::numeric) AS contribution_per_member
           FROM (members m
             CROSS JOIN cases c)
          WHERE (((c.is_active = true) OR (c.is_finalized = true)) AND member_case_obligation_applies(m.id, c.id))
        ), paid AS (
         SELECT DISTINCT t.member_id,
            t.case_id
           FROM transactions t
          WHERE ((t.transaction_type = ANY (ARRAY['contribution'::text, 'case_wallet_deduction'::text, 'arrears'::text, 'late_payment'::text])) AND (COALESCE(lower(t.status), 'completed'::text) = ANY (ARRAY['completed'::text, 'success'::text])))
        )
 SELECT u.member_id,
    u.member_number,
    u.name,
    u.status,
    (count(*))::integer AS unpaid_case_count,
    COALESCE(sum(u.contribution_per_member), (0)::numeric) AS unpaid_total
   FROM (unpaid u
     LEFT JOIN paid p ON (((p.member_id = u.member_id) AND (p.case_id = u.case_id))))
  WHERE (p.member_id IS NULL)
  GROUP BY u.member_id, u.member_number, u.name, u.status
 HAVING (count(*) > 0);

-- ── backfill: retag genuine paid-after-close rows ──
UPDATE public.transactions
SET transaction_type = 'late_payment',
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('retagged_from', 'arrears')
WHERE transaction_type = 'arrears'
  AND case_id IS NOT NULL
  AND COALESCE(LOWER(status), 'completed') IN ('completed', 'success');
