import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const edgeFunctions = [
  'supabase/functions/lectures-admin/index.ts',
  'supabase/functions/admin-operations/index.ts',
];

for (const path of edgeFunctions) {
  test(path + ': requires a verified user and explicit admin_users membership before protected operations', () => {
    const source = fs.readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

    const bearer = source.indexOf('authHeader.match(/^Bearer\\s+');
    const verifyUser = source.indexOf('publicClient.auth.getUser(tokenMatch[1])');
    const membershipQuery = source.indexOf('.from("admin_users")');
    const membershipLookup = source.indexOf('.eq("user_id", user.id).maybeSingle()');
    const forbidden = source.indexOf('if (adminError || !adminRow) return json(', membershipQuery);
    const forbiddenResponse = source.indexOf('}, 403, cors)', forbidden);
    const firstProtectedRoute = path.includes('lectures-admin')
      ? source.indexOf('if (route === "/admin/session"')
      : source.indexOf('if (route === "/admin/suggestions"');

    assert.notEqual(bearer, -1, 'must require a Bearer token');
    assert.notEqual(verifyUser, -1, 'must verify JWT with Supabase auth.getUser');
    assert.notEqual(membershipQuery, -1, 'must query admin_users');
    assert.notEqual(membershipLookup, -1, 'must match the authenticated user id');
    assert.notEqual(forbidden, -1, 'must reject missing/error membership');
    assert.notEqual(forbiddenResponse, -1, 'non-admin rejection must be HTTP 403');
    assert.notEqual(firstProtectedRoute, -1, 'must contain protected admin routes');

    assert.ok(bearer < verifyUser, 'token parsing must precede JWT verification');
    assert.ok(verifyUser < membershipQuery, 'JWT verification must precede membership lookup');
    assert.ok(membershipQuery < forbidden && forbidden < firstProtectedRoute,
      'membership denial must happen before any protected admin route');
    assert.ok(source.includes('if (authError || !user?.id) return json('),
      'invalid or expired user sessions must fail closed');
  });
}
