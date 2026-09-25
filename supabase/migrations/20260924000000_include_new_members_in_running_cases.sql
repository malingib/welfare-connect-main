-- New members join the welfare pool while an active case is still running.
-- They owe that active case, but must not be back-charged for cases that were
-- already closed before they joined.

CREATE OR REPLACE FUNCTION public.member_case_obligation_applies(
  p_member_id UUID,
  p_case_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_member_start DATE;
  v_case RECORD;
  v_case_effective_end DATE;
BEGIN
  SELECT COALESCE(m.registration_date, m.created_at::DATE, CURRENT_DATE)
  INTO v_member_start
  FROM public.members m
  WHERE m.id = p_member_id;

  IF v_member_start IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT c.is_active, c.is_finalized, c.start_date, c.end_date, c.created_at
  INTO v_case
  FROM public.cases c
  WHERE c.id = p_case_id;

  IF NOT FOUND OR (NOT COALESCE(v_case.is_active, FALSE)
                   AND NOT COALESCE(v_case.is_finalized, FALSE)) THEN
    RETURN FALSE;
  END IF;

  -- An open case applies to every current member, including members who
  -- registered after the case started.
  IF COALESCE(v_case.is_active, FALSE) THEN
    RETURN TRUE;
  END IF;

  -- A closed case only applies when it was still open on the join date.
  v_case_effective_end := COALESCE(
    v_case.end_date,
    v_case.start_date,
    v_case.created_at::DATE
  );

  RETURN COALESCE(v_case_effective_end >= v_member_start, FALSE);
END;
$$;

COMMENT ON FUNCTION public.member_case_obligation_applies(UUID, UUID) IS
'Active cases apply to all current members; finalized cases are excluded when closed before member registration.';

GRANT EXECUTE ON FUNCTION public.member_case_obligation_applies(UUID, UUID)
  TO anon, authenticated, service_role;

-- Keep the bulk member totals aligned with the helper above. This function is
-- inlined for performance, so it does not automatically inherit the helper's
-- updated active-case behavior.
CREATE OR REPLACE FUNCTION public.get_members_total_due_light(p_member_ids UUID[])
RETURNS TABLE(member_id UUID, total_due NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_ids ALIAS FOR p_member_ids;
BEGIN
  RETURN QUERY
  WITH member_cases AS (
    SELECT m.id AS mid,
           c.id AS cid,
           COALESCE(c.contribution_per_member, 0) AS contribution
    FROM public.members m
    JOIN public.cases c
      ON (c.is_active = TRUE OR c.is_finalized = TRUE)
     AND (
       c.is_active = TRUE
       OR COALESCE(c.end_date, c.start_date, c.created_at::DATE)
            >= COALESCE(m.registration_date, m.created_at::DATE, CURRENT_DATE)
     )
    WHERE m.id = ANY(v_member_ids)
  ),
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
      AND t.transaction_type IN (
        'contribution', 'case_wallet_deduction', 'arrears', 'late_payment',
        'contribution_refund', 'case_wallet_refund'
      )
      AND COALESCE(LOWER(t.status), 'completed') IN ('completed', 'success')
    GROUP BY t.member_id, t.case_id
  ),
  case_totals AS (
    SELECT mc.mid,
           SUM(GREATEST(mc.contribution - COALESCE(mp.net_paid, 0), 0))::NUMERIC AS case_total
    FROM member_cases mc
    LEFT JOIN member_payments mp ON mp.mid = mc.mid AND mp.cid = mc.cid
    GROUP BY mc.mid
  ),
  inactive_members AS (
    SELECT m.id AS mid
    FROM public.members m
    WHERE m.id = ANY(v_member_ids) AND m.status = 'inactive'
  ),
  latest_inactivation AS (
    SELECT DISTINCT ON (im.mid) im.mid, st.created_at AS inactivated_at
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
$$;

COMMENT ON FUNCTION public.get_members_total_due_light(UUID[]) IS
'Bulk total_due with active cases applying to all current members and finalized cases scoped by join date.';

GRANT EXECUTE ON FUNCTION public.get_members_total_due_light(UUID[])
  TO service_role, authenticated, anon;
