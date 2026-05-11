'use strict';

const { createClient } = require('@supabase/supabase-js');

function requireEnv(name) {
  const v = String(process.env[name] || '').trim();
  return v || null;
}

function supabaseEnabled() {
  return Boolean(requireEnv('SUPABASE_URL') && requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
}

function getSupabaseAdminClient() {
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

module.exports = {
  supabaseEnabled,
  getSupabaseAdminClient,
};

