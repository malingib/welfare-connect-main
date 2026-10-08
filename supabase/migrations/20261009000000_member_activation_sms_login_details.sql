UPDATE public.sms_templates
SET raw_template = 'Malanga Welfare: Congratulations {name}. Your membership is active. Member number: {memberNumber}. Log in at {portalLink} using your member number and registered phone number.',
    updated_at = now()
WHERE trigger_key = 'registration_activated';
