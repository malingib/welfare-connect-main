-- Sweep robustness: per-member exceptions inside process_case_waterfall were
-- swallowed (returned in a jsonb payload the cron drain discards, queue row
-- still marked done). A member skipped this way left no trace, e.g. a new
-- member funded mid-case-window but never swept. Persist each per-member
-- sweep failure to audit_logs so misses are visible and actionable.

CREATE OR REPLACE FUNCTION public.process_case_waterfall(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member RECORD;
  v_result JSONB;
  v_eligible INT := 0;
  v_processed INT := 0;
  v_finalized_paid INT := 0;
  v_active_paid INT := 0;
  v_penalty_payments INT := 0;
  v_reactivations INT := 0;
  v_errors JSONB := '[]'::JSONB;
BEGIN
  -- Iterate only members with a positive wallet who are obligated to this case.
  FOR v_member IN
    SELECT m.id
    FROM public.members m
    WHERE COALESCE(m.wallet_balance, 0) > 0
      AND public.member_case_obligation_applies(m.id, p_case_id)
  LOOP
    v_eligible := v_eligible + 1;
    BEGIN
      v_result := public.apply_wallet_payment_waterfall(v_member.id);
      v_processed := v_processed + 1;
      IF COALESCE(v_result->>'skipped', '') = '' THEN
        v_finalized_paid   := v_finalized_paid   + COALESCE((v_result->>'finalized_cases_paid')::INT, 0);
        v_active_paid      := v_active_paid      + COALESCE((v_result->>'active_cases_paid')::INT, 0);
        v_penalty_payments := v_penalty_payments + COALESCE((v_result->>'penalty_payments')::INT, 0);
        IF v_result->>'flipped_to' = 'probation' THEN
          v_reactivations := v_reactivations + 1;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('member_id', v_member.id, 'error', SQLERRM);
      BEGIN
        INSERT INTO public.audit_logs (action, table_name, record_id, member_id, status, metadata, timestamp)
        VALUES ('SWEEP_MEMBER_ERROR', 'members', v_member.id, v_member.id, 'failed',
          jsonb_build_object('case_id', p_case_id, 'error', SQLERRM), NOW());
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'case_id', p_case_id,
    'total_members_eligible', v_eligible,
    'members_processed', v_processed,
    'finalized_cases_paid', v_finalized_paid,
    'active_cases_paid', v_active_paid,
    'penalty_payments', v_penalty_payments,
    'reactivations', v_reactivations,
    'errors', v_errors
  );
END;
$function$;
