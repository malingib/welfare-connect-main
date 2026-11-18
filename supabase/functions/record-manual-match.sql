-- =====================================================
-- FUNCTION: Record manual match in audit trail
-- Date: 2026-04-05
-- Purpose: Record all manual match actions for audit purposes
-- =====================================================

CREATE OR REPLACE FUNCTION record_manual_match(
    p_wrong_mpesa_transaction_id UUID,
    p_original_member_id UUID,
    p_matched_member_id UUID,
    p_matched_case_id UUID,
    p_reference_type VARCHAR(30),
    p_action VARCHAR(50),
    p_amount DECIMAL(15,2),
    p_mpesa_receipt_number VARCHAR(100),
    p_reference VARCHAR(255),
    p_notes TEXT,
    p_matched_by UUID,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(
    audit_id UUID,
    record_created BOOLEAN,
    error_message TEXT
) AS $$
DECLARE
    v_audit_id UUID;
    v_error_message TEXT;
BEGIN
    -- Validate inputs
    IF p_wrong_mpesa_transaction_id IS NULL THEN
        v_error_message := 'Wrong M-Pesa transaction ID is required';
        RETURN QUERY SELECT NULL::UUID, FALSE, v_error_message;
        RETURN;
    END IF;
    
    IF p_matched_member_id IS NULL THEN
        v_error_message := 'Matched member ID is required';
        RETURN QUERY SELECT NULL::UUID, FALSE, v_error_message;
        RETURN;
    END IF;
    
    IF p_matched_by IS NULL THEN
        v_error_message := 'Matched by user ID is required';
        RETURN QUERY SELECT NULL::UUID, FALSE, v_error_message;
        RETURN;
    END IF;
    
    -- Validate reference type
    IF p_reference_type IS NOT NULL AND NOT p_reference_type IN ('member_only', 'case_only', 'member_and_case', 'phone_and_member', 'unknown') THEN
        v_error_message := 'Invalid reference type';
        RETURN QUERY SELECT NULL::UUID, FALSE, v_error_message;
        RETURN;
    END IF;
    
    -- Validate action
    IF NOT p_action IN ('manual_match', 'manual_unmatch', 'auto_match', 'auto_unmatch', 'ignore', 'reverse') THEN
        v_error_message := 'Invalid action type';
        RETURN QUERY SELECT NULL::UUID, FALSE, v_error_message;
        RETURN;
    END IF;
    
    -- Create audit record
    INSERT INTO manual_match_audit (
        wrong_mpesa_transaction_id,
        original_member_id,
        matched_member_id,
        matched_case_id,
        reference_type,
        action,
        amount,
        mpesa_receipt_number,
        reference,
        notes,
        matched_by,
        metadata
    ) VALUES (
        p_wrong_mpesa_transaction_id,
        p_original_member_id,
        p_matched_member_id,
        p_matched_case_id,
        p_reference_type,
        p_action,
        p_amount,
        p_mpesa_receipt_number,
        p_reference,
        p_notes,
        p_matched_by,
        p_metadata
    )
    RETURNING id INTO v_audit_id;
    
    -- Return success
    RETURN QUERY SELECT v_audit_id, TRUE, NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;