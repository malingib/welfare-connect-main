-- Keep registration fees paid outside a member wallet out of wallet balance,
-- and ensure settings-routed SMS alerts include membership payment events.

CREATE OR REPLACE FUNCTION public.transaction_wallet_effect(
  p_transaction_type text,
  p_amount numeric,
  p_status text DEFAULT 'completed'::text
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $function$
BEGIN
  IF COALESCE(p_status, 'completed') <> 'completed' THEN
    RETURN 0;
  END IF;

  IF p_transaction_type IN ('reversal_memo', 'contribution', 'registration_payment') THEN
    RETURN 0;
  END IF;

  IF p_transaction_type IN ('registration', 'renewal', 'penalty', 'arrears', 'late_payment', 'case_wallet_deduction', 'wallet_manual_adjustment') THEN
    RETURN -ABS(COALESCE(p_amount, 0));
  END IF;

  RETURN COALESCE(p_amount, 0);
END;
$function$;

COMMENT ON FUNCTION public.transaction_wallet_effect(text, numeric, text) IS
'Wallet effect for completed transactions; registration_payment represents a fee paid externally and has no member-wallet effect.';

CREATE OR REPLACE FUNCTION public.normalize_membership_registration_payment()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.transaction_type = 'registration'
     AND NEW.metadata->>'source' = 'membership_application' THEN
    NEW.transaction_type := 'registration_payment';
    NEW.amount := ABS(COALESCE(NEW.amount, 0));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_normalize_membership_registration_payment ON public.transactions;
CREATE TRIGGER trg_normalize_membership_registration_payment
BEFORE INSERT ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.normalize_membership_registration_payment();

-- Reclassify only the membership-application registration fee rows. Keep their
-- descriptions intact so registration account reports continue to include them.
UPDATE public.transactions
SET transaction_type = 'registration_payment',
    amount = ABS(amount)
WHERE transaction_type = 'registration'
  AND metadata->>'source' = 'membership_application';

-- The row update trigger recomputes each affected member. Recompute explicitly
-- as a safety net for installations where the trigger was disabled.
UPDATE public.members m
SET wallet_balance = public.calculate_wallet_balance(m.id)
WHERE EXISTS (
  SELECT 1
  FROM public.transactions t
  WHERE t.member_id = m.id
    AND t.transaction_type = 'registration_payment'
    AND t.metadata->>'source' = 'membership_application'
);

INSERT INTO public.sms_alert_recipient_settings (trigger_key)
VALUES ('registration_payment_received'), ('registration_activated'), ('whatsapp_group_invite')
ON CONFLICT (trigger_key) DO NOTHING;

-- Queue invitations for recent activations too. The SMS worker resolves the
-- current WhatsApp link from Settings, so a link added after activation works.
INSERT INTO public.notifications (member_id, role, title, message, category, data)
SELECT
  a.activated_member_id,
  'member',
  'Members WhatsApp Group Invitation',
  'Your members WhatsApp group invitation is ready.',
  'whatsapp_group_invite',
  jsonb_build_object(
    'source', 'membership_application_backfill',
    'application_id', a.id,
    'use_current_whatsapp_group_link', true
  )
FROM public.membership_applications a
WHERE a.status = 'activated'
  AND a.activated_member_id IS NOT NULL
  AND a.activated_at >= now() - interval '30 days'
  AND NOT EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.member_id = a.activated_member_id
      AND n.category = 'whatsapp_group_invite'
  );
