-- =====================================================
-- FUNCTION: Check for double-crediting of M-Pesa transactions
-- Date: 2026-04-05
-- Purpose: Prevent double-crediting by checking existing locks and transactions
-- =====================================================

CREATE OR REPLACE FUNCTION check_double_credit(
    p_mpesa_receipt_number VARCHAR(100),
    p_amount DECIMAL(15,2),
    p_member_id UUID,
    p_transaction_type VARCHAR(50)
)
RETURNS TABLE(
    has_existing_transaction BOOLEAN,
    has_active_lock BOOLEAN,
    lock_id UUID,
    existing_transaction_id UUID,
    lock_type VARCHAR(50),
    lock_expires_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT
) AS $$
DECLARE
    v_existing_lock RECORD;
    v_existing_transaction RECORD;
BEGIN
    -- Check for existing transaction with same receipt number
    SELECT id INTO v_existing_transaction
    FROM transactions
    WHERE mpesa_reference = p_mpesa_receipt_number
    AND status IN ('completed', 'confirmed')
    LIMIT 1;
    
    -- Check for active lock
    SELECT id, lock_type, expires_at INTO v_existing_lock
    FROM transaction_credit_locks
    WHERE mpesa_receipt_number = p_mpesa_receipt_number
    AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at DESC
    LIMIT 1;
    
    -- Return results
    RETURN QUERY
    SELECT 
        v_existing_transaction IS NOT NULL,
        v_existing_lock IS NOT NULL,
        COALESCE(v_existing_lock.id, NULL::UUID),
        COALESCE(v_existing_transaction.id, NULL::UUID),
        COALESCE(v_existing_lock.lock_type, NULL::VARCHAR(50)),
        COALESCE(v_existing_lock.expires_at, NULL::TIMESTAMP WITH TIME ZONE),
        CASE
            WHEN v_existing_transaction IS NOT NULL THEN 'Transaction with this receipt number already exists'
            WHEN v_existing_lock IS NOT NULL AND v_existing_lock.lock_type = 'processed' THEN 'Transaction already processed for this receipt number'
            WHEN v_existing_lock IS NOT NULL AND v_existing_lock.lock_type = 'failed' THEN 'Previous attempt failed for this receipt number'
            ELSE NULL
        END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;