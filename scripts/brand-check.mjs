#!/usr/bin/env node
/**
 * Verifies the brand token blocks are identical in the marketing page and the app.
 *
 * The landing page is hand-written static HTML and the app is a Vite bundle, so they
 * cannot import a shared stylesheet without a runtime request. Instead each file marks
 * its token blocks with `brand:tokens:<name>` comments and this check asserts they match.
 *
 * Run: npm run brand:check
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SOURCES = [
  { label: 'public/index.html', path: join(root, 'public/index.html') },
  { label: 'frontend/src/index.css', path: join(root, 'frontend/src/index.css') },
];

const BLOCKS = ['light', 'dark', 'type'];

/** Pull a marked block and reduce it to comparable `name:value` pairs. */
function extractBlock(source, name) {
  const start = `brand:tokens:${name} `;
  const end = `brand:tokens:${name}:end`;
  const startIdx = source.indexOf(start);
  const endIdx = source.indexOf(end);
  if (startIdx === -1 || endIdx === -1) return null;

  const body = source.slice(source.indexOf('*/', startIdx) + 2, source.lastIndexOf('/*', endIdx));
  const decls = new Map();
  for (const line of body.split('\n')) {
    const m = /^\s*(--[\w-]+)\s*:\s*(.+?);\s*$/.exec(line);
    if (m) decls.set(m[1], m[2].replace(/\s+/g, ' ').trim());
  }
  return decls;
}

const failures = [];
const parsed = SOURCES.map((s) => ({ ...s, text: readFileSync(s.path, 'utf8') }));

for (const name of BLOCKS) {
  const blocks = parsed.map((s) => ({ label: s.label, decls: extractBlock(s.text, name) }));

  const missing = blocks.filter((b) => !b.decls);
  if (missing.length > 0) {
    failures.push(`block "${name}" not found in: ${missing.map((m) => m.label).join(', ')}`);
    continue;
  }

  const [first, ...rest] = blocks;
  for (const other of rest) {
    const keys = new Set([...first.decls.keys(), ...other.decls.keys()]);
    for (const key of [...keys].sort()) {
      const a = first.decls.get(key);
      const b = other.decls.get(key);
      if (a === b) continue;
      if (a === undefined) failures.push(`${name}: ${key} missing from ${first.label} (${other.label} has ${b})`);
      else if (b === undefined) failures.push(`${name}: ${key} missing from ${other.label} (${first.label} has ${a})`);
      else failures.push(`${name}: ${key} is ${a} in ${first.label} but ${b} in ${other.label}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Brand tokens are out of sync:\n');
  for (const f of failures) console.error(`  • ${f}`);
  console.error('\nUpdate both files so the marked blocks match.');
  process.exit(1);
}

const counts = BLOCKS.map((n) => `${n}=${extractBlock(parsed[0].text, n).size}`).join(' ');
console.log(`Brand tokens in sync across ${SOURCES.length} files (${counts}).`);
