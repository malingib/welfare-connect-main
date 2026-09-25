-- Auto-audit every money movement: each transactions insert writes one
-- audit_logs row. Actor/session come from the transaction's own metadata
-- (stamped by frontend dialogs as actor_user_id/session_id); automated rows
-- (waterfall, callbacks) land as System. Rows already audited elsewhere can
-- opt out with metadata.audit_logged = 'true'; fee-collection rows (audited
-- as FEE_COLLECTION by collect_member_fee) are skipped to avoid doubles.

CREATE OR REPLACE FUNCTION public.audit_transaction_inserts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_meta JSONB := COALESCE(NEW.metadata, '{}'::JSONB);
  v_action TEXT;
  v_actor UUID := NULL;
  v_source TEXT := COALESCE(v_meta->>'source', '');
BEGIN
  IF COALESCE(v_meta->>'audit_logged', 'false') = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.transaction_type IN ('registration', 'renewal', 'penalty')
     AND v_source = 'api_collect_fee' THEN
    RETURN NEW;
  END IF;

  IF v_meta->>'actor_user_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_actor := (v_meta->>'actor_user_id')::UUID;
  END IF;

  v_action := CASE NEW.transaction_type
    WHEN 'wallet_funding' THEN 'WALLET_FUNDING'
    WHEN 'wallet_transfer' THEN 'WALLET_TRANSFER'
    WHEN 'wallet_manual_adjustment' THEN 'WALLET_ADJUSTMENT'
    WHEN 'wallet_balance_editor' THEN 'WALLET_ADJUSTMENT'
    WHEN 'disbursement' THEN 'DISBURSEMENT'
    WHEN 'case_wallet_deduction' THEN 'CASE_DEDUCTION'
    WHEN 'contribution' THEN 'CASE_PAYMENT'
    WHEN 'late_payment' THEN 'LATE_PAYMENT'
    WHEN 'arrears' THEN 'ARREARS_POSTING'
    WHEN 'contribution_refund' THEN 'CASE_REFUND'
    WHEN 'case_wallet_refund' THEN 'CASE_REFUND'
    WHEN 'registration' THEN 'FEE_POSTING'
    WHEN 'renewal' THEN 'FEE_POSTING'
    WHEN 'penalty' THEN 'PENALTY_POSTING'
    ELSE 'TRANSACTION_POSTING'
  END;

  INSERT INTO public.audit_logs (
    user_id, member_id, action, table_name, record_id, status, metadata, timestamp
  ) VALUES (
    v_actor,
    NEW.member_id,
    v_action,
    'transactions',
    NEW.id,
    COALESCE(NEW.status, 'completed'),
    JSONB_BUILD_OBJECT(
      'session_id', v_meta->>'session_id',
      'amount', NEW.amount,
      'transaction_type', NEW.transaction_type,
      'case_id', NEW.case_id,
      'source', NULLIF(v_source, ''),
      'payment_method', NEW.payment_method,
      'mpesa_reference', NEW.mpesa_reference,
      'description', NEW.description
    ),
    COALESCE(NEW.created_at, NOW())
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Auditing must never block the money movement itself.
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_transaction_inserts ON public.transactions;
CREATE TRIGGER trg_audit_transaction_inserts
  AFTER INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_transaction_inserts();
