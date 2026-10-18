const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the real route with isolated auth/database clients; no production writes.
function fixture({ role = 'admin', signedIn = true, missing = false, failure = false, rows = [] } = {}) {
  const calls = [];
  const member = { id: '11111111-1111-1111-1111-111111111111', username: 'athlete', character_name: '선수', points: 400 };
  let clients = 0;
  const createClient = () => ++clients % 2 === 1 ? {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'operator' } : null }, error: null }) }
  } : {
    from(table) {
      const operations = [];
      calls.push({ table, operations });
      const query = {};
      for (const name of ['select', 'eq', 'lt', 'gt', 'order', 'range']) query[name] = (...args) => { operations.push([name, ...args]); return query; };
      query.single = async () => ({ data: { role } });
      query.maybeSingle = async () => ({ data: missing ? null : member });
      query.then = (resolve, reject) => Promise.resolve({ data: rows, error: failure ? { message: 'private db details' } : null }).then(resolve, reject);
      return query;
    }
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('app/api/admin/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Request, Response, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'test' } }, require(name) {
    if (name === 'next/server') return { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } }) } };
    if (name === '@supabase/supabase-js') return { createClient };
    throw new Error(name);
  } });
  const request = (payload = {}, token = true) => exports.POST(new Request('https://store.test/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer test' } : {}) }, body: JSON.stringify({ action: 'list_member_point_logs', payload: { user_id: member.id, ...payload } }) }));
  return { request, calls, member };
}

test('anonymous, expired sessions and ordinary members cannot read another account', async () => {
  for (const [options, token, status] of [[{}, false, 401], [{ signedIn: false }, true, 401], [{ role: 'member' }, true, 403]]) {
    const f = fixture(options);
    assert.equal((await f.request({}, token)).status, status);
    assert.equal(f.calls.some(call => call.table === 'point_logs'), false);
  }
});
test('admin and staff read only the selected member with deterministic 20-row pagination', async () => {
  for (const role of ['admin', 'staff']) {
    const f = fixture({ role, rows: Array.from({ length: 21 }, (_, id) => ({ id })) });
    const response = await f.request({ page: 2 });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(result.logs.length, 20);
    assert.equal(result.hasMore, true);
    const ops = f.calls.find(call => call.table === 'point_logs').operations;
    assert.deepEqual(ops.filter(op => op[0] === 'eq'), [['eq', 'user_id', f.member.id]]);
    assert.deepEqual(ops.filter(op => op[0] === 'order').map(op => op[1]), ['created_at', 'id']);
    assert.deepEqual(ops.find(op => op[0] === 'range'), ['range', 20, 40]);
  }
});
test('spending and earning filters use the signed amount and end pages stop', async () => {
  for (const [filter, operation] of [['spent', 'lt'], ['earned', 'gt']]) {
    const f = fixture();
    const result = await (await f.request({ filter })).json();
    assert.equal(result.hasMore, false);
    assert.deepEqual(f.calls.find(call => call.table === 'point_logs').operations.find(op => op[0] === operation), [operation, 'amount', 0]);
  }
});
test('invalid account, page and filter inputs are rejected before log queries', async () => {
  for (const payload of [{ user_id: 'bad' }, { page: 0 }, { page: -1 }, { page: 1.2 }, { page: '2' }, { page: 1000001 }, { filter: 'bad' }]) {
    const f = fixture();
    assert.equal((await f.request(payload)).status, 400);
    assert.equal(f.calls.some(call => call.table === 'point_logs'), false);
  }
});
test('missing member returns 404 and query errors do not expose database details', async () => {
  assert.equal((await fixture({ missing: true }).request()).status, 404);
  const response = await fixture({ failure: true }).request();
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private db details/);
});
