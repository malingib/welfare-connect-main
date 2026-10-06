-- Public self-registration and Committee review workflow.
CREATE TABLE IF NOT EXISTS public.membership_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_reference TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  national_id_number TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  gender TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  alternative_phone_number TEXT,
  email_address TEXT,
  residence_status TEXT NOT NULL CHECK (residence_status IN ('resident', 'non_resident')),
  village TEXT,
  current_location TEXT,
  dependants JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_of_kin JSONB NOT NULL DEFAULT '{}'::jsonb,
  passport_photo_path TEXT,
  declaration_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  application_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected', 'payment_pending', 'activated', 'withdrawn')),
  payment_reference TEXT UNIQUE,
  payment_status TEXT NOT NULL DEFAULT 'not_required' CHECK (payment_status IN ('not_required', 'pending', 'received', 'verified', 'failed')),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID,
  review_reason TEXT,
  activated_member_id UUID,
  activated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_membership_applications_status ON public.membership_applications(status, application_date DESC);
CREATE INDEX IF NOT EXISTS idx_membership_applications_phone ON public.membership_applications(phone_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_applications_national_id_open
  ON public.membership_applications(national_id_number)
  WHERE status IN ('pending_review', 'approved', 'payment_pending');

ALTER TABLE public.membership_applications ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.membership_applications TO service_role;

COMMENT ON TABLE public.membership_applications IS 'Public membership applications awaiting Committee review and registration-fee payment.';
