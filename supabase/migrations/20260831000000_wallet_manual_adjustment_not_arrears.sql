-- Manual wallet deductions must NOT be counted as arrears (case payments).
-- Current WalletBalanceEditorDialog used transaction_type='arrears' for negative diffs,
-- which debits wallet correctly but also counts toward case_funding_summary,
-- member unpaid checks, and ArrearsAccount. This migration introduces an
-- explicit wallet debit type that debits wallet but is excluded from arrears/case logic.
--
-- New type: wallet_manual_adjustment (wallet debit, audit-visible, not a case payment)

CREATE OR REPLACE FUNCTION transaction_wallet_effect(
  p_transaction_type TEXT,
  p_amount NUMERIC,
  p_status TEXT DEFAULT 'completed'
)
RETURNS NUMERIC AS $$
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
  -- NOT in the ('contribution','case_wallet_deduction','arrears') case-payment sets.
  IF p_transaction_type IN ('registration', 'renewal', 'penalty', 'arrears', 'case_wallet_deduction', 'wallet_manual_adjustment') THEN
    RETURN -ABS(COALESCE(p_amount, 0));
  END IF;

  -- Everything else credits wallet (e.g. wallet_funding, contribution_refund, disbursement).
  RETURN COALESCE(p_amount, 0);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION transaction_wallet_effect(TEXT, NUMERIC, TEXT) IS
'Canonical wallet impact formula. Completed-only, reversal_memo=0, contribution=0, explicit debit types negative (incl wallet_manual_adjustment which is NOT an arrears/case payment), others positive.';

-- Re-derive update_member_wallet_balance_trigger / calculate_wallet_balance to use new helper
CREATE OR REPLACE FUNCTION update_member_wallet_balance_trigger()
RETURNS TRIGGER AS $$
DECLARE
    v_member_id UUID;
    v_new_balance DECIMAL(15,2);
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_member_id := OLD.member_id;
    ELSE
        v_member_id := NEW.member_id;
    END IF;

    SELECT COALESCE(SUM(transaction_wallet_effect(transaction_type, amount, status)), 0)
      INTO v_new_balance
    FROM transactions
    WHERE member_id = v_member_id;

    UPDATE members
    SET wallet_balance = v_new_balance
    WHERE id = v_member_id;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION calculate_wallet_balance(p_member_id UUID)
RETURNS DECIMAL(15,2) AS $$
DECLARE
    balance DECIMAL(15,2);
BEGIN
    SELECT COALESCE(SUM(transaction_wallet_effect(transaction_type, amount, status)), 0)
      INTO balance
    FROM transactions
    WHERE member_id = p_member_id;

    RETURN balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- No backfill UPDATE needed: existing arrears rows from manual edits remain as-is
-- (historical audit). Future manual deductions will use wallet_manual_adjustment
-- and will not appear in arrears account.
-- Optional one-time recompute can be run manually:
-- UPDATE members m SET wallet_balance = calculate_wallet_balance(m.id) WHERE m.id IS NOT NULL;
