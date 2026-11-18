-- =====================================================
-- FUNCTION: Create credit lock for M-Pesa transaction
-- Date: 2026-04-05
-- Purpose: Prevent double-crediting by creating a lock before processing
-- =====================================================

CREATE OR REPLACE FUNCTION create_credit_lock(
    p_mpesa_receipt_number VARCHAR(100),
    p_amount DECIMAL(15,2),
    p_member_id UUID,
    p_transaction_type VARCHAR(50),
    p_lock_type VARCHAR(50) DEFAULT 'pending',
    p_notes TEXT DEFAULT NULL,
    p_expires_minutes INTEGER DEFAULT 30
)
RETURNS TABLE(
    lock_id UUID,
    lock_created BOOLEAN,
    error_message TEXT
) AS $$
DECLARE
    v_lock_id UUID;
    v_error_message TEXT;
BEGIN
    -- Validate inputs
    IF p_mpesa_receipt_number IS NULL OR p_mpesa_receipt_number = '' THEN
        v_error_message := 'M-Pesa receipt number is required';
        RETURN QUERY SELECT NULL::UUID, FALSE, v_error_message;
        RETURN;
    END IF;
    
    IF p_member_id IS NULL THEN
        v_error_message := 'Member ID is required';
        RETURN QUERY SELECT NULL::UUID, FALSE, v_error_message;
        RETURN;
    END IF;
    
    -- Check for existing active lock
    SELECT id INTO v_lock_id
    FROM transaction_credit_locks
    WHERE mpesa_receipt_number = p_mpesa_receipt_number
    AND (expires_at IS NULL OR expires_at > NOW())
    AND lock_type IN ('pending', 'processed')
    ORDER BY created_at DESC
    LIMIT 1;
    
    IF v_lock_id IS NOT NULL THEN
        v_error_message := 'Active lock already exists for this receipt number';
        RETURN QUERY SELECT v_lock_id, FALSE, v_error_message;
        RETURN;
    END IF;
    
    -- Create new lock
    INSERT INTO transaction_credit_locks (
        mpesa_receipt_number,
        amount,
        member_id,
        lock_type,
        notes,
        expires_at
    ) VALUES (
        p_mpesa_receipt_number,
        p_amount,
        p_member_id,
        p_lock_type,
        p_notes,
        CASE 
            WHEN p_expires_minutes > 0 THEN NOW() + (p_expires_minutes || ' minutes')::interval
            ELSE NULL
        END
    )
    RETURNING id INTO v_lock_id;
    
    -- Return success
    RETURN QUERY SELECT v_lock_id, TRUE, NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;