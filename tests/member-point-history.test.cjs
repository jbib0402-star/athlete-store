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
  const request = (payload = {}, token = true, action = "list_member_point_logs") => exports.POST(new Request('https://store.test/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer test' } : {}) }, body: JSON.stringify({ action, payload: { user_id: member.id, ...payload } }) }));
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


test('nickname history is operator-only, member-scoped and paginated without point filters', async () => {
  for (const role of ['admin', 'staff']) {
    const rows = Array.from({ length: 21 }, (_, id) => ({ id, old_name: '이전', new_name: '변경', created_at: '2026-10-18T05:00:00Z' }));
    const f = fixture({ role, rows });
    const response = await f.request({ page: 2, filter: 'spent' }, true, 'list_member_nickname_history');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.logs.length, 20);
    assert.equal(result.hasMore, true);
    const ops = f.calls.find(call => call.table === 'member_nickname_records').operations;
    assert.deepEqual(ops.find(op => op[0] === 'eq'), ['eq', 'user_id', f.member.id]);
    assert.deepEqual(ops.find(op => op[0] === 'range'), ['range', 20, 40]);
    assert.equal(ops.some(op => op[0] === 'lt' || op[0] === 'gt'), false);
    assert.equal(f.calls.some(call => call.table === 'point_logs'), false);
  }
  for (const [options, token, status] of [[{}, false, 401], [{ signedIn: false }, true, 401], [{ role: 'member' }, true, 403]]) {
    const f = fixture(options);
    assert.equal((await f.request({}, token, 'list_member_nickname_history')).status, status);
    assert.equal(f.calls.some(call => call.table === 'member_nickname_records'), false);
  }
});
test('nickname history rejects invalid targets and handles missing accounts', async () => {
  assert.equal((await fixture().request({ user_id: 'bad' }, true, 'list_member_nickname_history')).status, 400);
  assert.equal((await fixture({ missing: true }).request({}, true, 'list_member_nickname_history')).status, 404);
});

test('recovered historical names retain observation dates without inventing rename events', async () => {
  const observation = { id: 'old-record', record_kind: 'observation', nickname: '이전이름', old_name: null, new_name: null, created_at: '2026-10-10T03:00:00Z', first_seen: '2026-10-09T03:00:00Z', last_seen: '2026-10-10T03:00:00Z', sources: ['gift'] };
  const f = fixture({ rows: [observation] });
  const response = await f.request({}, true, 'list_member_nickname_history');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.logs[0], observation);
  assert.equal(result.hasMore, false);
  assert.equal(result.logs[0].new_name, null);
  assert.equal(f.calls.some(call => call.table === 'nickname_observations'), false);
  assert.ok(f.calls.find(call => call.table === 'member_nickname_records').operations.find(op => op[0] === 'select')[1].includes('record_kind,nickname,first_seen,last_seen,sources'));
});
