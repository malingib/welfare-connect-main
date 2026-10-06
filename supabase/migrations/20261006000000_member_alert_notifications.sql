-- Member alert notifications: probation completion/ending, status changes,
-- penalty postings, and closed-case overdue templates.
--
-- Design:
-- * In-app bell reads public.notifications (member_id, role='member', category).
-- * A daily sweeper edge function SMSes rows with sms_sent_at IS NULL.
-- * Manual status changes are notified by api-member-status-update (edge);
--   automatic/system changes are notified by DB triggers below (DB cannot SMS).
-- * Probation completion piggybacks the existing daily pg_cron job.

-- ── 1. SMS tracking on notifications ─────────────────────────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS sms_sent_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_sms_pending
  ON public.notifications (category, created_at)
  WHERE sms_sent_at IS NULL;

-- ── 2. New SMS templates (admin-editable in Settings) ────────────────────────
INSERT INTO public.sms_templates (trigger_key, label, description, category, raw_template) VALUES
  ('closed_case_overdue', 'Kesi Iliyofungwa Imechelewa', 'Fuata malipo ya kesi zilizofungwa (late payment).', 'case',
   'Mwanachama mpendwa {name}, kesi {caseNumber} ilifungwa na hujalipa KES {amount}. Tafadhali lipa kama malipo ya kuchelewa kwa paybill 4164179 account {memberNumber}.'),
  ('probation_ending', 'Muda wa Majaribio Unaisha', 'Mjulishe mwanachama muda wa majaribio unakaribia kuisha.', 'member',
   'Mwanachama mpendwa {name}, muda wako wa majaribio unaisha {deadline}. Endelea kuchangia ili uwe mwanachama kamili.'),
  ('probation_completed', 'Majaribio Yamekamilika', 'Mjulishe mwanachama amekuwa mwanachama kamili.', 'member',
   'Hongera {name}! Muda wako wa majaribio umeisha na sasa wewe ni mwanachama kamili wa Malanga Welfare.'),
  ('penalty_posted', 'Adhabu Imekwisha', 'Mjulishe mwanachama adhabu ya kurejesha uanachama imewekwa.', 'payment',
   'Mwanachama mpendwa {name}, adhabu ya KES {amount} imewekwa kwenye akaunti yako. Lipa kupitia paybill ili kuendelea kupata huduma.'),
  ('status_changed', 'Hali Imabadilika', 'Mjulishe mwanachama hali ya uanachama imebadilika.', 'member',
   'Mwanachama mpendwa {name}, hali yako ya uanachama imebadilika kutoka {from} hadi {to}.'),
  ('auto_inactive', 'Uanachama Umesimamishwa', 'Mjulishe mwanachama amesimamishwa kwa kukosa malipo.', 'member',
   'Mwanachama mpendwa {name}, uanachama wako umesimamishwa kwa sababu ya malipo yanayodaiwa. Lipa kupitia paybill 4164179 ili kurejesha uanachama.')
ON CONFLICT (trigger_key) DO NOTHING;

-- ── 3. Probation completion: notify transitioned members ─────────────────────
-- Replaces the count-only version; keeps RETURNS INT + aggregate audit row.
CREATE OR REPLACE FUNCTION public.auto_update_probation_status()
RETURNS INT AS $$
DECLARE
  v_ids UUID[];
  v_updated_count INT := 0;
  v_member_id UUID;
  v_member_name TEXT;
BEGIN
  SELECT COALESCE(ARRAY_AGG(id), '{}')
    INTO v_ids
    FROM public.members
    WHERE status = 'probation'
      AND probation_end_date <= CURRENT_DATE;

  IF array_length(v_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.members
    SET status = 'active',
        updated_at = NOW()
    WHERE id = ANY (v_ids);

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count > 0 THEN
    INSERT INTO public.audit_logs (action, table_name, status, metadata)
    VALUES (
      'PROBATION_AUTO_UPDATE',
      'members',
      'success',
      jsonb_build_object('updated_count', v_updated_count, 'executed_at', NOW())
    );

    FOR v_member_id IN SELECT UNNEST(v_ids) LOOP
      SELECT COALESCE(NULLIF(TRIM(name), ''), 'Mwanachama')
        INTO v_member_name
        FROM public.members
        WHERE id = v_member_id;

      INSERT INTO public.notifications (member_id, role, title, message, category, data)
      VALUES (
        v_member_id,
        'member',
        'Mwanachama Kamili',
        'Hongera ' || v_member_name || '! Muda wako wa majaribio umeisha na sasa wewe ni mwanachama kamili wa Malanga Welfare.',
        'probation_completed',
        jsonb_build_object('source', 'auto_update_probation_status')
      );
    END LOOP;
  END IF;

  RETURN v_updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.auto_update_probation_status IS
'Auto-update members from probation to active status; notifies each transitioned member (in-app; SMS via sweeper).';

-- ── 4. Probation ending soon (7-day window, weekly) ───────────────────────────
CREATE OR REPLACE FUNCTION public.notify_upcoming_probation_end()
RETURNS INT AS $$
DECLARE
  v_count INT := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, COALESCE(NULLIF(TRIM(name), ''), 'Mwanachama') AS name, probation_end_date
      FROM public.members
      WHERE status = 'probation'
        AND probation_end_date > CURRENT_DATE
        AND probation_end_date <= CURRENT_DATE + INTERVAL '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM public.notifications n
          WHERE n.member_id = members.id
            AND n.category = 'probation_ending'
            AND n.created_at >= NOW() - INTERVAL '7 days'
        )
  LOOP
    INSERT INTO public.notifications (member_id, role, title, message, category, data)
    VALUES (
      r.id,
      'member',
      'Muda wa Majaribio Unaisha',
      'Mwanachama mpendwa ' || r.name || ', muda wako wa majaribio unaisha ' || TO_CHAR(r.probation_end_date, 'YYYY-MM-DD') || '. Endelea kuchangia ili uwe mwanachama kamili.',
      'probation_ending',
      jsonb_build_object('source', 'notify_upcoming_probation_end', 'probation_end_date', r.probation_end_date)
    );
    v_count := v_count + 1;
  END LOOP;

  IF v_count > 0 THEN
    INSERT INTO public.audit_logs (action, table_name, status, metadata)
    VALUES (
      'PROBATION_ENDING_NOTIFIED',
      'members',
      'success',
      jsonb_build_object('notified_count', v_count, 'executed_at', NOW())
    );
  END IF;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('weekly-probation-ending-notify')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-probation-ending-notify');

