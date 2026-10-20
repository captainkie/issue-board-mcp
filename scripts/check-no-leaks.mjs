/**
 * This repo is PUBLIC. Spec §8: no real URL, token, client name, person or email.
 *
 *   node scripts/check-no-leaks.mjs              staged tree + untracked files + history
 *   node scripts/check-no-leaks.mjs --message F  one commit-message file (commit-msg hook)
 *   node scripts/check-no-leaks.mjs --dir D      every file under D (e.g. an unzipped .mcpb)
 *
 * This file holds ONLY name-free patterns. Real company / client / person names
 * live in an UNTRACKED denylist, looked up in this order:
 *   $LEAK_DENYLIST, ./.leak-denylist, ~/.config/issue-board-mcp/leak-denylist
 * one "regex<TAB>reason" per line (flags: iu). A missing denylist FAILS the run;
 * LEAK_GENERIC_ONLY=1 is the explicit opt-out.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── generic, name-free patterns ────────────────────────────────────────────
const DENY = [
  [/\.pages\.dev\b/i, 'a real deployment host'],
  [/cloudflareaccess\.com/i, 'an Access team domain'],
  [/claude\.ai\/code\/session_/i, 'a private Claude session link'],
  [/session_[A-Za-z0-9]{10,}/, 'a session id'],
  [/\bqa[tu]_(?!EXAMPLE)[A-Za-z0-9_-]{20,}/, 'a token-shaped string'],
  [/\bgh[opusr]_[A-Za-z0-9]{20,}/, 'a GitHub token'],
  [/github_pat_[A-Za-z0-9_]{20,}/, 'a GitHub token'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'an API key'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS key id'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, 'a JWT'],
  [/\b[0-9a-f]{40}\b/i, 'a 40-hex secret or hash'],
  [/(?<!\d)\d{17,20}(?!\d)/, 'a 17-20 digit id (Discord snowflake)', 'nocollapse'],
  [/\S\s*[[({<]\s*at\s*[\])}>]\s*\S/i, 'an obfuscated email'],
  [/\S\s*[[({<]\s*dot\s*[\])}>]\s*\S/i, 'an obfuscated host or email'],
];

// ── allowlists ─────────────────────────────────────────────────────────────
const OK_EMAIL = /@(example\.(com|test)|users\.noreply\.github\.com)$|^noreply@anthropic\.com$/i;
const OK_HOSTS = new Set(['example.com', 'example.test', 'localhost', '127.0.0.1', '[::1]', 'code.claude.com']);
const okHost = (h) => OK_HOSTS.has(h) || h.endsWith('.example.com') || h.endsWith('.example.test');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URLISH = /\b(?:https?|wss?|ftp):\/\/(\[[0-9a-f:]+\]|[^\s/"'`<>)\]},;\\]+)(\/[^\s"'`<>)\]},;\\]*)?/gi;
const WWW = /\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

// ── denylist (untracked) ───────────────────────────────────────────────────
function loadDenylist() {
  const candidates = [process.env.LEAK_DENYLIST, '.leak-denylist', join(homedir(), '.config', 'issue-board-mcp', 'leak-denylist')].filter(Boolean);
  const file = candidates.find((f) => existsSync(f));
  if (!file) {
    if (process.env.LEAK_GENERIC_ONLY === '1') { console.warn('! no denylist found: name checks skipped (LEAK_GENERIC_ONLY=1)'); return []; }
    console.error(`✗ no denylist found (looked in: ${candidates.join(', ')}).\n  Name checks cannot run. Restore the private copy, or set LEAK_GENERIC_ONLY=1 to run generic checks only.`);
    process.exit(1);
  }
  const rules = [];
  for (const l of readFileSync(file, 'utf8').split('\n')) {
    if (!l.trim() || l.startsWith('#')) continue;
    const [re, why] = l.split('\t');
    rules.push([new RegExp(re, 'iu'), why || 'a denylisted term']);
  }
  if (!rules.length && process.env.LEAK_GENERIC_ONLY !== '1') {
    console.error(`✗ the denylist ${file} has no rules (empty or comments only). Name checks cannot run. Restore it, or set LEAK_GENERIC_ONLY=1.`);
    process.exit(1);
  }
  return rules;
}
const RULES = [...DENY, ...loadDenylist()];

// ── scanning ───────────────────────────────────────────────────────────────
// Evasions: percent-encoding, full-width / zero-width characters, a token split
// across lines. Each text is scanned as written AND in those normalised forms.
function forms(text) {
  const dec = text.replace(/(%[0-9a-f]{2})+/gi, (m) => { try { return decodeURIComponent(m); } catch { return m; } });
  const norm = dec.normalize('NFKC').replace(/[​-‍⁠﻿­]/g, '');
  return [...new Set([text, dec, norm])];
}
function whys(s, collapsed) {
  const found = new Set();
  for (const [re, why, flag] of RULES) if (!(collapsed && flag === 'nocollapse') && re.test(s)) found.add(why);
  for (const m of s.match(EMAIL) || []) if (!OK_EMAIL.test(m)) found.add('a real email');
  for (const m of s.matchAll(URLISH)) {
    const host = m[1].toLowerCase().replace(/:\$?\{?[^\]]*$|:\d+$/, '');
    const path = m[2] || '';
    if (host === 'github.com' ? !/^\/captainkie(\/|$)/i.test(path) : !okHost(host)) found.add(`a URL outside the allowlist (${host})`);
  }
  for (const m of s.match(WWW) || []) if (!okHost(m.toLowerCase().replace(/^www\./, ''))) found.add(`a host outside the allowlist (${m})`);
  return found;
}
const hits = [];
function scan(label, text) {
  const lines = text.split('\n');
  const seen = new Set();
  for (const f of forms(text)) {
    f.split('\n').forEach((line, i) => {
      for (const w of whys(line, false)) { seen.add(w); hits.push(`${label}:${i + 1}: ${w}: ${lines[i]?.trim().slice(0, 100)}`); }
    });
  }
  for (const f of forms(text)) {
    for (const join_ of ['', ' ']) {
      for (const w of whys(f.split('\n').map((l) => l.trim()).join(join_), true)) {
        if (!seen.has(w)) { seen.add(w); hits.push(`${label}: ${w} (found only after joining lines — split across lines)`); }
      }
    }
  }
}
const scanPath = (p) => scan(`path ${p}`, p);
const BINARY = /\.(png|jpe?g|gif|ico|woff2?|zip)$/i;
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const tryGit = (...a) => { try { return git(...a); } catch { return ''; } };

const [, , mode, arg] = process.argv;
let count = 0;
if (mode === '--message') {
  scan(`message ${arg}`, readFileSync(arg, 'utf8'));
  count = 1;
} else if (mode === '--dir') {
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const p of walk(arg)) { scanPath(p.slice(arg.length)); if (!BINARY.test(p)) scan(p.slice(arg.length), readFileSync(p, 'utf8')); count++; }
} else {
  // 1. the STAGED tree (what a commit would contain), not the working copy
  for (const f of git('ls-files', '-z').split('\0').filter(Boolean)) {
    scanPath(f);
    if (!BINARY.test(f)) scan(f, git('show', `:${f}`));
    count++;
  }
  // 2. untracked, not-ignored files: one `git add -A` away from the tree
  for (const f of git('ls-files', '-z', '--others', '--exclude-standard').split('\0').filter(Boolean)) {
    scanPath(f);
    if (!BINARY.test(f)) scan(`${f} (untracked)`, readFileSync(f, 'utf8'));
    count++;
  }
  // 3. all history, all refs: messages, author + committer name/email, paths, diffs
  const log = tryGit('log', '-p', '--all', '--format=%x01COMMIT%n%an <%ae>%n%cn <%ce>%n%B');
  const blocks = log.split(/^(?=\x01COMMIT|diff --git )/m);
  blocks.forEach((b, i) => scan(`git log -p block ${i}`, b.replace(/^[+ -](?!--)/gm, '')));
}
if (hits.length) {
  console.error(`✗ ${hits.length} leak(s):\n${[...new Set(hits)].join('\n')}`);
  process.exit(1);
}
console.log(`✓ no leaks in ${count} paths${mode ? '' : ' + untracked files + all history'}`);
