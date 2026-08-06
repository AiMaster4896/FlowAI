// assets/js/supabase-client.js
// Single shared Supabase client instance, built from window.AUDITFLOW_CONFIG
// (see config.js / config.example.js). Loaded as an ES module.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.AUDITFLOW_CONFIG;

if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
  throw new Error(
    "Missing AuditFlow config. Copy config.example.js to config.js and fill in your Supabase project URL and anon key."
  );
}

export const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
