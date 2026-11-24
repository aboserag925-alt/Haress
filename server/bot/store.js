'use strict';

// Minimal Supabase REST client. The service-role key never leaves the server process.
// Public published-content reads use the anon key so the database's RLS policies apply.
function createStore(options) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || global.fetch;

  function configured() {
    return Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
  }

  function adminConfigured() {
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  }

  async function request(path, init, key) {
    const response = await fetchImpl(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, {
      method: (init && init.method) || 'GET',
      headers: Object.assign({
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }, (init && init.headers) || {}),
      body: init && init.body,
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error('Supabase request failed: ' + response.status);
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    configured: configured,
    adminConfigured: adminConfigured,
    publicRead: function (path) { return request(path, null, env.SUPABASE_ANON_KEY); },
    admin: function (path, init) { return request(path, init, env.SUPABASE_SERVICE_ROLE_KEY); }
  };
}

module.exports = { createStore };
