-- audit_logs.user_id pointed at auth.users(id), but the app uses custom auth
-- against public.users, so EVERY actor-stamped audit insert failed with a
-- 23503 foreign-key violation (which broke admin login outright once writers
-- started setting user_id). The member_id FK correctly targets
-- public.members and is kept. Actor identity is resolved at read time
-- against public.users / public.members by api-audit-logs.

ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
