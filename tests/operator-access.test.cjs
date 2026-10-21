const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function compile(path, mocks = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Request, Response, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-test', SUPABASE_SERVICE_ROLE_KEY: 'server-only' } }, require(name) { if (name in mocks) return mocks[name]; throw new Error(name); } });
  return exports;
}
const policy = compile('lib/store-access.ts');
function fixture({ restricted = false, role = 'member', invalidToken = false, settingsError = false, missingProfile = false } = {}) {
  const admin = {
    auth: { getUser: async () => ({ data: { user: invalidToken ? null : { id: 'verified-id', user_metadata: { role: 'admin' } } }, error: invalidToken ? {} : null }) },
    from(table) {
      const query = { select() { return query; }, eq(column, value) { if (table === 'profiles') assert.equal(value, 'verified-id'); return query; }, async maybeSingle() {
        return table === 'app_settings' ? { data: { value: restricted }, error: settingsError ? {} : null } : { data: missingProfile ? null : { role }, error: null };
      } };
      return query;
    }
  };
  return compile('app/api/access/route.ts', {
    '@/lib/store-access': policy,
    '@supabase/supabase-js': { createClient: () => admin },
    'next/server': { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } }) } }
  }).GET;
}
function request(token = true) { return new Request('https://store.test/api/access', { headers: token ? { Authorization: 'Bearer verified' } : {} }); }

test('only admin and staff enter when restricted; editable metadata cannot elevate a member', async () => {
  for (const [role, allowed] of [['member', false], ['admin', true], ['staff', true]]) {
    const response = await fixture({ restricted: true, role })(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).allowed, allowed);
    assert.equal(response.headers.get('cache-control'), 'no-store, private');
  }
});
test('OFF allows members and ON preserves a public login entry for operators', async () => {
  assert.equal((await (await fixture()(request())).json()).allowed, true);
  const anonymous = await (await fixture({ restricted: true })(request(false))).json();
  assert.equal(anonymous.restricted, true);
  assert.equal(anonymous.allowed, false);
  assert.equal('role' in anonymous, false);
});
test('expired login, missing profile and settings failures fail closed', async () => {
  assert.equal((await fixture({ invalidToken: true })(request())).status, 401);
  assert.equal((await (await fixture({ missingProfile: true })(request())).json()).allowed, false);
  const error = await fixture({ settingsError: true })(request());
  assert.equal(error.status, 503);
  assert.equal((await error.json()).allowed, false);
});

test('signup availability respects both switches and restores the saved signup preference', async () => {
  for (const [signup, restricted, expected] of [[true, false, true], [true, true, false], [false, false, false], [false, true, false]]) {
    const admin = { from() { let setting; const q = { select() { return q; }, eq(_column, key) { setting = key; return q; }, async maybeSingle() { return { data: { value: setting === 'signup_enabled' ? signup : restricted }, error: null }; } }; return q; } };
    const route = compile('app/api/signup/route.ts', {
      '@/lib/signup': { SIGNUP_CLOSED_MESSAGE: 'closed' },
      '@supabase/supabase-js': { createClient: () => admin },
      'next/server': { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } }
    });
    assert.equal((await (await route.GET()).json()).enabled, expected);
    if (restricted) assert.equal((await route.POST(new Request('https://store.test/api/signup', { method: 'POST', body: '{}' }))).status, 403);
  }
});


test('only operators can change the switch and invalid values never write settings', async () => {
  for (const [role, enabled, status] of [['admin', true, 200], ['staff', false, 200], ['member', true, 403], ['admin', 'true', 400]]) {
    const writes = [];
    let clientNumber = 0;
    const route = compile('app/api/admin/route.ts', {
      '@supabase/supabase-js': { createClient: () => ++clientNumber === 1 ? { auth: { getUser: async () => ({ data: { user: { id: 'operator' } }, error: null }) } } : { from(table) {
        const q = { select() { return q; }, eq() { return q; }, async single() { return { data: { role } }; }, async upsert(record) { writes.push({ table, record }); return { error: null }; } }; return q;
      } } },
      'next/server': { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } }
    });
    const response = await route.POST(new Request('https://store.test/api/admin', { method: 'POST', headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_operator_only_access', payload: { enabled } }) }));
    assert.equal(response.status, status);
    assert.equal(writes.length, status === 200 ? 1 : 0);
    if (status === 200) { assert.equal(writes[0].table, 'app_settings'); assert.equal(writes[0].record.key, 'operator_only_access'); assert.equal(writes[0].record.value, enabled); }
  }
});
