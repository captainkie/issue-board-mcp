#!/usr/bin/env node
'use strict';
/**
 * stdio ⇄ HTTP proxy for ONE remote MCP endpoint. No dependencies.
 * Claude Desktop starts this; it forwards every JSON-RPC line to
 * ISSUE_BOARD_URL with `Authorization: Bearer ISSUE_BOARD_TOKEN` and writes the
 * reply back. It holds no rules — the server decides everything.
 *
 * Everything written to stdout ends up in a chat, so: the token is validated
 * before use, error text is fixed (never an exception message), and any
 * occurrence of the token is scrubbed from output as a last line of defence.
 */
const readline = require('node:readline');

const URL_ = (process.env.ISSUE_BOARD_URL || '').trim();
const TOKEN = (process.env.ISSUE_BOARD_TOKEN || '').trim();
const MAX_BYTES = 4 * 1024 * 1024;
let TIMEOUT_MS = Number(process.env.ISSUE_BOARD_TIMEOUT_MS || 60000);
if (!Number.isFinite(TIMEOUT_MS) || TIMEOUT_MS <= 0) {
  process.stderr.write('issue-board: ISSUE_BOARD_TIMEOUT_MS is not a positive number; using 60000\n');
  TIMEOUT_MS = 60000;
}

function scrub(s) {
  if (!TOKEN) return s;
  return s.split(TOKEN).join('[token]').split(JSON.stringify(TOKEN).slice(1, -1)).join('[token]');
}
function out(obj) {
  // JSON.stringify guarantees ONE line — MCP stdio framing is newline-delimited.
  process.stdout.write(`${scrub(JSON.stringify(obj))}\n`);
}
function fail(id, code, message) {
  if (id === undefined) return; // a notification has nobody to answer
  out({ jsonrpc: '2.0', id, error: { code, message } });
}
process.stdout.on('error', () => process.exit(0));

function configError() {
  let u;
  try { u = new URL(URL_); } catch { return 'ISSUE_BOARD_URL is not a valid URL'; }
  if (u.username || u.password) return 'ISSUE_BOARD_URL must not contain a user name or password';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return 'ISSUE_BOARD_URL must start with https:// (the token travels with every request)';
  if (!TOKEN) return 'ISSUE_BOARD_TOKEN is empty — paste your personal token into the extension settings';
  if (TOKEN.length < 16) return 'ISSUE_BOARD_TOKEN is too short to be a real token — paste the whole token from the board';
  if (!/^[\x21-\x7e]+$/.test(TOKEN)) return 'ISSUE_BOARD_TOKEN contains characters that are not allowed (spaces, line breaks or non-ASCII) — paste it again with nothing around it';
  return null;
}
const CONFIG_ERROR = configError();
let sessionId = null;

const why = (e) => (e && e.name === 'TimeoutError' ? 'timeout' : 'network error');

function emitEvent(block, id) {
  const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
  if (!data) return false;
  let parsed;
  try { parsed = JSON.parse(data); } catch { return false; }
  if (!parsed || typeof parsed !== 'object') return false;
  out(parsed);
  return ('result' in parsed || 'error' in parsed) && parsed.id === id;
}

const TOKEN_REFUSED = 'the board refused the token (invalid, expired or revoked) — create a new one on the board and update the settings';

function plain(status, text, id) {
  // by STATUS first: an empty, plain-text or HTML 401/403 is still "token refused"
  if (status === 401 || status === 403) return fail(id, -32005, TOKEN_REFUSED);
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    const login = /<html/i.test(text);
    return fail(id, -32003, `board answered HTTP ${status} without JSON${login ? ' — looks like a login page: check the URL is the /mcp endpoint' : ''}`);
  }
  if (parsed && typeof parsed === 'object' && (parsed.jsonrpc === '2.0' || Array.isArray(parsed))) return out(parsed);
  return fail(id, -32003, `board answered HTTP ${status} with an unexpected reply`);
}

async function relay(res, id) {
  const sse = (res.headers.get('content-type') || '').includes('text/event-stream');
  const reader = res.body ? res.body.getReader() : null;
  const dec = new TextDecoder();
  let total = 0;
  let buf = '';
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return fail(id, -32004, 'reply too large (limit 4 MB)');
      }
      buf += dec.decode(value, { stream: true });
      if (sse) {
        const parts = buf.split(/\r?\n\r?\n/);
        buf = parts.pop();
        for (const block of parts) {
          if (emitEvent(block, id)) { await reader.cancel().catch(() => {}); return; }
        }
      }
    }
  } catch (e) {
    return fail(id, -32002, `connection to the board was interrupted: ${why(e)}`);
  }
  buf += dec.decode();
  if (sse) {
    if (buf.trim() && emitEvent(buf, id)) return;
    return fail(id, -32003, 'the board closed the stream without answering');
  }
  return plain(res.status, buf, id);
}

async function forward(line) {
  let msg;
  try { msg = JSON.parse(line); } catch {
    return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
  }
  const id = msg && typeof msg === 'object' && !Array.isArray(msg) ? msg.id : undefined;
  if (CONFIG_ERROR) return fail(id, -32001, CONFIG_ERROR);
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${TOKEN}` };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  let res;
  try {
    // redirect:'manual' — a 307/308 would otherwise replay the body (and the
    // Authorization header's request) against whatever host the Location names.
    res = await fetch(URL_, { method: 'POST', headers, body: line, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    return fail(id, -32002, `cannot reach the board: ${why(e)}`);
  }
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  if (res.status >= 300 && res.status < 400) {
    if (res.body) await res.body.cancel().catch(() => {});
    return fail(id, -32003, 'board answered with a redirect — looks like a login page: check the URL is the /mcp endpoint');
  }
  if (id === undefined || res.status === 202) {
    if (res.body) await res.body.cancel().catch(() => {});
    return;
  }
  return relay(res, id);
}

async function safe(line) {
  try { await forward(line); } catch {
    try { const m = JSON.parse(line); fail(m && m.id, -32603, 'internal proxy error'); } catch { /* nothing to answer */ }
  }
}

const rl = readline.createInterface({ input: process.stdin });
let chain = Promise.resolve();
rl.on('line', (line) => { if (line.trim()) chain = chain.then(() => safe(line)).catch(() => {}); });
rl.on('close', () => { chain.then(() => process.exit(0)); });
