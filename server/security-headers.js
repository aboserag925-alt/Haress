'use strict';

// Keep this policy identical to SECURITY_HEADERS in src/worker/index.js
// (src/worker/security-parity.test.mjs enforces it).
// 'unsafe-inline' for scripts is a temporary concession: app/index.html, index.html and
// app/admin.html still use inline <script> blocks and onclick="" handlers. Remove it after
// moving them to external files, then switch script-src to 'self' only.
const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
const PERMISSIONS_POLICY = 'geolocation=(self), camera=(), microphone=(), payment=()';

// Headers for static page responses. HSTS is opt-in (ENABLE_HSTS=true) because the server
// is also used over plain http on localhost; Cloudflare/the Worker normally adds it in production.
function staticSecurityHeaders(env) {
  const headers = {
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'Permissions-Policy': PERMISSIONS_POLICY
  };
  if (env && env.ENABLE_HSTS === 'true') {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}

module.exports = {
  CONTENT_SECURITY_POLICY: CONTENT_SECURITY_POLICY,
  PERMISSIONS_POLICY: PERMISSIONS_POLICY,
  staticSecurityHeaders: staticSecurityHeaders
};
