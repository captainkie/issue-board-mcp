import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROXY = join(dirname(fileURLToPath(import.meta.url)), '..', 'desktop', 'server', 'index.js');
const TOKEN = 'qat_EXAMPLEexampleEXAMPLEexampleEXAMPLEexample1';

async function board(reply) {
  const seen = [];
  const srv = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ headers: req.headers, body });
    reply(res, body, req);
  });
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  return { url: `http://127.0.0.1:${srv.address().port}/mcp`, seen, close: () => { srv.closeAllConnections(); srv.close(); } };
}

function proxy(env, msgs) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [PROXY], { env: { PATH: process.env.PATH, ...env } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => resolve(out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))));
    for (const m of msgs) p.stdin.write(`${typeof m === 'string' ? m : JSON.stringify(m)}\n`);
    p.stdin.end();
  });
}

test('forwards with the bearer token and relays the JSON reply', async () => {
  const b = await board((res, body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(body).id, result: { ok: 1 } })); });
  const out = await proxy({ ISSUE_BOARD_URL: b.url, ISSUE_BOARD_TOKEN: TOKEN }, [{ jsonrpc: '2.0', id: 7, method: 'tools/list' }]);
  b.close();
  assert.deepEqual(out, [{ jsonrpc: '2.0', id: 7, result: { ok: 1 } }]);
  assert.equal(b.seen[0].headers.authorization, `Bearer ${TOKEN}`);
});

test('a notification produces no output', async () => {
  const b = await board((res) => { res.statusCode = 202; res.end(); });
  const out = await proxy({ ISSUE_BOARD_URL: b.url, ISSUE_BOARD_TOKEN: TOKEN }, [{ jsonrpc: '2.0', method: 'notifications/initialized' }]);
  b.close();
  assert.deepEqual(out, []);
  // without this the test passes for a proxy that does nothing at all
  assert.equal(b.seen.length, 1);
  assert.equal(JSON.parse(b.seen[0].body).method, 'notifications/initialized');
  assert.equal(b.seen[0].headers.authorization, `Bearer ${TOKEN}`);
});

test('an HTML login page becomes a JSON-RPC error with a hint, never echoing the token', async () => {
  const b = await board((res) => { res.setHeader('content-type', 'text/html'); res.end('<html>Sign in</html>'); });
  const out = await proxy({ ISSUE_BOARD_URL: b.url, ISSUE_BOARD_TOKEN: TOKEN }, [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }]);
  b.close();
  assert.equal(out[0].error.code, -32003);
  assert.match(out[0].error.message, /login page/);
  assert.ok(!JSON.stringify(out).includes(TOKEN));
});

test('a plain-http remote URL or a missing token is refused before any request', async () => {
  let out = await proxy({ ISSUE_BOARD_URL: 'http://board.example.com/mcp', ISSUE_BOARD_TOKEN: TOKEN }, [{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  assert.match(out[0].error.message, /https/);
  out = await proxy({ ISSUE_BOARD_URL: 'https://board.example.com/mcp', ISSUE_BOARD_TOKEN: '' }, [{ jsonrpc: '2.0', id: 2, method: 'ping' }]);
  assert.match(out[0].error.message, /TOKEN/);
});

const ok = (res, id) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id, result: {} })); };

test('a redirect is never followed: the body is not replayed to another host', async () => {
  const target = await board((res) => ok(res, 1));
  const b = await board((res) => { res.statusCode = 307; res.setHeader('location', target.url); res.end(); });
  const out = await proxy({ ISSUE_BOARD_URL: b.url, ISSUE_BOARD_TOKEN: TOKEN }, [{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  b.close(); target.close();
  assert.equal(target.seen.length, 0);
  assert.equal(out[0].error.code, -32003);
  assert.match(out[0].error.message, /login page/);
});

test('a connection reset mid-body becomes an error, not a crash', async () => {
  const b = await board((res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '500' });
    res.write('{"jsonrpc":"2.0",');
    setTimeout(() => res.destroy(), 20);
  });
  const out = await proxy({ ISSUE_BOARD_URL: b.url, ISSUE_BOARD_TOKEN: TOKEN }, [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'ping' }]);
  b.close();
  assert.equal(out.length, 2, 'the second request is still answered');
  assert.equal(out[0].error.code, -32002);
  assert.ok(!JSON.stringify(out).includes(TOKEN));
});

