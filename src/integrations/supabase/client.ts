// Simplified Supabase client configuration
// CORS is handled at the API gateway level

import { createClient } from '@supabase/supabase-js';
import { getSupabaseBaseUrl } from '@/lib/appAuth';
import type { Database } from './types';

const supabaseUrl = getSupabaseBaseUrl(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing or invalid Supabase environment variables. Use the project URL like https://<project-ref>.supabase.co, not the root dashboard URL.');
}

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

// Regular client for normal operations - properly typed
export const supabase = createClient<Database>(
  supabaseUrl, 
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    },
    db: {
      schema: 'public'
    }
  }
);

// Keep all browser access on anon key; privileged operations must go through trusted edge functions.
