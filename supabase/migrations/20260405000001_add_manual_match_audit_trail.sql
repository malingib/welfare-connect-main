-- =====================================================
-- MIGRATION: Add Manual Match Audit Trail Tables
-- Date: 2026-04-05
-- Purpose: Implement proper audit trails for manual matches
-- =====================================================

-- 1. Create manual match audit table
CREATE TABLE manual_match_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wrong_mpesa_transaction_id UUID REFERENCES wrong_mpesa_transactions(id) ON DELETE CASCADE,
    original_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
    matched_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
    matched_case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
    reference_type VARCHAR(30) CHECK (reference_type IN ('member_only', 'case_only', 'member_and_case', 'phone_and_member', 'unknown')),
    action VARCHAR(50) NOT NULL CHECK (action IN ('manual_match', 'manual_unmatch', 'auto_match', 'auto_unmatch', 'ignore', 'reverse')),
    amount DECIMAL(15,2) NOT NULL,
    mpesa_receipt_number VARCHAR(100) NOT NULL,
    reference VARCHAR(255),
    notes TEXT,
    matched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    matched_by UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create double-credit prevention table
CREATE TABLE transaction_credit_locks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mpesa_receipt_number VARCHAR(100) UNIQUE NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    member_id UUID REFERENCES members(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
    lock_type VARCHAR(50) NOT NULL CHECK (lock_type IN ('pending', 'processed', 'failed', 'reversed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    processed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT
);

-- 3. Create indexes for performance
CREATE INDEX idx_manual_match_wrong_transaction ON manual_match_audit(wrong_mpesa_transaction_id);
CREATE INDEX idx_manual_match_member ON manual_match_audit(matched_member_id);
CREATE INDEX idx_manual_match_case ON manual_match_audit(matched_case_id);
CREATE INDEX idx_manual_match_matched_by ON manual_match_audit(matched_by);
CREATE INDEX idx_manual_match_action ON manual_match_audit(action);
CREATE INDEX idx_manual_match_date ON manual_match_audit(matched_at);
CREATE INDEX idx_credit_lock_receipt ON transaction_credit_locks(mpesa_receipt_number);
CREATE INDEX idx_credit_lock_member ON transaction_credit_locks(member_id);
CREATE INDEX idx_credit_lock_expires ON transaction_credit_locks(expires_at);
CREATE INDEX idx_credit_lock_type ON transaction_credit_locks(lock_type);

-- 4. Add trigger for updated timestamp
CREATE OR REPLACE FUNCTION update_manual_match_audit_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_manual_match_audit_updated_at
    BEFORE UPDATE ON manual_match_audit
    FOR EACH ROW
    EXECUTE FUNCTION update_manual_match_audit_updated_at();

-- 5. Add RLS policies
ALTER TABLE manual_match_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_credit_locks ENABLE ROW LEVEL SECURITY;

-- Admin policies
DROP POLICY IF EXISTS "Admins can view manual match audit" ON manual_match_audit;
CREATE POLICY "Admins can view manual match audit"
    ON manual_match_audit
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Admins can create manual match audit" ON manual_match_audit;
CREATE POLICY "Admins can create manual match audit"
    ON manual_match_audit
    FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can update manual match audit" ON manual_match_audit;
CREATE POLICY "Admins can update manual match audit"
    ON manual_match_audit
    FOR UPDATE
    USING (true);

DROP POLICY IF EXISTS "Admins can delete manual match audit" ON manual_match_audit;
CREATE POLICY "Admins can delete manual match audit"
    ON manual_match_audit
    FOR DELETE
    USING (true);

-- Credit lock policies
DROP POLICY IF EXISTS "Service role can manage credit locks" ON transaction_credit_locks;
CREATE POLICY "Service role can manage credit locks"
    ON transaction_credit_locks
    FOR ALL
    USING (true);

-- 6. Add comments
COMMENT ON TABLE manual_match_audit IS 'Audit trail for all manual and automatic transaction matches';
COMMENT ON COLUMN manual_match_audit.original_member_id IS 'Original member ID (if different from matched member)';
COMMENT ON COLUMN manual_match_audit.matched_member_id IS 'Member ID the payment was matched to';
COMMENT ON COLUMN manual_match_audit.matched_case_id IS 'Case ID the payment was matched to (if applicable)';
COMMENT ON COLUMN manual_match_audit.reference_type IS 'Type of reference parsed from BillRefNumber';
COMMENT ON COLUMN manual_match_audit.action IS 'Type of action performed (manual_match, auto_match, ignore, etc.)';
COMMENT ON COLUMN manual_match_audit.matched_by IS 'User ID who performed the match action';

COMMENT ON TABLE transaction_credit_locks IS 'Prevents double-crediting of M-Pesa transactions';
COMMENT ON COLUMN transaction_credit_locks.lock_type IS 'Status of the credit lock (pending, processed, failed, reversed)';
COMMENT ON COLUMN transaction_credit_locks.expires_at IS 'When the lock expires (for temporary locks)';