test('pretty-printed JSON is relayed as ONE line', async () => {
  const b = await board((res, body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(body).id, result: { a: [1, 2] } }, null, 2)); });
  const out = await proxy({ ISSUE_BOARD_URL: b.url, ISSUE_BOARD_TOKEN: TOKEN }, [{ jsonrpc: '2.0', id: 3, method: 'ping' }]);
  b.close();
  assert.deepEqual(out, [{ jsonrpc: '2.0', id: 3, result: { a: [1, 2] } }]);
});

test('a token with a line break inside is refused without a request and without echo', async () => {
  const b = await board((res) => ok(res, 1));
  const out = await proxy({ ISSUE_BOARD_URL: b.url, ISSUE_BOARD_TOKEN: 'qat_EXAMPLEaaa\nbbb' }, [{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  b.close();
  assert.equal(b.seen.length, 0);
  assert.match(out[0].error.message, /TOKEN/);
  assert.ok(!JSON.stringify(out).includes('EXAMPLEaaa'));
});

test('an event stream answers as soon as THIS request\'s reply arrives', async () => {
  const b = await board((res, body) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const id = JSON.parse(body).id;
    res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\n`);
    res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id, result: { done: 1 } })}\n\n`);
    // the stream is deliberately left open
  });
  const out = await proxy({ ISSUE_BOARD_URL: b.url, ISSUE_BOARD_TOKEN: TOKEN }, [{ jsonrpc: '2.0', id: 9, method: 'tools/call' }]);
  b.close();
  assert.equal(out.length, 2);
  assert.deepEqual(out[1], { jsonrpc: '2.0', id: 9, result: { done: 1 } });
});

test('a 401 with a non-JSON-RPC body says the token was refused', async () => {
  const b = await board((res) => { res.statusCode = 401; res.setHeader('content-type', 'application/json'); res.end('{"error":"nope"}'); });
  const out = await proxy({ ISSUE_BOARD_URL: b.url, ISSUE_BOARD_TOKEN: TOKEN }, [{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  b.close();
  assert.match(out[0].error.message, /revoked/);
});

test('a reply over the size cap is refused', async () => {
  const b = await board((res) => { res.setHeader('content-type', 'application/json'); res.end('x'.repeat(5 * 1024 * 1024)); });
  const out = await proxy({ ISSUE_BOARD_URL: b.url, ISSUE_BOARD_TOKEN: TOKEN }, [{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  b.close();
  assert.equal(out[0].error.code, -32004);
});

test('an unparseable input line gets a parse error with id null', async () => {
  const b = await board((res) => ok(res, 1));
  const out = await proxy({ ISSUE_BOARD_URL: b.url, ISSUE_BOARD_TOKEN: TOKEN }, ['{not json']);
  b.close();
  assert.deepEqual(out, [{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }]);
});

test('[::1] counts as localhost for plain http', async () => {
  const out = await proxy({ ISSUE_BOARD_URL: 'http://[::1]:9/mcp', ISSUE_BOARD_TOKEN: TOKEN }, [{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  assert.doesNotMatch(out[0].error.message, /https/); // reached the network step, not the config refusal
});

test('a too-short token is refused before any request (it would make the scrubber rewrite JSON keys)', async () => {
  const b = await board((res) => ok(res, 1));
  const out = await proxy({ ISSUE_BOARD_URL: b.url, ISSUE_BOARD_TOKEN: 'ab' }, [{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  b.close();
  assert.equal(b.seen.length, 0);
  assert.match(out[0].error.message, /TOKEN.*short/);
});

for (const [name, status, type, body] of [['empty 401', 401, null, ''], ['plain-text 403', 403, 'text/plain', 'Forbidden'], ['HTML 401', 401, 'text/html', '<html>Sign in</html>']]) {
  test(`${name} is mapped by status to the token-refused hint`, async () => {
    const b = await board((res) => { res.statusCode = status; if (type) res.setHeader('content-type', type); res.end(body); });
    const out = await proxy({ ISSUE_BOARD_URL: b.url, ISSUE_BOARD_TOKEN: TOKEN }, [{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
    b.close();
    assert.equal(out[0].error.code, -32005);
    assert.match(out[0].error.message, /revoked/);
  });
}