SELECT cron.schedule(
  'weekly-probation-ending-notify',
  '0 1 * * 1',
  $$ SELECT public.notify_upcoming_probation_end(); $$
);

-- ── 5. Automatic status transitions → member notification ────────────────────
-- Manual changes (reason='manual_status_update') are notified by the
-- api-member-status-update edge function (which also SMSes); skip them here
-- to avoid doubles.
CREATE OR REPLACE FUNCTION public.notify_member_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_name TEXT;
  v_title TEXT;
  v_message TEXT;
  v_category TEXT;
BEGIN
  IF NEW.reason = 'manual_status_update' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(TRIM(name), ''), 'Mwanachama')
    INTO v_name
    FROM public.members
    WHERE id = NEW.member_id;

  IF NEW.to_status = 'inactive' THEN
    v_title := 'Uanachama Umesimamishwa';
    v_category := 'auto_inactive';
    v_message := 'Mwanachama mpendwa ' || v_name || ', uanachama wako umesimamishwa kwa sababu ya malipo yanayodaiwa. Lipa kupitia paybill 4164179 ili kurejesha uanachama.';
  ELSIF NEW.to_status = 'active' AND NEW.from_status = 'probation' THEN
    v_title := 'Mwanachama Kamili';
    v_category := 'probation_completed';
    v_message := 'Hongera ' || v_name || '! Muda wako wa majaribio umeisha na sasa wewe ni mwanachama kamili wa Malanga Welfare.';
  ELSIF NEW.to_status = 'active' AND NEW.from_status = 'inactive' THEN
    v_title := 'Uanachama Umerejeshwa';
    v_category := 'status_changed';
    v_message := 'Mwanachama mpendwa ' || v_name || ', uanachama wako umerejeshwa. Asante kwa kulipa.';
  ELSE
    v_title := 'Hali Imabadilika';
    v_category := 'status_changed';
    v_message := 'Mwanachama mpendwa ' || v_name || ', hali yako ya uanachama imebadilika kutoka ' || COALESCE(NEW.from_status, '?') || ' hadi ' || COALESCE(NEW.to_status, '?') || '.';
  END IF;

  INSERT INTO public.notifications (member_id, role, title, message, category, data)
  VALUES (
    NEW.member_id,
    'member',
    v_title,
    v_message,
    v_category,
    jsonb_build_object(
      'source', 'status_transition_trigger',
      'from_status', NEW.from_status,
      'to_status', NEW.to_status,
      'reason', NEW.reason
    )
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_status_transition ON public.member_status_transitions;

CREATE TRIGGER trg_notify_status_transition
  AFTER INSERT ON public.member_status_transitions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_member_status_transition();

-- ── 6. Penalty posting → member notification ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_penalty_posting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_name TEXT;
  v_amount NUMERIC;
BEGIN
  SELECT COALESCE(NULLIF(TRIM(name), ''), 'Mwanachama')
    INTO v_name
    FROM public.members
    WHERE id = NEW.member_id;

  v_amount := ABS(COALESCE(NEW.amount, 0));

  INSERT INTO public.notifications (member_id, role, title, message, category, data)
  VALUES (
    NEW.member_id,
    'member',
    'Adhabu Imekwisha',
    'Mwanachama mpendwa ' || v_name || ', adhabu ya KES ' || TRIM(TO_CHAR(v_amount, '999999999990.99')) || ' imewekwa kwenye akaunti yako. Lipa kupitia paybill ili kuendelea kupata huduma.',
    'penalty_posted',
    jsonb_build_object(
      'source', COALESCE(NEW.metadata->>'source', 'penalty_trigger'),
      'amount', v_amount,
      'transaction_id', NEW.id,
      'case_id', NEW.case_id
    )
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_penalty_posting ON public.transactions;

CREATE TRIGGER trg_notify_penalty_posting
  AFTER INSERT ON public.transactions
  FOR EACH ROW
  WHEN (NEW.transaction_type = 'penalty')
  EXECUTE FUNCTION public.notify_penalty_posting();
